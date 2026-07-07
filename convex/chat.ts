import { v } from "convex/values"
import { paginationOptsValidator } from "convex/server"
import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { action, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import { isAcceptedAttachmentContentType, MESSAGE_ATTACHMENT_POLICY } from "../src/shared/attachment-policy"
import {
  getUserByEmail,
  getUserByTokenIdentifier,
  isEmailAllowlisted,
  normalizeViewerEmail,
  requireAllowedCurrentUser,
  requireAllowedEmail,
  requireChannelMember,
  requireIdentity,
  requireWorkspaceMember,
  resolveWorkOsViewer
} from "./chat_access"
import { toMessageViews } from "./chat_message_projection"
import {
  deleteMessageTransaction,
  editMessageTransaction,
  sendMessageTransaction,
  toggleMessageReactionTransaction
} from "./chat_message_transactions"

const DOGFOOD_WORKSPACE_KEY = "aether-dogfood"
const DOGFOOD_WORKSPACE_NAME = "Aether Dogfood"
const DOGFOOD_CHANNEL_KEY = "general"
const DOGFOOD_CHANNEL_NAME = "general"
const MAX_CHANNELS = 100
const MAX_CHANNEL_NAME_LENGTH = 80
const MAX_PRIVATE_CHANNEL_MEMBERS = 100
const MAX_ELIGIBLE_PRIVATE_CHANNEL_MEMBERS = 100
const MAX_ELIGIBLE_PRIVATE_CHANNEL_MEMBER_SCAN = 200
const MAX_MESSAGE_PAGE_SIZE = 100
const MAX_MESSAGE_SEARCH_QUERY_LENGTH = 120
const MAX_MESSAGE_SEARCH_RESULTS = 20
const ATTACHMENT_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000
const MAX_ALLOWLIST_REASON_LENGTH = 240
const MESSAGE_REACTION_EMOJIS = ["👍", "🎉", "👀"] as const

const messageReactionEmoji = v.union(
  v.literal(MESSAGE_REACTION_EMOJIS[0]),
  v.literal(MESSAGE_REACTION_EMOJIS[1]),
  v.literal(MESSAGE_REACTION_EMOJIS[2])
)

const messageAttachmentInput = v.object({
  storageId: v.id("_storage"),
  name: v.string()
})

const validateAttachmentMetadata = (metadata: { readonly size: number }, declaredContentType?: string) => {
  if (metadata.size > MESSAGE_ATTACHMENT_POLICY.maxSizeBytes) {
    throw new Error("Attachments can be at most 25 MB")
  }
  const contentType = declaredContentType?.toLowerCase()
  if (contentType === undefined || !isAcceptedAttachmentContentType(contentType)) {
    throw new Error("Attachments must be a PNG, JPEG, GIF, WebP, PDF, or plain-text file")
  }
  return contentType
}

const allowlistReason = (reason: string | undefined): string | undefined => {
  const normalized = reason?.trim().replace(/\s+/g, " ").slice(0, MAX_ALLOWLIST_REASON_LENGTH)
  return normalized === undefined || normalized.length === 0 ? undefined : normalized
}

const normalizeChannelName = (name: string): string =>
  name.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase()

const validateChannelName = (rawName: string): string => {
  const name = normalizeChannelName(rawName)
  if (name.length === 0) throw new Error("Channel name is required")
  if (name.length > MAX_CHANNEL_NAME_LENGTH) {
    throw new Error(`Channel names can contain at most ${MAX_CHANNEL_NAME_LENGTH} characters`)
  }
  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw new Error("Channel names can only use letters, numbers, dashes, and underscores")
  }
  return name
}

const channelKeyFromName = (name: string): string => normalizeChannelName(name)

type DogfoodDiagnosticContext = Record<string, string | number | boolean | null | undefined>

const supportSafeDiagnosticError = (cause: unknown): string => {
  const kind = cause instanceof Error && cause.name.trim().length > 0 ? cause.name : "UnknownError"
  return `${kind}: details redacted; use the diagnostic context and timestamp for support`
}

const withDogfoodDiagnostics = async <Result>(
  operation: string,
  context: DogfoodDiagnosticContext,
  run: () => Promise<Result>
): Promise<Result> => {
  try {
    return await run()
  } catch (cause) {
    console.error("Dogfood Convex function failed", {
      operation,
      context: Object.fromEntries(
        Object.entries(context)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, value === null ? null : String(value)])
      ),
      error: supportSafeDiagnosticError(cause)
    })
    throw cause
  }
}

const getDefaultWorkspace = (ctx: QueryCtx | MutationCtx) =>
  ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", DOGFOOD_WORKSPACE_KEY)).unique()

