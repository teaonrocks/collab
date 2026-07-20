import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import { isEmailAllowlisted, requireAllowedCurrentUser, requireChannelMember } from "./chat_access"
import { canStartDirectMessage, canonicalPairKey } from "./social"

const MAX_DIRECT_CONVERSATIONS = 100

export const listDirectConversationRecords = async (ctx: QueryCtx, actorId: Id<"users">) => {
  const memberships = await ctx.db
    .query("channelMemberships")
    .withIndex("by_user_and_channel_kind", (q) => q.eq("userId", actorId).eq("channelKind", "direct"))
    .take(MAX_DIRECT_CONVERSATIONS)
  const conversations: Array<{
    readonly channel: Doc<"channels">
    readonly membership: Doc<"channelMemberships">
    readonly otherUser: Doc<"users">
  }> = []
  for (const membership of memberships) {
    const channel = await ctx.db.get(membership.channelId)
    if (channel === null || channel.kind !== "direct" || channel.deletedAt !== undefined) continue
    const participants = await directParticipants(ctx, channel._id)
    if (participants.length !== 2) throw new Error("Direct conversation must have exactly two participants")
    const otherMembership = participants.find((candidate) => candidate.userId !== actorId)
    if (otherMembership === undefined) throw new Error("Direct conversation participant invariant failed")
    const otherEligibility = await directEligibility(ctx, { userId: otherMembership.userId })
    if (otherEligibility === null) continue
    conversations.push({ channel, membership, otherUser: otherEligibility.user })
  }
  return conversations.sort((a, b) => b.channel.createdAt - a.channel.createdAt)
}

const directConversationView = (channel: Doc<"channels">, otherUser: Doc<"users">) => ({
  id: channel._id,
  otherUser: {
    id: otherUser._id,
    displayName: otherUser.displayName,
    ...(otherUser.username === undefined ? {} : { username: otherUser.username })
  },
  createdAt: channel.createdAt
})

const directEligibility = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly userId: Id<"users">
  }
) => {
  const user = await ctx.db.get(input.userId)
  if (user === null || user.deletedAt !== undefined) return null
  if (!(await isEmailAllowlisted(ctx, user.email))) {
    return null
  }
  return { user }
}

const requireEligibleRecipient = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly actorId: Id<"users">
    readonly recipientId: Id<"users">
  }
) => {
  if (input.actorId === input.recipientId) throw new Error("Cannot start a direct conversation with yourself")
  const eligible = await directEligibility(ctx, { userId: input.recipientId })
  if (eligible === null) {
    throw new Error("Direct conversation recipient is not eligible")
  }
  return eligible.user
}

const directParticipants = async (ctx: QueryCtx | MutationCtx, channelId: Id<"channels">) =>
  ctx.db
    .query("channelMemberships")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .take(3)

const ensureDirectMembershipTags = async (
  ctx: MutationCtx,
  participants: Awaited<ReturnType<typeof directParticipants>>
) => {
  for (const participant of participants) {
    if (participant.channelKind !== "direct") await ctx.db.patch(participant._id, { channelKind: "direct" })
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireAllowedCurrentUser(ctx)
    const conversations = await listDirectConversationRecords(ctx, actor._id)
    return conversations.map(({ channel, otherUser }) => directConversationView(channel, otherUser))
  }
})

export const startOrReopen = mutation({
  args: { recipientUserId: v.id("users") },
  handler: async (ctx, args) => {
    const actor = await requireAllowedCurrentUser(ctx)
    const recipient = await requireEligibleRecipient(ctx, {
      actorId: actor._id,
      recipientId: args.recipientUserId
    })
    const pairKey = canonicalPairKey(actor._id, recipient._id)
    const existingConversations = await ctx.db
      .query("channels")
      .withIndex("by_direct_pair_key", (q) => q.eq("directPairKey", pairKey))
      .take(2)
    if (existingConversations.length > 1) {
      throw new Error("Duplicate direct conversations must be migrated before reopening")
    }
    const existing = existingConversations[0] ?? null
    if (existing !== null) {
      if (existing.kind !== "direct") throw new Error("Direct conversation identity is already in use")
      const participants = await directParticipants(ctx, existing._id)
      const participantIds = new Set(participants.map((participant) => participant.userId))
      if (participants.length !== 2 || !participantIds.has(actor._id) || !participantIds.has(recipient._id)) {
        throw new Error("Direct conversation must have exactly two participants")
      }
      await ensureDirectMembershipTags(ctx, participants)
      if (existing.deletedAt !== undefined) await ctx.db.patch(existing._id, { deletedAt: undefined })
      return directConversationView(existing, recipient)
    }
    if (!(await canStartDirectMessage(ctx, actor._id, recipient))) {
      throw new Error("This user is not accepting new direct messages from you")
    }

    const now = Date.now()
    const channelId = await ctx.db.insert("channels", {
      key: `direct-${pairKey}`,
      name: "Direct conversation",
      visibility: "private",
      kind: "direct",
      directPairKey: pairKey,
      createdByUserId: actor._id,
      createdAt: now
    })
    for (const userId of [actor._id, recipient._id]) {
      await ctx.db.insert("channelMemberships", {
        channelId,
        channelKind: "direct",
        userId,
        role: "member",
        createdAt: now,
        lastReadAt: now
      })
    }
    const channel = await requireChannelMember(ctx, { channelId, userId: actor._id })
    return directConversationView(channel, recipient)
  }
})
