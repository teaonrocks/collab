import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { isAcceptedAttachmentContentType, MESSAGE_ATTACHMENT_POLICY } from "../src/shared/attachment-policy"
import { requireAllowedCurrentUser, requireChannelMember } from "./chat_access"
import { toMessageView } from "./chat_message_projection"
import { queueMessageNotifications } from "./notification_preferences"

const MAX_MESSAGE_BODY_LENGTH = 8_000

const attachmentName = (name: string): string => {
  const normalized = name.trim().replace(/\s+/g, " ")
  if (normalized.length === 0) return "attachment"
  if (normalized.length > MESSAGE_ATTACHMENT_POLICY.maxNameLength) {
    throw new Error(`Attachment names can contain at most ${MESSAGE_ATTACHMENT_POLICY.maxNameLength} characters`)
  }
  return normalized
}

const attachmentKind = (contentType: string): "file" | "image" =>
  contentType.toLowerCase().startsWith("image/") ? "image" : "file"

const validateAttachmentMetadata = (
  metadata: { readonly size: number },
  declaredContentType?: string
) => {
  if (metadata.size > MESSAGE_ATTACHMENT_POLICY.maxSizeBytes) {
    throw new Error("Attachments can be at most 25 MB")
  }
  const contentType = declaredContentType?.toLowerCase()
  if (contentType === undefined || !isAcceptedAttachmentContentType(contentType)) {
    throw new Error("Attachments must be a PNG, JPEG, GIF, WebP, PDF, or plain-text file")
  }
  return contentType
}

const validateMessageBody = (
  rawBody: string,
  options?: { readonly allowEmpty?: boolean }
): string => {
  const body = rawBody.trim()
  if (body.length === 0 && options?.allowEmpty !== true) throw new Error("Message body is required")
  if (body.length > MAX_MESSAGE_BODY_LENGTH) {
    throw new Error(`Message bodies can contain at most ${MAX_MESSAGE_BODY_LENGTH} characters`)
  }
  return body
}