const getDefaultChannel = (ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">) =>
  ctx.db
    .query("channels")
    .withIndex("by_workspace_key", (q) => q.eq("workspaceId", workspaceId).eq("key", DOGFOOD_CHANNEL_KEY))
    .unique()

const listWorkspaceChannels = async (ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">) => {
  const channels = await ctx.db
    .query("channels")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(MAX_CHANNELS)

  return channels
    .map(toChannelView)
    .sort((left, right) => {
      if (left.key === DOGFOOD_CHANNEL_KEY) return -1
      if (right.key === DOGFOOD_CHANNEL_KEY) return 1
      return left.name.localeCompare(right.name)
    })
}

const listVisibleWorkspaceChannels = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly workspaceId: Id<"workspaces">
    readonly userId: Id<"users">
  }
) => {
  const memberships = await ctx.db
    .query("channelMemberships")
    .withIndex("by_user", (q) => q.eq("userId", input.userId))
    .collect()
  const memberChannelIds = new Set(
    memberships.map((membership) => membership.channelId).filter((channelId) => channelId !== undefined)
  )
  const channels = await listWorkspaceChannels(ctx, input.workspaceId)

  return channels.filter((channel) => channel.visibility === "public" || memberChannelIds.has(channel.id))
}

const listChannelMembers = async (
  ctx: QueryCtx | MutationCtx,
  channelId: Id<"channels">
) => {
  const memberships = await ctx.db
    .query("channelMemberships")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect()

  const members: Array<{
    readonly id: Id<"users">
    readonly displayName: string
    readonly joinedAt: number
    readonly role: Doc<"channelMemberships">["role"]
  }> = []
  for (const membership of memberships) {
    const member = await ctx.db.get(membership.userId)
    if (member === null) continue
    members.push({
      id: member._id,
      displayName: member.displayName,
      joinedAt: membership.createdAt,
      role: membership.role
    })
  }

  return members.sort((left, right) => left.displayName.localeCompare(right.displayName) || left.joinedAt - right.joinedAt)
}

const listWorkspaceMembers = async (
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">
) => {
  const memberships = await ctx.db
    .query("workspaceMemberships")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect()

  const members: Array<{
    readonly id: Id<"users">
    readonly displayName: string
    readonly joinedAt: number
  }> = []
  for (const membership of memberships) {
    const member = await ctx.db.get(membership.userId)
    if (member === null) continue
    members.push({
      id: member._id,
      displayName: member.displayName,
      joinedAt: membership.createdAt
    })
  }

  return members.sort((left, right) => left.displayName.localeCompare(right.displayName) || left.joinedAt - right.joinedAt)
}

const listPublicWorkspaceChannelIds = async (ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">) => {
  const channels = await ctx.db
    .query("channels")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .take(MAX_CHANNELS)

  return channels
    .filter((channel) => channel.visibility === "public")
    .map((channel) => channel._id)
}

const ensureDefaultSpace = async (ctx: MutationCtx, now: number) => {
  const workspace = await getDefaultWorkspace(ctx)
  const workspaceId = workspace?._id ?? (await ctx.db.insert("workspaces", {
    key: DOGFOOD_WORKSPACE_KEY,
    name: DOGFOOD_WORKSPACE_NAME,
    createdAt: now
  }))

  const channel = await getDefaultChannel(ctx, workspaceId)
  const channelId = channel?._id ?? (await ctx.db.insert("channels", {
    workspaceId,
    key: DOGFOOD_CHANNEL_KEY,
    name: DOGFOOD_CHANNEL_NAME,
    visibility: "private",
    createdAt: now
  }))

  return { workspaceId, channelId }
}

const ensureMemberships = async (
  ctx: MutationCtx,
  input: {
    readonly workspaceId: Id<"workspaces">
    readonly channelId: Id<"channels">
    readonly userId: Id<"users">
    readonly now: number
  }
) => {
  const workspaceMembership = await ctx.db
    .query("workspaceMemberships")
    .withIndex("by_workspace_user", (q) => q.eq("workspaceId", input.workspaceId).eq("userId", input.userId))
    .unique()

  if (workspaceMembership === null) {
    await ctx.db.insert("workspaceMemberships", {
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: "member",
      createdAt: input.now
    })
  }

  const channelMembership = await ctx.db
    .query("channelMemberships")
    .withIndex("by_channel_user", (q) => q.eq("channelId", input.channelId).eq("userId", input.userId))
    .unique()

  if (channelMembership === null) {
    await ctx.db.insert("channelMemberships", {
      channelId: input.channelId,
      userId: input.userId,
      role: "member",
      createdAt: input.now,
      lastReadAt: input.now,
      mentionTrackingStartedAt: input.now
    })
  }
}

