import { v } from "convex/values"
import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { action, internalMutation, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server"

const DOGFOOD_WORKSPACE_KEY = "aether-dogfood"
const DOGFOOD_WORKSPACE_NAME = "Aether Dogfood"
const DOGFOOD_CHANNEL_KEY = "general"
const DOGFOOD_CHANNEL_NAME = "general"
const MAX_CHANNELS = 100
const MAX_MESSAGE_ATTACHMENTS = 4
const MAX_ATTACHMENT_NAME_LENGTH = 180
const MESSAGE_REACTION_EMOJIS = ["👍", "🎉", "👀"] as const
const MESSAGE_PARENT_PREVIEW_MAX_LENGTH = 120

const messageReactionEmoji = v.union(
  v.literal(MESSAGE_REACTION_EMOJIS[0]),
  v.literal(MESSAGE_REACTION_EMOJIS[1]),
  v.literal(MESSAGE_REACTION_EMOJIS[2])
)

const messageAttachmentInput = v.object({
  storageId: v.id("_storage"),
  name: v.string()
})

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

const attachmentName = (name: string): string => {
  const normalized = name.trim().replace(/\s+/g, " ").slice(0, MAX_ATTACHMENT_NAME_LENGTH)
  return normalized.length === 0 ? "attachment" : normalized
}

const attachmentKind = (contentType: string): "file" | "image" =>
  contentType.toLowerCase().startsWith("image/") ? "image" : "file"

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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const mentionsDisplayName = (body: string, displayName: string): boolean =>
  mentionCandidates(displayName).some((candidate) => {
    const mention = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(candidate)}($|[^A-Za-z0-9_])`, "i")
    return mention.test(body)
  })

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

type DogfoodDiagnosticContext = Record<string, string | number | boolean | null | undefined>

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
      error: cause instanceof Error ? cause.message : "Unknown error"
    })
    throw cause
  }
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

const validateMessageAttachments = async (
  ctx: MutationCtx,
  attachments: ReadonlyArray<{ readonly storageId: Id<"_storage">; readonly name: string }> | undefined
) => {
  if (attachments === undefined) return []
  if (attachments.length > MAX_MESSAGE_ATTACHMENTS) {
    throw new Error(`Messages can include at most ${MAX_MESSAGE_ATTACHMENTS} attachments`)
  }

  const validated: Array<{
    readonly storageId: Id<"_storage">
    readonly name: string
    readonly contentType: string
    readonly size: number
    readonly kind: "file" | "image"
  }> = []

  for (const attachment of attachments) {
    const metadata = await ctx.db.system.get("_storage", attachment.storageId)
    if (metadata === null) throw new Error("Attachment upload was not found")
    const contentType = metadata.contentType ?? "application/octet-stream"
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

export const generateAttachmentUploadUrl = mutation({
  args: {},
  handler: (ctx) => withDogfoodDiagnostics("generateAttachmentUploadUrl", {}, async () => {
    await requireAllowedCurrentUser(ctx)
    return ctx.storage.generateUploadUrl()
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
      let hasUnread = false
      let mentioned = false
      const messages = ctx.db
        .query("messages")
        .withIndex("by_channel_created_at", (q) => q.eq("channelId", channel.id).gt("createdAt", lastReadAt))
      for await (const message of messages) {
        if (message.authorUserId === user._id) continue
        hasUnread = true
        if (mentionsDisplayName(message.body, user.displayName)) {
          mentioned = true
          break
        }
      }
      if (!hasUnread) continue
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
    readThroughCreatedAt: v.number()
  },
  handler: (ctx, args) => withDogfoodDiagnostics("markChannelRead", {
    channelId: args.channelId,
    readThroughCreatedAt: args.readThroughCreatedAt
  }, async () => {
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
  })
})

export const createChannel = mutation({
  args: {
    name: v.string(),
    visibility: v.optional(v.union(v.literal("public"), v.literal("private")))
  },
  handler: (ctx, args) => withDogfoodDiagnostics("createChannel", {
    visibility: args.visibility ?? "public",
    nameLength: args.name.trim().length
  }, async () => {
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
  })
})

export const channelMessages = query({
  args: {
    channelId: v.id("channels")
  },
  handler: (ctx, args) => withDogfoodDiagnostics("channelMessages", { channelId: args.channelId }, async () => {
    const user = await requireAllowedCurrentUser(ctx)

    await requireChannelMember(ctx, { channelId: args.channelId, userId: user._id })

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_channel_created_at", (q) => q.eq("channelId", args.channelId))
      .order("desc")
      .take(200)

    return toMessageViews(ctx, [...messages].reverse(), user._id)
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
  }, async () => {
    const body = args.body.trim()
    const attachments = await validateMessageAttachments(ctx, args.attachments)
    if (body.length === 0 && attachments.length === 0) throw new Error("Message body or attachment is required")

    const user = await requireAllowedCurrentUser(ctx)

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
      createdAt: Date.now()
    })

    const message = await ctx.db.get(messageId)
    if (message === null) throw new Error("Message not found after insert")
    return toMessageView(ctx, message, user._id)
  })
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
  }, async () => {
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
    return toMessageView(ctx, updated, user._id)
  })
})

export const deleteMessage = mutation({
  args: {
    channelId: v.id("channels"),
    messageId: v.id("messages")
  },
  handler: (ctx, args) => withDogfoodDiagnostics("deleteMessage", {
    channelId: args.channelId,
    messageId: args.messageId
  }, async () => {
    const user = await requireAllowedCurrentUser(ctx)
    const message = await ctx.db.get(args.messageId)
    if (message === null || message.channelId !== args.channelId) throw new Error("Message not found")

    await requireChannelMember(ctx, { channelId: message.channelId, userId: user._id })
    if (message.authorUserId !== user._id) throw new Error("Only the original author can delete this message")

    const reactions = await ctx.db
      .query("messageReactions")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect()
    for (const reaction of reactions) {
      await ctx.db.delete(reaction._id)
    }
    await ctx.db.delete(args.messageId)
    return { messageId: args.messageId }
  })
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
  }, async () => {
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
        createdAt: Date.now()
      })
    } else {
      for (const reaction of existing) {
        await ctx.db.delete(reaction._id)
      }
    }

    return toMessageView(ctx, message, user._id)
  })
})

type MessageView = {
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

const messageReactionRank = (emoji: string): number => {
  const index = MESSAGE_REACTION_EMOJIS.findIndex((candidate) => candidate === emoji)
  return index === -1 ? MESSAGE_REACTION_EMOJIS.length : index
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
  type ReactionCount = { userIds: Set<Id<"users">>; reactedByCurrentUser: boolean }
  const counts = new Map<string, ReactionCount>()

  for (const reaction of reactions) {
    const existing: ReactionCount = counts.get(reaction.emoji) ?? {
      userIds: new Set(),
      reactedByCurrentUser: false
    }
    existing.userIds.add(reaction.userId)
    counts.set(reaction.emoji, {
      userIds: existing.userIds,
      reactedByCurrentUser: existing.reactedByCurrentUser || reaction.userId === input.currentUserId
    })
  }

  return Array.from(counts, ([emoji, state]) => ({
    emoji,
    count: state.userIds.size,
    reactedByCurrentUser: state.reactedByCurrentUser
  })).sort((left, right) => messageReactionRank(left.emoji) - messageReactionRank(right.emoji) || left.emoji.localeCompare(right.emoji))
}

const trimParentPreview = (body: string): string => {
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

const toMessageViews = async (
  ctx: QueryCtx | MutationCtx,
  messages: ReadonlyArray<Doc<"messages">>,
  currentUserId: Id<"users">
): Promise<ReadonlyArray<MessageView>> => {
  const authorNamesById = new Map<Id<"users">, string>()
  const reactionsByMessageId = new Map<Id<"messages">, Awaited<ReturnType<typeof reactionsForMessage>>>()
  const attachmentsByMessageId = new Map<Id<"messages">, Awaited<ReturnType<typeof attachmentsForMessage>>>()
  const parentsById = new Map<Id<"messages">, Doc<"messages"> | null>()

  for (const message of messages) {
    if (message.authorDisplayName !== undefined) continue
    if (authorNamesById.has(message.authorUserId)) continue
    const author = await ctx.db.get(message.authorUserId)
    authorNamesById.set(message.authorUserId, author?.displayName ?? "Unknown")
  }

  for (const message of messages) {
    reactionsByMessageId.set(message._id, await reactionsForMessage(ctx, { messageId: message._id, currentUserId }))
  }

  for (const message of messages) {
    attachmentsByMessageId.set(message._id, await attachmentsForMessage(ctx, message))
  }

  for (const message of messages) {
    if (message.parentMessageId === undefined || parentsById.has(message.parentMessageId)) continue
    const parent = await ctx.db.get(message.parentMessageId)
    parentsById.set(message.parentMessageId, parent)
    if (parent !== null && parent.authorDisplayName === undefined && !authorNamesById.has(parent.authorUserId)) {
      const author = await ctx.db.get(parent.authorUserId)
      authorNamesById.set(parent.authorUserId, author?.displayName ?? "Unknown")
    }
  }

  return messages.map((message) => {
    const parent = message.parentMessageId === undefined ? null : parentsById.get(message.parentMessageId) ?? null
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

const toMessageView = async (
  ctx: QueryCtx | MutationCtx,
  message: Doc<"messages">,
  currentUserId: Id<"users">
): Promise<MessageView> => {
  const [view] = await toMessageViews(ctx, [message], currentUserId)
  return view!
}

const toChannelView = (channel: Doc<"channels">) => ({
  id: channel._id,
  key: channel.key,
  name: channel.name,
  visibility: channel.visibility,
  createdAt: channel.createdAt
})
