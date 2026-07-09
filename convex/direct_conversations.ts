import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import {
  isEmailAllowlisted,
  requireAllowedCurrentUser,
  requireChannelMember,
  requireWorkspaceMember
} from "./chat_access"

const MAX_DIRECT_CONVERSATIONS = 100
const MAX_DIRECT_CANDIDATE_SCAN = 200
const MAX_DIRECT_CANDIDATES = 100

const canonicalPairKey = (left: Id<"users">, right: Id<"users">): string =>
  [left, right].sort((a, b) => String(a).localeCompare(String(b))).join(":")

const directConversationView = (
  channel: Doc<"channels">,
  otherUser: Doc<"users">
) => ({
  id: channel._id,
  workspaceId: channel.workspaceId,
  otherUser: { id: otherUser._id, displayName: otherUser.displayName },
  createdAt: channel.createdAt
})

const directEligibility = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly workspaceId: Id<"workspaces">
    readonly userId: Id<"users">
  }
) => {
  const user = await ctx.db.get(input.userId)
  if (user === null || user.deletedAt !== undefined) return null
  const membership = await ctx.db
    .query("workspaceMemberships")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", input.workspaceId).eq("userId", input.userId))
    .unique()
  if (membership === null || membership.role === "guest" || !(await isEmailAllowlisted(ctx, user.email))) {
    return null
  }
  return { user, membership }
}

const requireDirectEligibleActor = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly workspaceId: Id<"workspaces">
    readonly userId: Id<"users">
  }
) => {
  const membership = await requireWorkspaceMember(ctx, input)
  if (membership.role === "guest") throw new Error("Current user is not eligible for direct conversations")
  return membership
}

const requireEligibleRecipient = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly workspaceId: Id<"workspaces">
    readonly actorId: Id<"users">
    readonly recipientId: Id<"users">
  }
) => {
  if (input.actorId === input.recipientId) throw new Error("Cannot start a direct conversation with yourself")
  const eligible = await directEligibility(ctx, { workspaceId: input.workspaceId, userId: input.recipientId })
  if (eligible === null) {
    throw new Error("Direct conversation recipient is not eligible")
  }
  return eligible.user
}

const directParticipants = async (ctx: QueryCtx | MutationCtx, channelId: Id<"channels">) =>
  ctx.db.query("channelMemberships").withIndex("by_channel", (q) => q.eq("channelId", channelId)).take(3)

const ensureDirectMembershipTags = async (
  ctx: MutationCtx,
  participants: Awaited<ReturnType<typeof directParticipants>>
) => {
  for (const participant of participants) {
    if (participant.channelKind !== "direct") await ctx.db.patch(participant._id, { channelKind: "direct" })
  }
}

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const actor = await requireAllowedCurrentUser(ctx)
    await requireDirectEligibleActor(ctx, { workspaceId: args.workspaceId, userId: actor._id })
    const memberships = await ctx.db
      .query("channelMemberships")
      .withIndex("by_user_workspace_and_channel_kind", (q) =>
        q.eq("userId", actor._id).eq("workspaceId", args.workspaceId).eq("channelKind", "direct"))
      .take(MAX_DIRECT_CONVERSATIONS)
    const conversations = []
    for (const membership of memberships) {
      const channel = await ctx.db.get(membership.channelId)
      if (channel === null || channel.kind !== "direct" || channel.deletedAt !== undefined) continue
      const participants = await directParticipants(ctx, channel._id)
      if (participants.length !== 2) throw new Error("Direct conversation must have exactly two participants")
      const otherMembership = participants.find((candidate) => candidate.userId !== actor._id)
      if (otherMembership === undefined) throw new Error("Direct conversation participant invariant failed")
      const otherEligibility = await directEligibility(ctx, {
        workspaceId: args.workspaceId,
        userId: otherMembership.userId
      })
      if (otherEligibility === null) continue
      conversations.push(directConversationView(channel, otherEligibility.user))
    }
    return conversations.sort((a, b) => b.createdAt - a.createdAt)
  }
})

export const candidates = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const actor = await requireAllowedCurrentUser(ctx)
    await requireDirectEligibleActor(ctx, { workspaceId: args.workspaceId, userId: actor._id })
    const memberships = await ctx.db
      .query("workspaceMemberships")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(MAX_DIRECT_CANDIDATE_SCAN)
    const eligible: Array<{ id: Id<"users">; displayName: string }> = []
    for (const membership of memberships) {
      if (membership.userId === actor._id) continue
      if (membership.role === "guest") continue
      const candidate = await directEligibility(ctx, {
        workspaceId: args.workspaceId,
        userId: membership.userId
      })
      if (candidate === null) continue
      eligible.push({ id: candidate.user._id, displayName: candidate.user.displayName })
      if (eligible.length === MAX_DIRECT_CANDIDATES) break
    }
    return eligible.sort((a, b) => a.displayName.localeCompare(b.displayName))
  }
})

export const startOrReopen = mutation({
  args: { workspaceId: v.id("workspaces"), recipientUserId: v.id("users") },
  handler: async (ctx, args) => {
    const actor = await requireAllowedCurrentUser(ctx)
    await requireDirectEligibleActor(ctx, { workspaceId: args.workspaceId, userId: actor._id })
    const recipient = await requireEligibleRecipient(ctx, {
      workspaceId: args.workspaceId,
      actorId: actor._id,
      recipientId: args.recipientUserId
    })
    const pairKey = canonicalPairKey(actor._id, recipient._id)
    const existing = await ctx.db
      .query("channels")
      .withIndex("by_workspace_and_direct_pair_key", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("directPairKey", pairKey))
      .unique()
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

    const now = Date.now()
    const channelId = await ctx.db.insert("channels", {
      workspaceId: args.workspaceId,
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
        workspaceId: args.workspaceId,
        channelKind: "direct",
        userId,
        role: "member",
        createdAt: now,
        lastReadAt: now,
        mentionTrackingStartedAt: now
      })
    }
    const channel = await requireChannelMember(ctx, { channelId, userId: actor._id })
    return directConversationView(channel, recipient)
  }
})