const ensureChannelMembership = async (
  ctx: MutationCtx,
  input: {
    readonly channelId: Id<"channels">
    readonly userId: Id<"users">
    readonly now: number
  }
) => {
  const channelMembership = await ctx.db
    .query("channelMemberships")
    .withIndex("by_channel_user", (q) => q.eq("channelId", input.channelId).eq("userId", input.userId))
    .unique()

  if (channelMembership !== null) return channelMembership

  const membershipId = await ctx.db.insert("channelMemberships", {
    channelId: input.channelId,
    userId: input.userId,
    role: "member",
    createdAt: input.now,
    lastReadAt: input.now,
    mentionTrackingStartedAt: input.now
  })

  const membership = await ctx.db.get(membershipId)
  if (membership === null) throw new Error("Channel membership not found after insert")
  return membership
}

const ensureSharedChannelMemberships = async (
  ctx: MutationCtx,
  input: {
    readonly workspaceId: Id<"workspaces">
    readonly userId: Id<"users">
    readonly now: number
  }
) => {
  const channelIds = await listPublicWorkspaceChannelIds(ctx, input.workspaceId)

  for (const channelId of channelIds) {
    await ensureChannelMembership(ctx, { channelId, userId: input.userId, now: input.now })
  }
}

const requirePrivateChannelAdmin = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly channelId: Id<"channels">
    readonly userId: Id<"users">
  }
) => {
  const channel = await requireChannelMember(ctx, input)
  if (channel.visibility !== "private") throw new Error("Private channel membership can only be administered for private channels")

  const membership = await ctx.db
    .query("channelMemberships")
    .withIndex("by_channel_user", (q) => q.eq("channelId", input.channelId).eq("userId", input.userId))
    .unique()
  if (membership?.role !== "admin") throw new Error("Only channel admins can administer private channel membership")
  return channel
}

const requireEligiblePrivateChannelMember = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly workspaceId: Id<"workspaces">
    readonly userId: Id<"users">
  }
) => {
  const user = await ctx.db.get(input.userId)
  if (user === null) throw new Error("Invited user not found")
  await requireWorkspaceMember(ctx, input)
  if (!(await isEmailAllowlisted(ctx, user.email))) {
    throw new Error("Invited user is not on the Aether dogfood allowlist")
  }
  return user
}

export const generateAttachmentUploadUrl = mutation({
  args: {},
  handler: (ctx) => withDogfoodDiagnostics("generateAttachmentUploadUrl", {}, async () => {
    const user = await requireAllowedCurrentUser(ctx)
    const intentId = await ctx.db.insert("attachmentUploadIntents", {
      uploaderUserId: user._id,
      createdAt: Date.now()
    })
    await ctx.scheduler.runAfter(ATTACHMENT_UPLOAD_TTL_MS, internal.chat.cleanupAttachmentUploadIntent, {
      intentId
    })
    return { uploadUrl: await ctx.storage.generateUploadUrl(), intentId }
  })
})

export const registerAttachmentUpload = mutation({
  args: {
    intentId: v.id("attachmentUploadIntents"),
    storageId: v.id("_storage"),
    contentType: v.string()
  },
  handler: (ctx, args) => withDogfoodDiagnostics("registerAttachmentUpload", { storageId: args.storageId }, async () => {
    const user = await requireAllowedCurrentUser(ctx)
    const existing = await ctx.db.query("attachmentUploads")
      .withIndex("by_storage_id", (q) => q.eq("storageId", args.storageId)).unique()
    if (existing !== null) {
      if (existing.uploaderUserId !== user._id) throw new Error("Attachment upload is already registered")
      if (existing.contentType !== args.contentType.toLowerCase()) {
        throw new Error("Attachment upload is already registered with a different content type")
      }
      return { status: "registered" as const, storageId: args.storageId }
    }

    const intent = await ctx.db.get(args.intentId)
    if (intent === null || intent.uploaderUserId !== user._id) {
      throw new Error("Attachment upload intent is missing or is not owned by the current user")
    }

    const metadata = await ctx.db.system.get("_storage", args.storageId)
    if (metadata === null) throw new Error("Attachment upload was not found")
    let contentType: string
    try {
      contentType = validateAttachmentMetadata(metadata, args.contentType)
    } catch (cause) {
      await ctx.storage.delete(args.storageId)
      await ctx.db.delete(intent._id)
      return {
        status: "rejected" as const,
        reason: cause instanceof Error ? cause.message : "Attachment upload was rejected"
      }
    }
    await ctx.db.insert("attachmentUploads", {
      storageId: args.storageId,
      uploaderUserId: user._id,
      contentType,
      createdAt: Date.now()
    })
    await ctx.db.delete(intent._id)
    await ctx.scheduler.runAfter(ATTACHMENT_UPLOAD_TTL_MS, internal.chat.cleanupAbandonedAttachmentUpload, {
      storageId: args.storageId
    })
    return { status: "registered" as const, storageId: args.storageId }
  })
})

