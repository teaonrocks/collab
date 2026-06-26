import { v } from "convex/values"
import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { action, internalMutation, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server"

const DOGFOOD_WORKSPACE_KEY = "aether-dogfood"
const DOGFOOD_WORKSPACE_NAME = "Aether Dogfood"
const DOGFOOD_CHANNEL_KEY = "general"
const DOGFOOD_CHANNEL_NAME = "general"
const MAX_CHANNELS = 100

type AuthIdentity = Awaited<ReturnType<QueryCtx["auth"]["getUserIdentity"]>>
type ViewerIdentity = NonNullable<AuthIdentity>

const normalizeEmail = (email: string): string => email.trim().toLowerCase()

const workOsUserEndpoint = "https://api.workos.com/user_management/users"

const stringClaim = (identity: ViewerIdentity, key: string): string | undefined => {
  const value = identity[key]
  return typeof value === "string" ? value : undefined
}

const allowedEmails = (): ReadonlySet<string> =>
  new Set(
    (process.env.AETHER_ALLOWED_EMAILS ?? "")
      .split(",")
      .map(normalizeEmail)
      .filter((email) => email.length > 0)
  )

const emailFromIdentity = (identity: ViewerIdentity): string | undefined =>
  identity.email ??
  stringClaim(identity, "properties.email") ??
  stringClaim(identity, "email_address") ??
  stringClaim(identity, "preferred_username")

const displayNameFromEmail = (email: string): string => email.split("@")[0] ?? "Aether User"

const normalizeChannelName = (name: string): string =>
  name.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase()

const validateChannelName = (rawName: string): string => {
  const name = normalizeChannelName(rawName)
  if (name.length === 0) throw new Error("Channel name is required")
  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw new Error("Channel names can only use letters, numbers, dashes, and underscores")
  }
  return name
}

const channelKeyFromName = (name: string): string => normalizeChannelName(name)

const mentionCandidates = (displayName: string): ReadonlyArray<string> => {
  const normalized = displayName.trim().toLowerCase()
  const firstName = normalized.split(/\s+/)[0] ?? ""
  return Array.from(new Set([`@${normalized}`, firstName.length === 0 ? "" : `@${firstName}`]))
    .filter((value) => value.length > 1)
}

const displayNameFromIdentity = (identity: ViewerIdentity, email: string): string => {
  const name = (identity.name ?? stringClaim(identity, "properties.name"))?.trim()
  if (name !== undefined && name.length > 0) return name
  return displayNameFromEmail(email)
}

const requireIdentity = async (ctx: QueryCtx | MutationCtx | ActionCtx): Promise<ViewerIdentity> => {
  const identity = await ctx.auth.getUserIdentity()
  if (identity === null) throw new Error("Not authenticated")
  return identity
}

const requireAllowedEmail = (rawEmail: string): string => {
  if (rawEmail === undefined || rawEmail.trim().length === 0) {
    throw new Error("Authenticated user is missing an email address")
  }

  const email = normalizeEmail(rawEmail)
  if (!allowedEmails().has(email)) {
    throw new Error("This email is not on the Aether dogfood allowlist")
  }
  return email
}

const requireAllowedIdentityEmail = (identity: ViewerIdentity): string => {
  const rawEmail = emailFromIdentity(identity)
  if (rawEmail === undefined) throw new Error("Authenticated user is missing an email address")
  return requireAllowedEmail(rawEmail)
}

const getUserByTokenIdentifier = (ctx: QueryCtx | MutationCtx, tokenIdentifier: string) =>
  ctx.db.query("users").withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", tokenIdentifier)).unique()

const getUserByEmail = (ctx: QueryCtx | MutationCtx, email: string) =>
  ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).unique()

