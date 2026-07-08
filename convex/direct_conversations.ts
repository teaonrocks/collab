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

const requireEligibleRecipient = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly workspaceId: Id<"workspaces">
    readonly actorId: Id<"users">
    readonly recipientId: Id<"users">
  }
) => {
  if (input.actorId === input.recipientId) throw new Error("Cannot start a direct conversation with yourself")
  const recipient = await ctx.db.get(input.recipientId)
  if (recipient === null || recipient.deletedAt !== undefined) throw new Error("Direct conversation recipient is not eligible")
  const membership = await ctx.db
    .query("workspaceMemberships")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", input.workspaceId).eq("userId", input.recipientId))
    .unique()
  if (membership === null || !(await isEmailAllowlisted(ctx, recipient.email))) {
    throw new Error("Direct conversation recipient is not eligible")
  }
  return recipient
}

const directParticipants = async (ctx: QueryCtx | MutationCtx, channelId: Id<"channels">) =>
  ctx.db.query("channelMemberships").withIndex("by_channel", (q) => q.eq("channelId", channelId)).take(3)

export const list = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const actor = await requireAllowedCurrentUser(ctx)
    await requireWorkspaceMember(ctx, { workspaceId: args.workspaceId, userId: actor._id })
    const memberships = await ctx.db
      .query("channelMemberships")
      .withIndex("by_user_and_workspace", (q) =>
        q.eq("userId", actor._id).eq("workspaceId", args.workspaceId))
      .take(MAX_DIRECT_CONVERSATIONS)
    const conversations = []
    for (const membership of memberships) {
      const channel = await ctx.db.get(membership.channelId)
      if (channel === null || channel.kind !== "direct" || channel.deletedAt !== undefined) continue
      const participants = await directParticipants(ctx, channel._id)
      if (participants.length !== 2) throw new Error("Direct conversation must have exactly two participants")
      const otherMembership = participants.find((candidate) => candidate.userId !== actor._id)
      if (otherMembership === undefined) throw new Error("Direct conversation participant invariant failed")
      const otherUser = await ctx.db.get(otherMembership.userId)
      if (otherUser === null || otherUser.deletedAt !== undefined) continue
      conversations.push(directConversationView(channel, otherUser))
    }
    return conversations.sort((a, b) => b.createdAt - a.createdAt)
  }
})

export const candidates = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const actor = await requireAllowedCurrentUser(ctx)
    await requireWorkspaceMember(ctx, { workspaceId: args.workspaceId, userId: actor._id })
    const memberships = await ctx.db
      .query("workspaceMemberships")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .take(MAX_DIRECT_CANDIDATE_SCAN)
    const eligible: Array<{ id: Id<"users">; displayName: string }> = []
    for (const membership of memberships) {
      if (membership.userId === actor._id) continue
      const user = await ctx.db.get(membership.userId)
      if (user === null || user.deletedAt !== undefined || !(await isEmailAllowlisted(ctx, user.email))) continue
      eligible.push({ id: user._id, displayName: user.displayName })
      if (eligible.length === MAX_DIRECT_CANDIDATES) break
    }
    return eligible.sort((a, b) => a.displayName.localeCompare(b.displayName))
  }
})

export const startOrReopen = mutation({
  args: { workspaceId: v.id("workspaces"), recipientUserId: v.id("users") },
  handler: async (ctx, args) => {
    const actor = await requireAllowedCurrentUser(ctx)
    await requireWorkspaceMember(ctx, { workspaceId: args.workspaceId, userId: actor._id })
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