export const deleteAttachmentUpload = mutation({
  args: {
    storageId: v.id("_storage"),
    intentId: v.optional(v.id("attachmentUploadIntents"))
  },
  handler: (ctx, args) => withDogfoodDiagnostics("deleteAttachmentUpload", { storageId: args.storageId }, async () => {
    const user = await requireAllowedCurrentUser(ctx)
    const upload = await ctx.db.query("attachmentUploads")
      .withIndex("by_storage_id", (q) => q.eq("storageId", args.storageId)).unique()
    if (upload === null) {
      if (args.intentId === undefined) return { storageId: args.storageId }
      const intent = await ctx.db.get(args.intentId)
      if (intent === null) return { storageId: args.storageId }
      if (intent.uploaderUserId !== user._id) throw new Error("Only the uploader can delete this upload")
      await ctx.storage.delete(args.storageId)
      await ctx.db.delete(intent._id)
      return { storageId: args.storageId }
    }
    if (upload.uploaderUserId !== user._id) throw new Error("Only the uploader can delete this upload")
    if (upload.claimedMessageId !== undefined) throw new Error("Claimed attachments cannot be deleted as abandoned uploads")
    await ctx.storage.delete(args.storageId)
    await ctx.db.delete(upload._id)
    return { storageId: args.storageId }
  })
})

export const cleanupAttachmentUploadIntent = internalMutation({
  args: { intentId: v.id("attachmentUploadIntents") },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId)
    if (intent !== null) await ctx.db.delete(intent._id)
    return null
  }
})

export const cleanupAbandonedAttachmentUpload = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.query("attachmentUploads")
      .withIndex("by_storage_id", (q) => q.eq("storageId", args.storageId)).unique()
    if (upload === null || upload.claimedMessageId !== undefined) return null
    await ctx.storage.delete(args.storageId)
    await ctx.db.delete(upload._id)
    return null
  }
})

export const administerDogfoodAllowlist = internalMutation({
  args: {
    operator: v.string(),
    email: v.string(),
    action: v.union(v.literal("add"), v.literal("remove")),
    reason: v.optional(v.string())
  },
  handler: (ctx, args) => withDogfoodDiagnostics("administerDogfoodAllowlist", {
    action: args.action,
    reasonLength: args.reason?.trim().length ?? 0
  }, async () => {
    const operator = args.operator.trim().replace(/\s+/g, " ")
    if (operator.length === 0 || operator.length > 120) {
      throw new Error("Operator identity must contain between 1 and 120 characters")
    }
    const email = normalizeViewerEmail(args.email)
    const now = Date.now()
    const reason = allowlistReason(args.reason)
    const existing = await ctx.db
      .query("dogfoodAllowlistEntries")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique()

    if (existing === null) {
      await ctx.db.insert("dogfoodAllowlistEntries", {
        email,
        active: args.action === "add",
        createdAt: now,
        createdBy: operator,
        updatedAt: now,
        updatedBy: operator
      })
    } else {
      await ctx.db.patch(existing._id, {
        active: args.action === "add",
        updatedAt: now,
        updatedBy: operator
      })
    }

    await ctx.db.insert("dogfoodAllowlistAudit", {
      email,
      action: args.action,
      operator,
      ...(reason === undefined ? {} : { reason }),
      createdAt: now
    })

    return { email, active: args.action === "add" }
  })
})

export const ensureViewer = action({
  args: {},
  handler: (ctx) => withDogfoodDiagnostics("ensureViewer", {}, async () => {
    const identity = await requireIdentity(ctx)
    const { email, displayName } = await resolveWorkOsViewer(identity)
    const result: {
      readonly userId: Id<"users">
      readonly workspaceId: Id<"workspaces">
      readonly channelId: Id<"channels">
      readonly displayName: string
    } = await ctx.runMutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: identity.tokenIdentifier,
      email,
      displayName
    })

    return result
  })
})

