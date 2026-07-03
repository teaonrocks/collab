import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

const MESSAGE_REACTION_EMOJIS = ["👍", "🎉", "👀"] as const
const MESSAGE_PARENT_PREVIEW_MAX_LENGTH = 120
const MAX_BATCHED_REACTION_ROWS = 5_000

export type MessageView = {
  readonly id: Doc<"messages">["_id"]
  readonly channelId: Doc<"messages">["channelId"]
  readonly authorUserId: Doc<"messages">["authorUserId"]
  readonly authorDisplayName: string
  readonly body: string
  readonly parentMessageId: Id<"messages"> | null
  readonly parentMessage: {
    readonly id: Id<"messages">
    readonly authorDisplayName: string
    readonly bodyPreview: string
    readonly deleted: boolean
  } | null
  readonly createdAt: number
  readonly editedAt: number | null
  readonly reactions: ReadonlyArray<{
    readonly emoji: string
    readonly count: number
    readonly reactedByCurrentUser: boolean
  }>
  readonly attachments: ReadonlyArray<{
    readonly storageId: Id<"_storage">
    readonly name: string
    readonly contentType: string
    readonly size: number
    readonly kind: "file" | "image"
    readonly url: string | null
  }>
}

type ReactionRow = Doc<"messageReactions">
type ReactionCount = { userIds: Set<Id<"users">>; reactedByCurrentUser: boolean }

const messageReactionRank = (emoji: string): number => {
  const index = MESSAGE_REACTION_EMOJIS.findIndex((candidate) => candidate === emoji)
  return index === -1 ? MESSAGE_REACTION_EMOJIS.length : index
}

export const aggregateReactionRows = (
  reactions: ReadonlyArray<ReactionRow>,
  currentUserId: Id<"users">
) => {
  const counts = new Map<string, ReactionCount>()

  for (const reaction of reactions) {
    const existing: ReactionCount = counts.get(reaction.emoji) ?? {
      userIds: new Set(),
      reactedByCurrentUser: false
    }
    existing.userIds.add(reaction.userId)
    counts.set(reaction.emoji, {
      userIds: existing.userIds,
      reactedByCurrentUser: existing.reactedByCurrentUser || reaction.userId === currentUserId
    })
  }

  return Array.from(counts, ([emoji, state]) => ({
    emoji,
    count: state.userIds.size,
    reactedByCurrentUser: state.reactedByCurrentUser
  })).sort((left, right) =>
    messageReactionRank(left.emoji) - messageReactionRank(right.emoji) ||
    left.emoji.localeCompare(right.emoji)
  )
}

const reactionsForMessage = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly messageId: Id<"messages">
    readonly currentUserId: Id<"users">
  }
) => {
  const reactions = await ctx.db
    .query("messageReactions")
    .withIndex("by_message", (q) => q.eq("messageId", input.messageId))
    .collect()
  return aggregateReactionRows(reactions, input.currentUserId)
}

const reactionsForMessages = async (
  ctx: QueryCtx | MutationCtx,
  messages: ReadonlyArray<Doc<"messages">>,
  currentUserId: Id<"users">
): Promise<Map<Id<"messages">, ReturnType<typeof aggregateReactionRows>>> => {
  const byMessageId = new Map<Id<"messages">, ReturnType<typeof aggregateReactionRows>>()
  if (messages.length === 0) return byMessageId
  if (messages.length === 1) {
    byMessageId.set(messages[0]!._id, await reactionsForMessage(ctx, {
      messageId: messages[0]!._id,
      currentUserId
    }))
    return byMessageId
  }

  const batchReady = messages.filter((message) => message.reactionBatchReady === true)
  const fallback = messages.filter((message) => message.reactionBatchReady !== true)
  if (batchReady.length > 0) {
    const channelId = batchReady[0]!.channelId
    const createdAt = batchReady.map((message) => message.createdAt)
    const messageIds = new Set(batchReady.map((message) => message._id))
    const rows = await ctx.db
      .query("messageReactions")
      .withIndex("by_channel_and_message_created_at", (q) =>
        q.eq("channelId", channelId)
          .gte("messageCreatedAt", Math.min(...createdAt))
          .lte("messageCreatedAt", Math.max(...createdAt))
      )
      .take(MAX_BATCHED_REACTION_ROWS + 1)

    if (rows.length <= MAX_BATCHED_REACTION_ROWS) {
      const rowsByMessageId = new Map<Id<"messages">, Array<ReactionRow>>()
      for (const row of rows) {
        if (!messageIds.has(row.messageId)) continue
        const messageRows = rowsByMessageId.get(row.messageId) ?? []
        messageRows.push(row)
        rowsByMessageId.set(row.messageId, messageRows)
      }
      for (const message of batchReady) {
        byMessageId.set(
          message._id,
          aggregateReactionRows(rowsByMessageId.get(message._id) ?? [], currentUserId)
        )
      }
    } else {
      fallback.push(...batchReady)
    }
  }

  const fallbackReactions = await Promise.all(fallback.map(async (message) => [
    message._id,
    await reactionsForMessage(ctx, { messageId: message._id, currentUserId })
  ] as const))
  fallbackReactions.forEach(([messageId, reactions]) => byMessageId.set(messageId, reactions))
  return byMessageId
}