const mentionCandidates = (displayName: string): ReadonlyArray<string> => {
  const normalized = displayName.trim().toLowerCase()
  const firstName = normalized.split(/\s+/)[0] ?? ""
  return Array.from(new Set([`@${normalized}`, firstName.length === 0 ? "" : `@${firstName}`]))
    .filter((value) => value.length > 1)
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const mentionsDisplayName = (body: string, displayName: string): boolean =>
  mentionCandidates(displayName).some((candidate) => {
    const mention = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(candidate)}($|[^A-Za-z0-9_])`, "i")
    return mention.test(body)
  })

const syncMessageMentions = async (
  ctx: MutationCtx,
  input: {
    readonly channelId: Id<"channels">
    readonly messageId: Id<"messages">
    readonly messageCreatedAt: number
    readonly body: string
    readonly authorUserId: Id<"users">
  }
): Promise<ReadonlySet<Id<"users">>> => {
  const mentionedUserIds = new Set<Id<"users">>()
  const existing = await ctx.db
    .query("messageMentions")
    .withIndex("by_message", (q) => q.eq("messageId", input.messageId))
    .collect()
  for (const mention of existing) await ctx.db.delete(mention._id)

  if (input.body.length === 0) return mentionedUserIds
  const channel = await ctx.db.get(input.channelId)
  if (channel === null || channel.kind === "direct") return mentionedUserIds

  const memberships = await ctx.db
    .query("channelMemberships")
    .withIndex("by_channel", (q) => q.eq("channelId", input.channelId))
    .collect()
  for (const membership of memberships) {
    if (membership.userId === input.authorUserId) continue
    const member = await ctx.db.get(membership.userId)
    if (member === null || !mentionsDisplayName(input.body, member.displayName)) continue
    await ctx.db.insert("messageMentions", {
      channelId: input.channelId,
      messageId: input.messageId,
      userId: member._id,
      messageCreatedAt: input.messageCreatedAt
    })
    mentionedUserIds.add(member._id)
  }
  return mentionedUserIds
}

const validateMessageAttachments = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  attachments: ReadonlyArray<{
    readonly storageId: Id<"_storage">
    readonly name: string
  }> | undefined
) => {
  if (attachments === undefined) return []
  if (attachments.length > MESSAGE_ATTACHMENT_POLICY.maxFiles) {
    throw new Error(`Messages can include at most ${MESSAGE_ATTACHMENT_POLICY.maxFiles} attachments`)
  }

  const validated: Array<{
    readonly storageId: Id<"_storage">
    readonly name: string
    readonly contentType: string
    readonly size: number
    readonly kind: "file" | "image"
  }> = []

  for (const attachment of attachments) {
    if (validated.some((item) => item.storageId === attachment.storageId)) {
      throw new Error("The same upload cannot be attached more than once")
    }
    const upload = await ctx.db
      .query("attachmentUploads")
      .withIndex("by_storage_id", (q) => q.eq("storageId", attachment.storageId))
      .unique()
    if (upload === null || upload.uploaderUserId !== userId || upload.claimedMessageId !== undefined) {
      throw new Error("Attachment upload is not owned by the current user or has already been claimed")
    }
    const metadata = await ctx.db.system.get("_storage", attachment.storageId)
    if (metadata === null) throw new Error("Attachment upload was not found")
    const contentType = validateAttachmentMetadata(metadata, upload.contentType)
    validated.push({
      storageId: attachment.storageId,
      name: attachmentName(attachment.name),
      contentType,
      size: metadata.size,
      kind: attachmentKind(contentType)
    })
  }

  return validated
}

export const sendMessageTransaction = async (
  ctx: MutationCtx,
  args: {
    readonly channelId: Id<"channels">
    readonly body: string
    readonly parentMessageId?: Id<"messages">
    readonly attachments?: ReadonlyArray<{
      readonly storageId: Id<"_storage">
      readonly name: string
    }>
  }
) => {
  const user = await requireAllowedCurrentUser(ctx)
  const body = validateMessageBody(args.body, { allowEmpty: true })
  const attachments = await validateMessageAttachments(ctx, user._id, args.attachments)
  if (body.length === 0 && attachments.length === 0) {
    throw new Error("Message body or attachment is required")
  }

  const channel = await requireChannelMember(ctx, { channelId: args.channelId, userId: user._id })
  if (args.parentMessageId !== undefined) {
    const parent = await ctx.db.get(args.parentMessageId)
    if (
      parent === null ||
      parent.workspaceId !== channel.workspaceId ||
      parent.channelId !== args.channelId
    ) {
      throw new Error("Parent message not found")
    }
  }

  const messageId = await ctx.db.insert("messages", {
    workspaceId: channel.workspaceId,
    channelId: args.channelId,
    authorUserId: user._id,
    authorDisplayName: user.displayName,
    body,
    ...(args.parentMessageId === undefined ? {} : { parentMessageId: args.parentMessageId }),
    ...(attachments.length === 0 ? {} : { attachments }),
    reactionBatchReady: true,
    createdAt: Date.now()
  })
  const message = await ctx.db.get(messageId)
  if (message === null) throw new Error("Message not found after insert")
  const mentionedUserIds = await syncMessageMentions(ctx, {
    channelId: message.channelId,
    messageId: message._id,
    messageCreatedAt: message.createdAt,
    body: message.body,
    authorUserId: message.authorUserId
  })
  await queueMessageNotifications(ctx, { channel, message, mentionedUserIds })
  const senderMembership = await ctx.db
    .query("channelMemberships")
    .withIndex("by_channel_user", (q) =>
      q.eq("channelId", message.channelId).eq("userId", user._id)
    )
    .unique()
  if (
    senderMembership !== null &&
    (senderMembership.lastReadAt ?? senderMembership.createdAt) < message.createdAt
  ) {
    await ctx.db.patch(senderMembership._id, { lastReadAt: message.createdAt })
  }
  for (const attachment of attachments) {
    const upload = await ctx.db
      .query("attachmentUploads")
      .withIndex("by_storage_id", (q) => q.eq("storageId", attachment.storageId))
      .unique()
    if (upload !== null) await ctx.db.patch(upload._id, { claimedMessageId: messageId })
  }

  return toMessageView(ctx, message, user._id)
}

export const editMessageTransaction = async (
  ctx: MutationCtx,
  args: {
    readonly channelId: Id<"channels">
    readonly messageId: Id<"messages">
    readonly body: string
  }
) => {
  const body = validateMessageBody(args.body)
  const user = await requireAllowedCurrentUser(ctx)
  const message = await ctx.db.get(args.messageId)
  if (message === null || message.channelId !== args.channelId) throw new Error("Message not found")

  await requireChannelMember(ctx, { channelId: message.channelId, userId: user._id })
  if (message.authorUserId !== user._id) {
    throw new Error("Only the original author can edit this message")
  }

  await ctx.db.patch(args.messageId, { body, editedAt: Date.now() })
  await syncMessageMentions(ctx, {
    channelId: message.channelId,
    messageId: message._id,
    messageCreatedAt: message.createdAt,
    body,
    authorUserId: message.authorUserId
  })
  const updated = await ctx.db.get(args.messageId)
  if (updated === null) throw new Error("Message not found after edit")
  return toMessageView(ctx, updated, user._id)
}

export const deleteMessageTransaction = async (
  ctx: MutationCtx,
  args: {
    readonly channelId: Id<"channels">
    readonly messageId: Id<"messages">
  }
) => {
  const user = await requireAllowedCurrentUser(ctx)
  const message = await ctx.db.get(args.messageId)
  if (message === null || message.channelId !== args.channelId) throw new Error("Message not found")

  await requireChannelMember(ctx, { channelId: message.channelId, userId: user._id })
  if (message.authorUserId !== user._id) {
    throw new Error("Only the original author can delete this message")
  }

  const reactions = await ctx.db
    .query("messageReactions")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .collect()
  for (const reaction of reactions) await ctx.db.delete(reaction._id)

  const mentions = await ctx.db
    .query("messageMentions")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .collect()
  for (const mention of mentions) await ctx.db.delete(mention._id)

  const notificationEvents = await ctx.db
    .query("messageNotificationEvents")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .collect()
  for (const event of notificationEvents) await ctx.db.delete(event._id)

  for (const attachment of message.attachments ?? []) {
    await ctx.storage.delete(attachment.storageId)
    const upload = await ctx.db
      .query("attachmentUploads")
      .withIndex("by_storage_id", (q) => q.eq("storageId", attachment.storageId))
      .unique()
    if (upload !== null) await ctx.db.delete(upload._id)
  }
  await ctx.db.delete(args.messageId)
  return { messageId: args.messageId }
}

export const toggleMessageReactionTransaction = async (
  ctx: MutationCtx,
  args: {
    readonly channelId: Id<"channels">
    readonly messageId: Id<"messages">
    readonly emoji: Doc<"messageReactions">["emoji"]
  }
) => {
  const user = await requireAllowedCurrentUser(ctx)
  const message = await ctx.db.get(args.messageId)
  if (message === null || message.channelId !== args.channelId) throw new Error("Message not found")

  const channel = await requireChannelMember(ctx, { channelId: message.channelId, userId: user._id })
  const existing = await ctx.db
    .query("messageReactions")
    .withIndex("by_message_user_emoji", (q) =>
      q.eq("messageId", args.messageId).eq("userId", user._id).eq("emoji", args.emoji)
    )
    .collect()

  if (existing.length === 0) {
    await ctx.db.insert("messageReactions", {
      workspaceId: channel.workspaceId,
      channelId: message.channelId,
      messageId: message._id,
      userId: user._id,
      emoji: args.emoji,
      messageCreatedAt: message.createdAt,
      createdAt: Date.now()
    })
  } else {
    for (const reaction of existing) await ctx.db.delete(reaction._id)
  }

  return toMessageView(ctx, message, user._id)
}