export const ensureViewerForIdentity = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    email: v.string(),
    displayName: v.string()
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const email = await requireAllowedEmail(ctx, args.email)
    const existingUser =
      (await getUserByTokenIdentifier(ctx, args.tokenIdentifier)) ?? (await getUserByEmail(ctx, email))

    const userId = existingUser?._id ?? (await ctx.db.insert("users", {
      tokenIdentifier: args.tokenIdentifier,
      email,
      displayName: args.displayName,
      createdAt: now,
      updatedAt: now
    }))

    if (
      existingUser !== null &&
      (existingUser.tokenIdentifier !== args.tokenIdentifier ||
        existingUser.email !== email ||
        existingUser.displayName !== args.displayName)
    ) {
      await ctx.db.patch(existingUser._id, {
        tokenIdentifier: args.tokenIdentifier,
        email,
        displayName: args.displayName,
        updatedAt: now
      })
    }

    const { workspaceId, channelId } = await ensureDefaultSpace(ctx, now)
    await ensureMemberships(ctx, { workspaceId, channelId, userId, now })
    await ensureSharedChannelMemberships(ctx, { workspaceId, userId, now })

    return { userId, workspaceId, channelId, displayName: args.displayName }
  }
})

export const viewer = query({
  args: {},
  handler: (ctx) => withDogfoodDiagnostics("viewer", {}, async () => {
    const user = await requireAllowedCurrentUser(ctx)
    return { userId: user._id, displayName: user.displayName }
  })
})

export const defaultWorkspace = query({
  args: {},
  handler: (ctx) => withDogfoodDiagnostics("defaultWorkspace", {}, async () => {
    const user = await requireAllowedCurrentUser(ctx)
    const workspace = await getDefaultWorkspace(ctx)

    if (workspace === null) return null

    const channel = await getDefaultChannel(ctx, workspace._id)
    if (channel === null) return null

    await requireChannelMember(ctx, { channelId: channel._id, userId: user._id })

    return {
      currentUser: { id: user._id, displayName: user.displayName },
      workspace: { id: workspace._id, name: workspace.name },
      channel: { id: channel._id, name: channel.name, visibility: channel.visibility }
    }
  })
})

export const channels = query({
  args: {
    workspaceId: v.id("workspaces")
  },
  handler: (ctx, args) => withDogfoodDiagnostics("channels", { workspaceId: args.workspaceId }, async () => {
    const user = await requireAllowedCurrentUser(ctx)
    const workspace = await ctx.db.get(args.workspaceId)
    if (workspace === null) return []

    await requireWorkspaceMember(ctx, { workspaceId: workspace._id, userId: user._id })
    return listVisibleWorkspaceChannels(ctx, { workspaceId: workspace._id, userId: user._id })
  })
})

