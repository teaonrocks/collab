import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"

const DOGFOOD_WORKSPACE_KEY = "aether-dogfood"
const DOGFOOD_WORKSPACE_NAME = "Aether Dogfood"
const DOGFOOD_CHANNEL_KEY = "general"
const DOGFOOD_CHANNEL_NAME = "general"

type AuthIdentity = Awaited<ReturnType<QueryCtx["auth"]["getUserIdentity"]>>
type ViewerIdentity = NonNullable<AuthIdentity>

const normalizeEmail = (email: string): string => email.trim().toLowerCase()

const allowedEmails = (): ReadonlySet<string> =>
  new Set(
    (process.env.AETHER_ALLOWED_EMAILS ?? "")
      .split(",")
      .map(normalizeEmail)
      .filter((email) => email.length > 0)
  )

const displayNameFromIdentity = (identity: ViewerIdentity, email: string): string => {
  const name = identity.name?.trim()
  if (name !== undefined && name.length > 0) return name
  return email.split("@")[0] ?? "Aether User"
}

const requireIdentity = async (ctx: QueryCtx | MutationCtx): Promise<ViewerIdentity> => {
  const identity = await ctx.auth.getUserIdentity()
  if (identity === null) throw new Error("Not authenticated")
  return identity
}

const requireAllowedIdentityEmail = (identity: ViewerIdentity): string => {
  const rawEmail = identity.email
  if (rawEmail === undefined || rawEmail.trim().length === 0) {
    throw new Error("Authenticated user is missing an email address")
  }

  const email = normalizeEmail(rawEmail)
  if (!allowedEmails().has(email)) {
    throw new Error("This email is not on the Aether dogfood allowlist")
  }
  return email
}

const getUserByTokenIdentifier = (ctx: QueryCtx | MutationCtx, tokenIdentifier: string) =>
  ctx.db.query("users").withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", tokenIdentifier)).unique()

const requireAllowedCurrentUser = async (ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> => {
  const identity = await requireIdentity(ctx)
  requireAllowedIdentityEmail(identity)

  const user = await getUserByTokenIdentifier(ctx, identity.tokenIdentifier)
  if (user === null) throw new Error("Current user has not been initialized")
  return user
}

const getDefaultWorkspace = (ctx: QueryCtx | MutationCtx) =>
  ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", DOGFOOD_WORKSPACE_KEY)).unique()

const getDefaultChannel = (ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">) =>
  ctx.db
    .query("channels")
    .withIndex("by_workspace_key", (q) => q.eq("workspaceId", workspaceId).eq("key", DOGFOOD_CHANNEL_KEY))
    .unique()

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
      createdAt: input.now
    })
  }
}

const requireChannelMember = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly channelId: Id<"channels">
    readonly userId: Id<"users">
  }
) => {
  const membership = await ctx.db
    .query("channelMemberships")
    .withIndex("by_channel_user", (q) => q.eq("channelId", input.channelId).eq("userId", input.userId))
    .unique()

  if (membership === null) throw new Error("Current user is not a member of this channel")
  return membership
}

export const ensureViewer = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx)
    const email = requireAllowedIdentityEmail(identity)
    const displayName = displayNameFromIdentity(identity, email)
    const now = Date.now()
    const existingUser = await getUserByTokenIdentifier(ctx, identity.tokenIdentifier)

    const userId = existingUser?._id ?? (await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      email,
      displayName,
      createdAt: now,
      updatedAt: now
    }))

    if (existingUser !== null && (existingUser.email !== email || existingUser.displayName !== displayName)) {
      await ctx.db.patch(existingUser._id, { email, displayName, updatedAt: now })
    }

    const { workspaceId, channelId } = await ensureDefaultSpace(ctx, now)
    await ensureMemberships(ctx, { workspaceId, channelId, userId, now })

    return { userId, workspaceId, channelId, displayName }
  }
})

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAllowedCurrentUser(ctx)
    return { userId: user._id, displayName: user.displayName }
  }
})

export const defaultWorkspace = query({
  args: {},
  handler: async (ctx) => {
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
  }
})

export const channelMessages = query({
  args: {
    channelId: v.id("channels")
  },
  handler: async (ctx, args) => {
    const user = await requireAllowedCurrentUser(ctx)

    await requireChannelMember(ctx, { channelId: args.channelId, userId: user._id })

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_channel_created_at", (q) => q.eq("channelId", args.channelId))
      .collect()

    return Promise.all(messages.map((message) => toMessageView(ctx, message)))
  }
})

export const sendMessage = mutation({
  args: {
    channelId: v.id("channels"),
    body: v.string()
  },
  handler: async (ctx, args) => {
    const body = args.body.trim()
    if (body.length === 0) throw new Error("Message body is required")

    const user = await requireAllowedCurrentUser(ctx)

    await requireChannelMember(ctx, { channelId: args.channelId, userId: user._id })

    const channel = await ctx.db.get(args.channelId)
    if (channel === null) throw new Error("Channel not found")

    const messageId = await ctx.db.insert("messages", {
      workspaceId: channel.workspaceId,
      channelId: args.channelId,
      authorUserId: user._id,
      body,
      createdAt: Date.now()
    })

    const message = await ctx.db.get(messageId)
    if (message === null) throw new Error("Message not found after insert")
    return toMessageView(ctx, message)
  }
})

const toMessageView = async (ctx: QueryCtx | MutationCtx, message: Doc<"messages">) => {
  const author = await ctx.db.get(message.authorUserId)
  return {
    id: message._id,
    channelId: message.channelId,
    authorUserId: message.authorUserId,
    authorDisplayName: author?.displayName ?? "Unknown",
    body: message.body,
    createdAt: message.createdAt
  }
}
