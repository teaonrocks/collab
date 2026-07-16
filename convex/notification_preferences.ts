import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { internal } from "./_generated/api"
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server"
import { requireAllowedCurrentUser, requireChannelMember } from "./chat_access"

const MAX_NOTIFICATION_EVENTS = 100
const NOTIFICATION_PREVIEW_LENGTH = 180
export const NOTIFICATION_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

export type ConversationNotificationMode = Doc<"conversationNotificationPreferences">["mode"]

const notificationMode = v.union(v.literal("all"), v.literal("mentions"), v.literal("off"))

const defaultMode = (channel: Doc<"channels">): ConversationNotificationMode =>
  channel.kind === "direct" ? "all" : "mentions"

const preferenceFor = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  channel: Doc<"channels">
): Promise<ConversationNotificationMode> => {
  const preference = await ctx.db
    .query("conversationNotificationPreferences")
    .withIndex("by_user_and_channel", (q) => q.eq("userId", userId).eq("channelId", channel._id))
    .unique()
  return preference?.mode ?? defaultMode(channel)
}

const messagePreview = (message: Doc<"messages">): string => {
  const body = message.body.replace(/\s+/g, " ").trim()
  const fallback = (message.attachments?.length ?? 0) > 1 ? "Sent attachments" : "Sent an attachment"
  const value = body.length === 0 ? fallback : body
  return value.length <= NOTIFICATION_PREVIEW_LENGTH
    ? value
    : `${value.slice(0, NOTIFICATION_PREVIEW_LENGTH - 3)}...`
}

export const preference = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, args) => {
    const user = await requireAllowedCurrentUser(ctx)
    const channel = await requireChannelMember(ctx, { channelId: args.channelId, userId: user._id })
    if (channel.deletedAt !== undefined) throw new Error("Channel not found")
    const saved = await ctx.db
      .query("conversationNotificationPreferences")
      .withIndex("by_user_and_channel", (q) => q.eq("userId", user._id).eq("channelId", channel._id))
      .unique()
    return {
      mode: saved?.mode ?? defaultMode(channel),
      options: channel.kind === "direct"
        ? (["all", "off"] as const)
        : (["all", "mentions", "off"] as const)
    }
  }
})

export const updatePreference = mutation({
  args: {
    channelId: v.id("channels"),
    mode: notificationMode
  },
  handler: async (ctx, args) => {
    const user = await requireAllowedCurrentUser(ctx)
    const channel = await requireChannelMember(ctx, { channelId: args.channelId, userId: user._id })
    if (channel.deletedAt !== undefined) throw new Error("Channel not found")
    if (channel.kind === "direct" && args.mode === "mentions") {
      throw new Error("Direct conversations do not support mention-only notifications")
    }
    const existing = await ctx.db
      .query("conversationNotificationPreferences")
      .withIndex("by_user_and_channel", (q) => q.eq("userId", user._id).eq("channelId", channel._id))
      .unique()
    const updatedAt = Date.now()
    if (existing === null) {
      await ctx.db.insert("conversationNotificationPreferences", {
        userId: user._id,
        channelId: channel._id,
        mode: args.mode,
        updatedAt
      })
    } else {
      await ctx.db.patch(existing._id, { mode: args.mode, updatedAt })
    }
    return {
      mode: args.mode,
      options: channel.kind === "direct"
        ? (["all", "off"] as const)
        : (["all", "mentions", "off"] as const)
    }
  }
})

export const openFeed = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireAllowedCurrentUser(ctx)
    const state = await ctx.db
      .query("messageNotificationFeedStates")
      .withIndex("by_recipient", (q) => q.eq("recipientUserId", user._id))
      .unique()
    return { cursor: state?.latestSequence ?? 0 }
  }
})

export const feed = query({
  args: { cursor: v.number() },
  handler: async (ctx, args) => {
    const user = await requireAllowedCurrentUser(ctx)
    const events = await ctx.db
      .query("messageNotificationEvents")
      .withIndex("by_recipient_and_sequence", (q) =>
        q.eq("recipientUserId", user._id).gt("sequence", args.cursor))
      .order("asc")
      .take(MAX_NOTIFICATION_EVENTS)
    const notifications = []
    for (const event of events) {
      const [message, channel, membership] = await Promise.all([
        ctx.db.get(event.messageId),
        ctx.db.get(event.channelId),
        ctx.db.query("channelMemberships")
          .withIndex("by_channel_user", (q) => q.eq("channelId", event.channelId).eq("userId", user._id))
          .unique()
      ])
      if (
        message === null ||
        channel === null ||
        channel.deletedAt !== undefined ||
        membership === null ||
        message.authorUserId === user._id
      ) continue
      const direct = channel.kind === "direct"
      notifications.push({
        id: event._id,
        messageId: message._id,
        channelId: channel._id,
        conversationKind: direct ? "direct" as const : "channel" as const,
        title: direct ? message.authorDisplayName ?? "Direct message" : `#${channel.name}`,
        body: direct
          ? messagePreview(message)
          : `${message.authorDisplayName ?? "Someone"}: ${messagePreview(message)}`,
        createdAt: event.createdAt
      })
    }
    return {
      cursor: events.at(-1)?.sequence ?? args.cursor,
      notifications
    }
  }
})

export const cleanupNotificationEvent = internalMutation({
  args: { eventId: v.id("messageNotificationEvents") },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId)
    if (event !== null) await ctx.db.delete(event._id)
    return null
  }
})

export const queueMessageNotifications = async (
  ctx: MutationCtx,
  input: {
    readonly channel: Doc<"channels">
    readonly message: Doc<"messages">
    readonly mentionedUserIds: ReadonlySet<Id<"users">>
  }
): Promise<void> => {
  const memberships = await ctx.db
    .query("channelMemberships")
    .withIndex("by_channel", (q) => q.eq("channelId", input.channel._id))
    .collect()
  for (const membership of memberships) {
    if (membership.userId === input.message.authorUserId) continue
    const mode = await preferenceFor(ctx, membership.userId, input.channel)
    if (mode === "off" || (mode === "mentions" && !input.mentionedUserIds.has(membership.userId))) continue
    const state = await ctx.db
      .query("messageNotificationFeedStates")
      .withIndex("by_recipient", (q) => q.eq("recipientUserId", membership.userId))
      .unique()
    const sequence = (state?.latestSequence ?? 0) + 1
    if (state === null) {
      await ctx.db.insert("messageNotificationFeedStates", {
        recipientUserId: membership.userId,
        latestSequence: sequence
      })
    } else {
      await ctx.db.patch(state._id, { latestSequence: sequence })
    }
    const eventId = await ctx.db.insert("messageNotificationEvents", {
      recipientUserId: membership.userId,
      channelId: input.channel._id,
      messageId: input.message._id,
      sequence,
      createdAt: input.message.createdAt,
      expiresAt: Date.now() + NOTIFICATION_EVENT_RETENTION_MS
    })
    await ctx.scheduler.runAfter(
      NOTIFICATION_EVENT_RETENTION_MS,
      internal.notification_preferences.cleanupNotificationEvent,
      { eventId }
    )
  }
}