export const channelIndicators = query({
  args: {
    workspaceId: v.id("workspaces")
  },
  handler: (ctx, args) => withDogfoodDiagnostics("channelIndicators", { workspaceId: args.workspaceId }, async () => {
    const user = await requireAllowedCurrentUser(ctx)
    const workspace = await ctx.db.get(args.workspaceId)
    if (workspace === null) return []

    await requireWorkspaceMember(ctx, { workspaceId: workspace._id, userId: user._id })
    const channels = await listVisibleWorkspaceChannels(ctx, { workspaceId: workspace._id, userId: user._id })
    const memberships = await ctx.db
      .query("channelMemberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()
    const membershipsByChannelId = new Map(memberships.map((membership) => [membership.channelId, membership]))
    const indicators: Array<{
      readonly channelId: Id<"channels">
      readonly indicator: "unread" | "mentioned"
    }> = []

    for (const channel of channels) {
      const membership = membershipsByChannelId.get(channel.id)
      if (membership === undefined) continue

      const lastReadAt = membership.lastReadAt ?? membership.createdAt
      const newestUnread = await ctx.db
        .query("messages")
        .withIndex("by_channel_created_at", (q) => q.eq("channelId", channel.id).gt("createdAt", lastReadAt))
        .order("desc")
        .first()
      if (newestUnread === null) continue

      // Pre-index history intentionally degrades to `unread` rather than scanning an
      // unbounded message range. New mentions are maintained in messageMentions.
      const mentioned = await ctx.db
        .query("messageMentions")
        .withIndex("by_channel_user_created_at", (q) =>
          q.eq("channelId", channel.id).eq("userId", user._id).gt("messageCreatedAt", lastReadAt))
        .first() !== null
      indicators.push({ channelId: channel.id, indicator: mentioned ? "mentioned" : "unread" })
    }

    return indicators
  })
})

export const ensureChannelMember = mutation({
  args: {
    channelId: v.id("channels")
  },
  handler: (ctx, args) => withDogfoodDiagnostics("ensureChannelMember", { channelId: args.channelId }, async () => {
    const user = await requireAllowedCurrentUser(ctx)
    const channel = await ctx.db.get(args.channelId)
    if (channel === null) throw new Error("Channel not found")

    await requireWorkspaceMember(ctx, { workspaceId: channel.workspaceId, userId: user._id })
    if (channel.visibility !== "public") {
      await requireChannelMember(ctx, { channelId: channel._id, userId: user._id })
      return toChannelView(channel)
    }

    await ensureChannelMembership(ctx, { channelId: channel._id, userId: user._id, now: Date.now() })
    return toChannelView(channel)
  })
})

export const markChannelRead = mutation({
  args: {
    channelId: v.id("channels"),
    readThroughMessageId: v.id("messages")
  },
  handler: (ctx, args) => withDogfoodDiagnostics("markChannelRead", {
    channelId: args.channelId,
    readThroughMessageId: args.readThroughMessageId
  }, async () => {
    const user = await requireAllowedCurrentUser(ctx)
    const channel = await ctx.db.get(args.channelId)
    if (channel === null) throw new Error("Channel not found")

    await requireWorkspaceMember(ctx, { workspaceId: channel.workspaceId, userId: user._id })
    const membership = await ctx.db
      .query("channelMemberships")
      .withIndex("by_channel_user", (q) => q.eq("channelId", args.channelId).eq("userId", user._id))
      .unique()
    if (membership === null) throw new Error("Current user is not a member of this channel")

    const readThroughMessage = await ctx.db.get(args.readThroughMessageId)
    if (readThroughMessage === null || readThroughMessage.channelId !== args.channelId) {
      throw new Error("Read-through message not found in this channel")
    }

    if ((membership.lastReadAt ?? membership.createdAt) >= readThroughMessage.createdAt) {
      if (membership.mentionTrackingStartedAt === undefined) {
        await ctx.db.patch(membership._id, { mentionTrackingStartedAt: readThroughMessage.createdAt })
      }
      return toChannelView(channel)
    }
    await ctx.db.patch(membership._id, {
      lastReadAt: readThroughMessage.createdAt,
      ...(membership.mentionTrackingStartedAt === undefined
        ? { mentionTrackingStartedAt: readThroughMessage.createdAt }
        : {})
    })
    return toChannelView(channel)
  })
})

export const createChannel = mutation({
  args: {
    name: v.string(),
    visibility: v.optional(v.union(v.literal("public"), v.literal("private"))),
    initialMemberIds: v.optional(v.array(v.id("users")))
  },
  handler: (ctx, args) => withDogfoodDiagnostics("createChannel", {
    visibility: args.visibility ?? "public",
    nameLength: args.name.trim().length
  }, async () => {
    const user = await requireAllowedCurrentUser(ctx)
    const workspace = await getDefaultWorkspace(ctx)
    if (workspace === null) throw new Error("Workspace not found")

    await requireWorkspaceMember(ctx, { workspaceId: workspace._id, userId: user._id })

    const visibility = args.visibility ?? "public"
    const initialMemberIds = [...new Set(args.initialMemberIds ?? [])]
    if (visibility === "public" && initialMemberIds.length > 0) {
      throw new Error("Initial members can only be specified for private channels")
    }
    if (new Set<Id<"users">>([user._id, ...initialMemberIds]).size > MAX_PRIVATE_CHANNEL_MEMBERS) {
      throw new Error(`Private channels can contain at most ${MAX_PRIVATE_CHANNEL_MEMBERS} initial members`)
    }
    if (visibility === "private") {
      for (const userId of initialMemberIds) {
        await requireEligiblePrivateChannelMember(ctx, { workspaceId: workspace._id, userId })
      }
    }

    const name = validateChannelName(args.name)

    const key = channelKeyFromName(name)
    const existing = await ctx.db
      .query("channels")
      .withIndex("by_workspace_key", (q) => q.eq("workspaceId", workspace._id).eq("key", key))
      .unique()
    if (existing !== null) throw new Error("Channel already exists")

    const existingChannels = await ctx.db
      .query("channels")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .take(MAX_CHANNELS)
    if (existingChannels.length >= MAX_CHANNELS) {
      throw new Error(`Workspaces can contain at most ${MAX_CHANNELS} channels`)
    }

    const now = Date.now()
    const channelId = await ctx.db.insert("channels", {
      workspaceId: workspace._id,
      key,
      name,
      visibility,
      createdAt: now
    })

    await ctx.db.insert("channelMemberships", {
      channelId,
      userId: user._id,
      role: visibility === "private" ? "admin" : "member",
      createdAt: now,
      lastReadAt: now,
      mentionTrackingStartedAt: now
    })

    if (visibility === "private") {
      for (const userId of initialMemberIds) {
        if (userId === user._id) continue
        await ctx.db.insert("channelMemberships", {
          channelId,
          userId,
          role: "member",
          createdAt: now,
          lastReadAt: now,
          mentionTrackingStartedAt: now
        })
      }
    }

    const channel = await ctx.db.get(channelId)
    if (channel === null) throw new Error("Channel not found after insert")
    return toChannelView(channel)
  })
})

export const eligiblePrivateChannelMembers = query({
  args: {
    channelId: v.id("channels")
  },
  handler: (ctx, args) => withDogfoodDiagnostics("eligiblePrivateChannelMembers", {
    channelId: args.channelId
  }, async () => {
    const actor = await requireAllowedCurrentUser(ctx)
    const channel = await requirePrivateChannelAdmin(ctx, { channelId: args.channelId, userId: actor._id })
    const workspaceMemberships = await ctx.db
      .query("workspaceMemberships")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", channel.workspaceId))
      .take(MAX_ELIGIBLE_PRIVATE_CHANNEL_MEMBER_SCAN)
    const channelMemberships = await ctx.db
      .query("channelMemberships")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .take(MAX_PRIVATE_CHANNEL_MEMBERS)
    const existingUserIds = new Set(channelMemberships.map((membership) => membership.userId))
    const eligible: Array<{ readonly id: Id<"users">; readonly displayName: string }> = []

    for (const membership of workspaceMemberships) {
      if (existingUserIds.has(membership.userId)) continue
      const user = await ctx.db.get(membership.userId)
      if (user === null || !(await isEmailAllowlisted(ctx, user.email))) continue
      eligible.push({ id: user._id, displayName: user.displayName })
      if (eligible.length === MAX_ELIGIBLE_PRIVATE_CHANNEL_MEMBERS) break
    }

    return eligible.sort((left, right) => left.displayName.localeCompare(right.displayName))
  })
})

export const addPrivateChannelMember = mutation({
  args: {
    channelId: v.id("channels"),
    userId: v.id("users")
  },
  handler: (ctx, args) => withDogfoodDiagnostics("addPrivateChannelMember", {
    channelId: args.channelId,
    userId: args.userId
  }, async () => {
    const actor = await requireAllowedCurrentUser(ctx)
    const channel = await requirePrivateChannelAdmin(ctx, { channelId: args.channelId, userId: actor._id })
    await requireEligiblePrivateChannelMember(ctx, { workspaceId: channel.workspaceId, userId: args.userId })

    const existing = await ctx.db
      .query("channelMemberships")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channel._id).eq("userId", args.userId))
      .unique()
    if (existing !== null) return { channelId: channel._id, userId: args.userId, member: true }

    const memberships = await ctx.db
      .query("channelMemberships")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .take(MAX_PRIVATE_CHANNEL_MEMBERS)
    if (memberships.length >= MAX_PRIVATE_CHANNEL_MEMBERS) {
      throw new Error(`Private channels can contain at most ${MAX_PRIVATE_CHANNEL_MEMBERS} members`)
    }

    const now = Date.now()
    await ctx.db.insert("channelMemberships", {
      channelId: channel._id,
      userId: args.userId,
      role: "member",
      createdAt: now,
      lastReadAt: now,
      mentionTrackingStartedAt: now
    })
    return { channelId: channel._id, userId: args.userId, member: true }
  })
})

