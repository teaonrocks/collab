import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import { isEmailAllowlisted, requireAllowedCurrentUser } from "./chat_access"

const MAX_USER_SEARCH_RESULTS = 20
const MAX_WORKSPACE_SCAN = 100
const usernamePattern = /^[a-z0-9_]{3,32}$/

export type DirectMessagePreference = "all" | "mutuals" | "friends"

export const canonicalPairKey = (left: Id<"users">, right: Id<"users">): string =>
  [left, right].sort((a, b) => String(a).localeCompare(String(b))).join(":")

const normalizeUsername = (rawUsername: string): string => rawUsername.trim().replace(/^@+/, "").toLowerCase()

const validateUsername = (rawUsername: string): string => {
  const username = normalizeUsername(rawUsername)
  if (!usernamePattern.test(username)) {
    throw new Error("Usernames must be 3–32 lowercase letters, numbers, or underscores")
  }
  return username
}

const usernameBaseFromEmail = (email: string): string => {
  const localPart = email.split("@", 1)[0] ?? "user"
  const normalized = localPart.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "")
  return (normalized.length >= 3 ? normalized : `user_${normalized}`).slice(0, 28)
}

export const seededUsername = async (ctx: QueryCtx | MutationCtx, email: string): Promise<string> => {
  const base = usernameBaseFromEmail(email)
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base.slice(0, 32 - String(suffix).length - 1)}_${suffix}`
    const existing = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", candidate)).unique()
    if (existing === null) return candidate
  }
  throw new Error("Could not allocate a username")
}

export const effectiveDirectMessagePreference = (user: Doc<"users">): DirectMessagePreference =>
  user.directMessagePreference ?? "mutuals"

export const areFriends = async (
  ctx: QueryCtx | MutationCtx,
  left: Id<"users">,
  right: Id<"users">
): Promise<boolean> => {
  const request = await ctx.db.query("friendRequests")
    .withIndex("by_pair_key", (q) => q.eq("pairKey", canonicalPairKey(left, right)))
    .unique()
  return request?.status === "accepted"
}

export const shareWorkspace = async (
  ctx: QueryCtx | MutationCtx,
  left: Id<"users">,
  right: Id<"users">
): Promise<boolean> => {
  const memberships = await ctx.db.query("workspaceMemberships")
    .withIndex("by_user", (q) => q.eq("userId", left)).take(MAX_WORKSPACE_SCAN)
  for (const membership of memberships) {
    const otherMembership = await ctx.db.query("workspaceMemberships")
      .withIndex("by_workspace_user", (q) => q.eq("workspaceId", membership.workspaceId).eq("userId", right))
      .unique()
    if (otherMembership !== null) return true
  }
  return false
}

export const canStartDirectMessage = async (
  ctx: QueryCtx | MutationCtx,
  senderId: Id<"users">,
  recipient: Doc<"users">
): Promise<boolean> => {
  if (recipient.deletedAt !== undefined || !(await isEmailAllowlisted(ctx, recipient.email))) return false
  switch (effectiveDirectMessagePreference(recipient)) {
    case "all": return true
    case "friends": return areFriends(ctx, senderId, recipient._id)
    case "mutuals": return shareWorkspace(ctx, senderId, recipient._id)
  }
}

const toUserView = (user: Doc<"users">) => ({
  id: user._id,
  displayName: user.displayName,
  username: user.username ?? null
})

export const profile = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAllowedCurrentUser(ctx)
    return { ...toUserView(user), directMessagePreference: effectiveDirectMessagePreference(user) }
  }
})

export const updateProfile = mutation({
  args: {
    username: v.optional(v.string()),
    directMessagePreference: v.optional(v.union(v.literal("all"), v.literal("mutuals"), v.literal("friends")))
  },
  handler: async (ctx, args) => {
    const user = await requireAllowedCurrentUser(ctx)
    const patch: { username?: string; directMessagePreference?: DirectMessagePreference } = {}
    if (args.username !== undefined) {
      const username = validateUsername(args.username)
      const existing = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", username)).unique()
      if (existing !== null && existing._id !== user._id) throw new Error("That username is already taken")
      patch.username = username
    }
    if (args.directMessagePreference !== undefined) patch.directMessagePreference = args.directMessagePreference
    if (Object.keys(patch).length > 0) await ctx.db.patch(user._id, patch)
    const updated = await ctx.db.get(user._id)
    if (updated === null) throw new Error("Current user was not found")
    return { ...toUserView(updated), directMessagePreference: effectiveDirectMessagePreference(updated) }
  }
})

export const searchUsers = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireAllowedCurrentUser(ctx)
    const search = normalizeUsername(args.query)
    if (search.length === 0) return []
    const users = await ctx.db.query("users").withSearchIndex("search_username", (q) => q.search("username", search)).take(MAX_USER_SEARCH_RESULTS)
    const results = []
    for (const user of users) {
      if (user._id === actor._id || user.deletedAt !== undefined || !(await isEmailAllowlisted(ctx, user.email))) continue
      const request = await ctx.db.query("friendRequests")
        .withIndex("by_pair_key", (q) => q.eq("pairKey", canonicalPairKey(actor._id, user._id))).unique()
      results.push({
        ...toUserView(user),
        friendship: request?.status ?? null,
        canStartDirectMessage: await canStartDirectMessage(ctx, actor._id, user)
      })
    }
    return results
  }
})

export const sendFriendRequest = mutation({
  args: { recipientUserId: v.id("users") },
  handler: async (ctx, args) => {
    const requester = await requireAllowedCurrentUser(ctx)
    if (requester._id === args.recipientUserId) throw new Error("Cannot send a friend request to yourself")
    const recipient = await ctx.db.get(args.recipientUserId)
    if (recipient === null || recipient.deletedAt !== undefined || !(await isEmailAllowlisted(ctx, recipient.email))) {
      throw new Error("Friend request recipient is not available")
    }
    const pairKey = canonicalPairKey(requester._id, recipient._id)
    const existing = await ctx.db.query("friendRequests").withIndex("by_pair_key", (q) => q.eq("pairKey", pairKey)).unique()
    if (existing?.status === "accepted") return { id: existing._id, status: existing.status }
    if (existing?.status === "pending") return { id: existing._id, status: existing.status }
    const now = Date.now()
    if (existing !== null) {
      await ctx.db.patch(existing._id, { requesterUserId: requester._id, recipientUserId: recipient._id, status: "pending", createdAt: now, respondedAt: undefined })
      return { id: existing._id, status: "pending" as const }
    }
    const id = await ctx.db.insert("friendRequests", { pairKey, requesterUserId: requester._id, recipientUserId: recipient._id, status: "pending", createdAt: now })
    return { id, status: "pending" as const }
  }
})

export const respondToFriendRequest = mutation({
  args: { friendRequestId: v.id("friendRequests"), accept: v.boolean() },
  handler: async (ctx, args) => {
    const recipient = await requireAllowedCurrentUser(ctx)
    const request = await ctx.db.get(args.friendRequestId)
    if (request === null || request.recipientUserId !== recipient._id || request.status !== "pending") {
      throw new Error("Friend request is not available")
    }
    const status = args.accept ? "accepted" as const : "declined" as const
    await ctx.db.patch(request._id, { status, respondedAt: Date.now() })
    return { id: request._id, status }
  }
})

export const incomingFriendRequests = query({
  args: {},
  handler: async (ctx) => {
    const recipient = await requireAllowedCurrentUser(ctx)
    const requests = await ctx.db.query("friendRequests")
      .withIndex("by_recipient_and_status", (q) => q.eq("recipientUserId", recipient._id).eq("status", "pending"))
      .take(MAX_USER_SEARCH_RESULTS)
    const results = []
    for (const request of requests) {
      const requester = await ctx.db.get(request.requesterUserId)
      if (requester !== null && requester.deletedAt === undefined) results.push({ id: request._id, requester: toUserView(requester), createdAt: request.createdAt })
    }
    return results
  }
})