const requireAllowedCurrentUser = async (ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> => {
  const identity = await requireIdentity(ctx)
  const user = await getUserByTokenIdentifier(ctx, identity.tokenIdentifier)
  if (user === null) throw new Error("Current user has not been initialized")
  requireAllowedEmail(user.email)
  return user
}

const workOsField = (body: unknown, key: string): string | undefined => {
  if (typeof body !== "object" || body === null || !Object.hasOwn(body, key)) return undefined
  const value = (body as Record<string, unknown>)[key]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

const resolveWorkOsViewer = async (identity: ViewerIdentity): Promise<{ readonly email: string; readonly displayName: string }> => {
  const identityEmail = emailFromIdentity(identity)
  if (identityEmail !== undefined && identityEmail.trim().length > 0) {
    const email = requireAllowedEmail(identityEmail)
    return { email, displayName: displayNameFromIdentity(identity, email) }
  }

  const apiKey = process.env.WORKOS_API_KEY
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("WorkOS API key is not configured")
  }

  const response = await fetch(`${workOsUserEndpoint}/${encodeURIComponent(identity.subject)}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  if (!response.ok) {
    throw new Error(`Could not load WorkOS user profile (${response.status})`)
  }

  const body = await response.json() as unknown
  const rawEmail = workOsField(body, "email")
  if (rawEmail === undefined) throw new Error("WorkOS user profile is missing an email address")
  const email = requireAllowedEmail(rawEmail)
  return { email, displayName: workOsField(body, "name") ?? displayNameFromEmail(email) }
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
      lastReadAt: input.now
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
    lastReadAt: input.now
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

const requireWorkspaceMember = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly workspaceId: Id<"workspaces">
    readonly userId: Id<"users">
  }
) => {
  const membership = await ctx.db
    .query("workspaceMemberships")
    .withIndex("by_workspace_user", (q) => q.eq("workspaceId", input.workspaceId).eq("userId", input.userId))
    .unique()

  if (membership === null) throw new Error("Current user is not a member of this workspace")
  return membership
}

const requireChannelMember = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly channelId: Id<"channels">
    readonly userId: Id<"users">
  }
) => {
  const channel = await ctx.db.get(input.channelId)
  if (channel === null) throw new Error("Channel not found")
  await requireWorkspaceMember(ctx, { workspaceId: channel.workspaceId, userId: input.userId })
  const channelMembership = await ctx.db
    .query("channelMemberships")
    .withIndex("by_channel_user", (q) => q.eq("channelId", input.channelId).eq("userId", input.userId))
    .unique()

  if (channelMembership === null) throw new Error("Current user is not a member of this channel")
  return channel
}

export const ensureViewer = action({
  args: {},
  handler: async (ctx) => {
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
  }
})

export const ensureViewerForIdentity = internalMutation({
  args: {
    tokenIdentifier: v.string(),
    email: v.string(),
    displayName: v.string()
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const existingUser =
      (await getUserByTokenIdentifier(ctx, args.tokenIdentifier)) ?? (await getUserByEmail(ctx, args.email))

    const userId = existingUser?._id ?? (await ctx.db.insert("users", {
      tokenIdentifier: args.tokenIdentifier,
      email: args.email,
      displayName: args.displayName,
      createdAt: now,
      updatedAt: now
    }))

    if (
      existingUser !== null &&
      (existingUser.tokenIdentifier !== args.tokenIdentifier ||
        existingUser.email !== args.email ||
        existingUser.displayName !== args.displayName)
    ) {
      await ctx.db.patch(existingUser._id, {
        tokenIdentifier: args.tokenIdentifier,
        email: args.email,
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

export const channels = query({
  args: {
    workspaceId: v.id("workspaces")
  },
  handler: async (ctx, args) => {
    const user = await requireAllowedCurrentUser(ctx)
    const workspace = await ctx.db.get(args.workspaceId)
    if (workspace === null) return []

    await requireWorkspaceMember(ctx, { workspaceId: workspace._id, userId: user._id })
    return listVisibleWorkspaceChannels(ctx, { workspaceId: workspace._id, userId: user._id })
  }
})

export const channelIndicators = query({
  args: {
    workspaceId: v.id("workspaces")
  },
  handler: async (ctx, args) => {
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
    const needles = mentionCandidates(user.displayName)
    const indicators: Array<{
      readonly channelId: Id<"channels">
      readonly indicator: "unread" | "mentioned"
    }> = []

    for (const channel of channels) {
      const membership = membershipsByChannelId.get(channel.id)
      if (membership === undefined) continue

      const lastReadAt = membership.lastReadAt ?? membership.createdAt
      let hasUnread = false
      let mentioned = false
      const messages = ctx.db
        .query("messages")
        .withIndex("by_channel_created_at", (q) => q.eq("channelId", channel.id).gt("createdAt", lastReadAt))
      for await (const message of messages) {
        if (message.authorUserId === user._id) continue
        hasUnread = true
        const body = message.body.toLowerCase()
        if (needles.some((needle) => body.includes(needle))) {
          mentioned = true
          break
        }
      }
      if (!hasUnread) continue
      indicators.push({ channelId: channel.id, indicator: mentioned ? "mentioned" : "unread" })
    }

    return indicators
  }
})

export const ensureChannelMember = mutation({
  args: {
    channelId: v.id("channels")
  },
  handler: async (ctx, args) => {
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
  }
})

export const markChannelRead = mutation({
  args: {
    channelId: v.id("channels"),
    readThroughCreatedAt: v.number()
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.readThroughCreatedAt)) throw new Error("Read-through timestamp must be finite")
    const user = await requireAllowedCurrentUser(ctx)
    const channel = await ctx.db.get(args.channelId)
    if (channel === null) throw new Error("Channel not found")

    await requireWorkspaceMember(ctx, { workspaceId: channel.workspaceId, userId: user._id })
    const membership = await ctx.db
      .query("channelMemberships")
      .withIndex("by_channel_user", (q) => q.eq("channelId", args.channelId).eq("userId", user._id))
      .unique()
    if (membership === null) throw new Error("Current user is not a member of this channel")

    if ((membership.lastReadAt ?? membership.createdAt) >= args.readThroughCreatedAt) return toChannelView(channel)
    await ctx.db.patch(membership._id, { lastReadAt: args.readThroughCreatedAt })
    return toChannelView(channel)
  }
})

export const createChannel = mutation({
  args: {
    name: v.string(),
    visibility: v.optional(v.union(v.literal("public"), v.literal("private")))
  },
  handler: async (ctx, args) => {
    const user = await requireAllowedCurrentUser(ctx)
    const workspace = await getDefaultWorkspace(ctx)
    if (workspace === null) throw new Error("Workspace not found")

    await requireWorkspaceMember(ctx, { workspaceId: workspace._id, userId: user._id })

    const name = validateChannelName(args.name)

    const key = channelKeyFromName(name)
    const existing = await ctx.db
      .query("channels")
      .withIndex("by_workspace_key", (q) => q.eq("workspaceId", workspace._id).eq("key", key))
      .unique()
    if (existing !== null) throw new Error("Channel already exists")

    const now = Date.now()
    const channelId = await ctx.db.insert("channels", {
      workspaceId: workspace._id,
      key,
      name,
      visibility: args.visibility ?? "public",
      createdAt: now
    })

    await ctx.db.insert("channelMemberships", {
      channelId,
      userId: user._id,
      role: "member",
      createdAt: now,
      lastReadAt: now
    })

    const channel = await ctx.db.get(channelId)
    if (channel === null) throw new Error("Channel not found after insert")
    return toChannelView(channel)
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
      .order("desc")
      .take(200)

    return toMessageViews(ctx, [...messages].reverse())
  }
})

export const channelMembers = query({
  args: {
    channelId: v.id("channels")
  },
  handler: async (ctx, args) => {
    const user = await requireAllowedCurrentUser(ctx)

    const channel = await requireChannelMember(ctx, { channelId: args.channelId, userId: user._id })

    if (channel.visibility === "public") {
      return listWorkspaceMembers(ctx, channel.workspaceId)
    }

    return listChannelMembers(ctx, args.channelId)
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

    const channel = await requireChannelMember(ctx, { channelId: args.channelId, userId: user._id })

    const messageId = await ctx.db.insert("messages", {
      workspaceId: channel.workspaceId,
      channelId: args.channelId,
      authorUserId: user._id,
      authorDisplayName: user.displayName,
      body,
      createdAt: Date.now()
    })

    const message = await ctx.db.get(messageId)
    if (message === null) throw new Error("Message not found after insert")
    return toMessageView(ctx, message)
  }
})

export const editMessage = mutation({
  args: {
    channelId: v.id("channels"),
    messageId: v.id("messages"),
    body: v.string()
  },
  handler: async (ctx, args) => {
    const body = args.body.trim()
    if (body.length === 0) throw new Error("Message body is required")

    const user = await requireAllowedCurrentUser(ctx)
    const message = await ctx.db.get(args.messageId)
    if (message === null || message.channelId !== args.channelId) throw new Error("Message not found")

    await requireChannelMember(ctx, { channelId: message.channelId, userId: user._id })
    if (message.authorUserId !== user._id) throw new Error("Only the original author can edit this message")

    await ctx.db.patch(args.messageId, { body, editedAt: Date.now() })
    const updated = await ctx.db.get(args.messageId)
    if (updated === null) throw new Error("Message not found after edit")
    return toMessageView(ctx, updated)
  }
})

export const deleteMessage = mutation({
  args: {
    channelId: v.id("channels"),
    messageId: v.id("messages")
  },
  handler: async (ctx, args) => {
    const user = await requireAllowedCurrentUser(ctx)
    const message = await ctx.db.get(args.messageId)
    if (message === null || message.channelId !== args.channelId) throw new Error("Message not found")

    await requireChannelMember(ctx, { channelId: message.channelId, userId: user._id })
    if (message.authorUserId !== user._id) throw new Error("Only the original author can delete this message")

    await ctx.db.delete(args.messageId)
    return { messageId: args.messageId }
  }
})

type MessageView = {
  readonly id: Doc<"messages">["_id"]
  readonly channelId: Doc<"messages">["channelId"]
  readonly authorUserId: Doc<"messages">["authorUserId"]
  readonly authorDisplayName: string
  readonly body: string
  readonly createdAt: number
  readonly editedAt: number | null
}

const toMessageViews = async (
  ctx: QueryCtx | MutationCtx,
  messages: ReadonlyArray<Doc<"messages">>
): Promise<ReadonlyArray<MessageView>> => {
  const authorNamesById = new Map<Id<"users">, string>()

  for (const message of messages) {
    if (message.authorDisplayName !== undefined) continue
    if (authorNamesById.has(message.authorUserId)) continue
    const author = await ctx.db.get(message.authorUserId)
    authorNamesById.set(message.authorUserId, author?.displayName ?? "Unknown")
  }

  return messages.map((message) => ({
    id: message._id,
    channelId: message.channelId,
    authorUserId: message.authorUserId,
    authorDisplayName: message.authorDisplayName ?? authorNamesById.get(message.authorUserId) ?? "Unknown",
    body: message.body,
    createdAt: message.createdAt,
    editedAt: message.editedAt ?? null
  }))
}

const toMessageView = async (ctx: QueryCtx | MutationCtx, message: Doc<"messages">): Promise<MessageView> => {
  const [view] = await toMessageViews(ctx, [message])
  return view!
}

const toChannelView = (channel: Doc<"channels">) => ({
  id: channel._id,
  key: channel.key,
  name: channel.name,
  visibility: channel.visibility,
  createdAt: channel.createdAt
})
