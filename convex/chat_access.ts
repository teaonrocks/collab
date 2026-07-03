import type { Doc, Id } from "./_generated/dataModel"
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server"

type AuthIdentity = Awaited<ReturnType<QueryCtx["auth"]["getUserIdentity"]>>
type ViewerIdentity = NonNullable<AuthIdentity>

const normalizeEmail = (email: string): string => email.trim().toLowerCase()
const workOsUserEndpoint = "https://api.workos.com/user_management/users"

const stringClaim = (identity: ViewerIdentity, key: string): string | undefined => {
  const value = identity[key]
  return typeof value === "string" ? value : undefined
}

const bootstrapAllowedEmails = (): ReadonlySet<string> =>
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

const displayNameFromIdentity = (identity: ViewerIdentity, email: string): string => {
  const name = (identity.name ?? stringClaim(identity, "properties.name"))?.trim()
  if (name !== undefined && name.length > 0) return name
  return displayNameFromEmail(email)
}

export const requireIdentity = async (
  ctx: QueryCtx | MutationCtx | ActionCtx
): Promise<ViewerIdentity> => {
  const identity = await ctx.auth.getUserIdentity()
  if (identity === null) throw new Error("Not authenticated")
  return identity
}

const isEmailAllowlisted = async (
  ctx: QueryCtx | MutationCtx,
  email: string
): Promise<boolean> => {
  const entry = await ctx.db
    .query("dogfoodAllowlistEntries")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique()
  if (entry !== null) return entry.active
  return bootstrapAllowedEmails().has(email)
}

export const requireAllowedEmail = async (
  ctx: QueryCtx | MutationCtx,
  rawEmail: string
): Promise<string> => {
  if (rawEmail === undefined || rawEmail.trim().length === 0) {
    throw new Error("Authenticated user is missing an email address")
  }

  const email = normalizeEmail(rawEmail)
  if (!(await isEmailAllowlisted(ctx, email))) {
    throw new Error("This email is not on the Aether dogfood allowlist")
  }
  return email
}

export const normalizeViewerEmail = (rawEmail: string | undefined): string => {
  if (rawEmail === undefined || rawEmail.trim().length === 0) {
    throw new Error("Authenticated user is missing an email address")
  }
  return normalizeEmail(rawEmail)
}

export const getUserByTokenIdentifier = (
  ctx: QueryCtx | MutationCtx,
  tokenIdentifier: string
) => ctx.db
  .query("users")
  .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
  .unique()

export const getUserByEmail = (ctx: QueryCtx | MutationCtx, email: string) =>
  ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).unique()

export const requireAllowedCurrentUser = async (
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users">> => {
  const identity = await requireIdentity(ctx)
  const user = await getUserByTokenIdentifier(ctx, identity.tokenIdentifier)
  if (user === null) throw new Error("Current user has not been initialized")
  await requireAllowedEmail(ctx, user.email)
  return user
}

const workOsField = (body: unknown, key: string): string | undefined => {
  if (typeof body !== "object" || body === null || !Object.hasOwn(body, key)) return undefined
  const value = (body as Record<string, unknown>)[key]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

export const resolveWorkOsViewer = async (
  identity: ViewerIdentity
): Promise<{ readonly email: string; readonly displayName: string }> => {
  const identityEmail = emailFromIdentity(identity)
  if (identityEmail !== undefined && identityEmail.trim().length > 0) {
    const email = normalizeViewerEmail(identityEmail)
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
  const email = normalizeViewerEmail(rawEmail)
  return { email, displayName: workOsField(body, "name") ?? displayNameFromEmail(email) }
}

export const requireWorkspaceMember = async (
  ctx: QueryCtx | MutationCtx,
  input: {
    readonly workspaceId: Id<"workspaces">
    readonly userId: Id<"users">
  }
) => {
  const membership = await ctx.db
    .query("workspaceMemberships")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", input.workspaceId).eq("userId", input.userId)
    )
    .unique()

  if (membership === null) throw new Error("Current user is not a member of this workspace")
  return membership
}

export const requireChannelMember = async (
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
    .withIndex("by_channel_user", (q) =>
      q.eq("channelId", input.channelId).eq("userId", input.userId)
    )
    .unique()

  if (channelMembership === null) throw new Error("Current user is not a member of this channel")
  return channel
}