export const removePrivateChannelMember = mutation({
  args: {
    channelId: v.id("channels"),
    userId: v.id("users")
  },
  handler: (ctx, args) => withDogfoodDiagnostics("removePrivateChannelMember", {
    channelId: args.channelId,
    userId: args.userId
  }, async () => {
    const actor = await requireAllowedCurrentUser(ctx)
    const channel = await requirePrivateChannelAdmin(ctx, { channelId: args.channelId, userId: actor._id })
    await requireWorkspaceMember(ctx, { workspaceId: channel.workspaceId, userId: args.userId })
    const membership = await ctx.db
      .query("channelMemberships")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channel._id).eq("userId", args.userId))
      .unique()
    if (membership === null) return { channelId: channel._id, userId: args.userId, member: false }

    if (membership.role === "admin") {
      const memberships = await ctx.db
        .query("channelMemberships")
        .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
        .take(MAX_PRIVATE_CHANNEL_MEMBERS)
      if (!memberships.some((candidate) => candidate.role === "admin" && candidate._id !== membership._id)) {
        throw new Error("The last channel admin cannot be removed")
      }
    }

    await ctx.db.delete(membership._id)
    return { channelId: channel._id, userId: args.userId, member: false }
  })
})

export const channelMessages = query({
  args: {
    channelId: v.id("channels"),
    paginationOpts: paginationOptsValidator
  },
  handler: (ctx, args) => withDogfoodDiagnostics("channelMessages", { channelId: args.channelId }, async () => {
    const user = await requireAllowedCurrentUser(ctx)

    await requireChannelMember(ctx, { channelId: args.channelId, userId: user._id })

    if (!Number.isInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > MAX_MESSAGE_PAGE_SIZE) {
      throw new Error(`Message pages must contain between 1 and ${MAX_MESSAGE_PAGE_SIZE} items`)
    }

    const result = await ctx.db
      .query("messages")
      .withIndex("by_channel_created_at", (q) => q.eq("channelId", args.channelId))
      .order("desc")
      .paginate(args.paginationOpts)

    return {
      ...result,
      page: await toMessageViews(ctx, result.page, user._id)
    }
  })
})