export const trimParentPreview = (body: string): string => {
  const normalized = body.replace(/\s+/g, " ").trim()
  if (normalized.length <= MESSAGE_PARENT_PREVIEW_MAX_LENGTH) return normalized
  return `${normalized.slice(0, MESSAGE_PARENT_PREVIEW_MAX_LENGTH - 3)}...`
}

const attachmentsForMessage = async (
  ctx: QueryCtx | MutationCtx,
  message: Doc<"messages">
) => {
  const attachments = message.attachments ?? []
  const views: Array<{
    readonly storageId: Id<"_storage">
    readonly name: string
    readonly contentType: string
    readonly size: number
    readonly kind: "file" | "image"
    readonly url: string | null
  }> = []

  for (const attachment of attachments) {
    views.push({
      ...attachment,
      url: await ctx.storage.getUrl(attachment.storageId)
    })
  }

  return views
}

export const toMessageViews = async (
  ctx: QueryCtx | MutationCtx,
  messages: ReadonlyArray<Doc<"messages">>,
  currentUserId: Id<"users">
): Promise<Array<MessageView>> => {
  const authorNamesById = new Map<Id<"users">, string>()
  const reactionsByMessageId = new Map<Id<"messages">, Awaited<ReturnType<typeof reactionsForMessage>>>()
  const attachmentsByMessageId = new Map<Id<"messages">, Awaited<ReturnType<typeof attachmentsForMessage>>>()
  const parentsById = new Map<Id<"messages">, Doc<"messages"> | null>()

  const missingAuthorIds = Array.from(new Set(
    messages.filter((message) => message.authorDisplayName === undefined).map((message) => message.authorUserId)
  ))
  const parentIds = Array.from(new Set(
    messages.flatMap((message) => message.parentMessageId === undefined ? [] : [message.parentMessageId])
  ))

  const [authors, reactionsByMessage, attachmentViews, parents] = await Promise.all([
    Promise.all(missingAuthorIds.map(async (authorId) => [authorId, await ctx.db.get(authorId)] as const)),
    reactionsForMessages(ctx, messages, currentUserId),
    Promise.all(messages.map(async (message) => [message._id, await attachmentsForMessage(ctx, message)] as const)),
    Promise.all(parentIds.map(async (parentId) => [parentId, await ctx.db.get(parentId)] as const))
  ])

  authors.forEach(([authorId, author]) => authorNamesById.set(authorId, author?.displayName ?? "Unknown"))
  reactionsByMessage.forEach((messageReactions, messageId) =>
    reactionsByMessageId.set(messageId, messageReactions)
  )
  attachmentViews.forEach(([messageId, attachments]) =>
    attachmentsByMessageId.set(messageId, attachments)
  )
  parents.forEach(([parentId, parent]) => parentsById.set(parentId, parent))

  const missingParentAuthorIds = Array.from(new Set(
    parents.flatMap(([, parent]) =>
      parent !== null && parent.authorDisplayName === undefined && !authorNamesById.has(parent.authorUserId)
        ? [parent.authorUserId]
        : []
    )
  ))
  const parentAuthors = await Promise.all(
    missingParentAuthorIds.map(async (authorId) => [authorId, await ctx.db.get(authorId)] as const)
  )
  parentAuthors.forEach(([authorId, author]) =>
    authorNamesById.set(authorId, author?.displayName ?? "Unknown")
  )

  return messages.map((message) => {
    const parent = message.parentMessageId === undefined
      ? null
      : parentsById.get(message.parentMessageId) ?? null
    return {
      id: message._id,
      channelId: message.channelId,
      authorUserId: message.authorUserId,
      authorDisplayName: message.authorDisplayName ?? authorNamesById.get(message.authorUserId) ?? "Unknown",
      body: message.body,
      parentMessageId: message.parentMessageId ?? null,
      parentMessage: message.parentMessageId === undefined
        ? null
        : parent === null
          ? {
            id: message.parentMessageId,
            authorDisplayName: "Original message",
            bodyPreview: "",
            deleted: true
          }
          : {
            id: parent._id,
            authorDisplayName: parent.authorDisplayName ?? authorNamesById.get(parent.authorUserId) ?? "Unknown",
            bodyPreview: trimParentPreview(parent.body),
            deleted: false
          },
      createdAt: message.createdAt,
      editedAt: message.editedAt ?? null,
      reactions: reactionsByMessageId.get(message._id) ?? [],
      attachments: attachmentsByMessageId.get(message._id) ?? []
    }
  })
}

export const toMessageView = async (
  ctx: QueryCtx | MutationCtx,
  message: Doc<"messages">,
  currentUserId: Id<"users">
): Promise<MessageView> => {
  const [view] = await toMessageViews(ctx, [message], currentUserId)
  return view!
}