export const searchChannelMessages = query({
  args: {
    channelId: v.id("channels"),
    query: v.string()
  },
  handler: (ctx, args) => withDogfoodDiagnostics("searchChannelMessages", {
    channelId: args.channelId,
    queryLength: args.query.trim().length
  }, async () => {
    const user = await requireAllowedCurrentUser(ctx)
    await requireChannelMember(ctx, { channelId: args.channelId, userId: user._id })

    const searchQuery = args.query.trim()
    if (searchQuery.length === 0) return []
    if (searchQuery.length > MAX_MESSAGE_SEARCH_QUERY_LENGTH) {
      throw new Error(`Search queries can contain at most ${MAX_MESSAGE_SEARCH_QUERY_LENGTH} characters`)
    }

    const messages = await ctx.db
      .query("messages")
      .withSearchIndex("search_body", (q) => q.search("body", searchQuery).eq("channelId", args.channelId))
      .take(MAX_MESSAGE_SEARCH_RESULTS)

    return toMessageViews(ctx, messages, user._id)
  })
})

export const channelMembers = query({
  args: {
    channelId: v.id("channels")
  },
  handler: (ctx, args) => withDogfoodDiagnostics("channelMembers", { channelId: args.channelId }, async () => {
    const user = await requireAllowedCurrentUser(ctx)

    const channel = await requireChannelMember(ctx, { channelId: args.channelId, userId: user._id })

    if (channel.visibility === "public") {
      return listWorkspaceMembers(ctx, channel.workspaceId)
    }

    return listChannelMembers(ctx, args.channelId)
  })
})

export const sendMessage = mutation({
  args: {
    channelId: v.id("channels"),
    body: v.string(),
    parentMessageId: v.optional(v.id("messages")),
    attachments: v.optional(v.array(messageAttachmentInput))
  },
  handler: (ctx, args) => withDogfoodDiagnostics("sendMessage", {
    channelId: args.channelId,
    parentMessageId: args.parentMessageId,
    bodyLength: args.body.trim().length,
    attachmentCount: args.attachments?.length ?? 0
  }, () => sendMessageTransaction(ctx, args))
})

export const editMessage = mutation({
  args: {
    channelId: v.id("channels"),
    messageId: v.id("messages"),
    body: v.string()
  },
  handler: (ctx, args) => withDogfoodDiagnostics("editMessage", {
    channelId: args.channelId,
    messageId: args.messageId,
    bodyLength: args.body.trim().length
  }, () => editMessageTransaction(ctx, args))
})

export const deleteMessage = mutation({
  args: {
    channelId: v.id("channels"),
    messageId: v.id("messages")
  },
  handler: (ctx, args) => withDogfoodDiagnostics("deleteMessage", {
    channelId: args.channelId,
    messageId: args.messageId
  }, () => deleteMessageTransaction(ctx, args))
})

export const toggleMessageReaction = mutation({
  args: {
    channelId: v.id("channels"),
    messageId: v.id("messages"),
    emoji: messageReactionEmoji
  },
  handler: (ctx, args) => withDogfoodDiagnostics("toggleMessageReaction", {
    channelId: args.channelId,
    messageId: args.messageId,
    emoji: args.emoji
  }, () => toggleMessageReactionTransaction(ctx, args))
})

const toChannelView = (channel: Doc<"channels">) => ({
  id: channel._id,
  key: channel.key,
  name: channel.name,
  visibility: channel.visibility,
  createdAt: channel.createdAt
})
