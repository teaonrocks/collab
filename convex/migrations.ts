import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import { seededUsername } from "./social"

const MAX_CHANNELS_PER_WORKSPACE = 100
const MAX_DIRECT_CHANNEL_BACKFILL = 100
const MAX_USER_PROFILE_BACKFILL = 100

/** Run repeatedly until `remaining` is false after deploying the widened schema. */
export const backfillUsernames = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    const users = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", undefined))
      .take(MAX_USER_PROFILE_BACKFILL)
    const changes: Array<{ readonly userId: typeof users[number]["_id"]; readonly username: string }> = []
    for (const user of users) {
      const username = await seededUsername(ctx, user.email)
      if (!dryRun) await ctx.db.patch(user._id, { username, directMessagePreference: user.directMessagePreference ?? "mutuals" })
      changes.push({ userId: user._id, username })
    }
    return { dryRun, changes, remaining: users.length === MAX_USER_PROFILE_BACKFILL }
  }
})

/**
 * Moves legacy one-to-one DMs out of a workspace. Duplicate historical pairs
 * are deliberately reported, never selected arbitrarily; reconcile them first.
 */
export const globalizeLegacyDirectConversations = internalMutation({
  args: { workspaceId: v.id("workspaces"), dryRun: v.boolean() },
  handler: async (ctx, { workspaceId, dryRun }) => {
    const channels = await ctx.db.query("channels")
      .withIndex("by_workspace_kind_and_deleted_at", (q) => q.eq("workspaceId", workspaceId).eq("kind", "direct").eq("deletedAt", undefined))
      .take(MAX_DIRECT_CHANNEL_BACKFILL)
    const changes: Array<{ readonly channelId: typeof channels[number]["_id"]; readonly action: "globalized" | "duplicate" | "invalid" }> = []
    for (const channel of channels) {
      if (channel.directPairKey === undefined) {
        changes.push({ channelId: channel._id, action: "invalid" })
        continue
      }
      const pair = await ctx.db.query("channels")
        .withIndex("by_direct_pair_key", (q) => q.eq("directPairKey", channel.directPairKey))
        .take(2)
      if (pair.length !== 1) {
        changes.push({ channelId: channel._id, action: "duplicate" })
        continue
      }
      const memberships = await ctx.db.query("channelMemberships")
        .withIndex("by_channel", (q) => q.eq("channelId", channel._id)).take(3)
      if (memberships.length !== 2) {
        changes.push({ channelId: channel._id, action: "invalid" })
        continue
      }
      if (!dryRun) {
        await ctx.db.patch(channel._id, { workspaceId: undefined })
        for (const membership of memberships) await ctx.db.patch(membership._id, { workspaceId: undefined, channelKind: "direct" })
      }
      changes.push({ channelId: channel._id, action: "globalized" })
    }
    return { workspaceId, dryRun, changes, remaining: channels.length === MAX_DIRECT_CHANNEL_BACKFILL }
  }
})

export const promoteUserToAllChannelAdmins = internalMutation({
  args: {
    email: v.string(),
    dryRun: v.boolean()
  },
  handler: async (ctx, { email, dryRun }) => {
    const normalizedEmail = email.trim().toLowerCase()
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .unique()
    if (user === null) throw new Error("User not found")

    const channels = (await ctx.db.query("channels").take(MAX_CHANNELS_PER_WORKSPACE))
      .filter((channel) => channel.deletedAt === undefined)
    const changes: Array<{ readonly channelId: typeof channels[number]["_id"]; readonly name: string; readonly action: "created" | "promoted" | "unchanged" }> = []

    for (const channel of channels) {
      const membership = await ctx.db
        .query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", channel._id).eq("userId", user._id))
        .unique()
      if (membership?.role === "admin") {
        changes.push({ channelId: channel._id, name: channel.name, action: "unchanged" })
        continue
      }
      if (!dryRun) {
        if (membership === null) {
          const now = Date.now()
          await ctx.db.insert("channelMemberships", {
            channelId: channel._id,
            userId: user._id,
            role: "admin",
            createdAt: now,
            lastReadAt: now,
            mentionTrackingStartedAt: now
          })
        } else {
          await ctx.db.patch(membership._id, { role: "admin" })
        }
      }
      changes.push({ channelId: channel._id, name: channel.name, action: membership === null ? "created" : "promoted" })
    }

    return { email: normalizedEmail, dryRun, changes }
  }
})

export const backfillDirectChannelMembershipKind = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    dryRun: v.boolean()
  },
  handler: async (ctx, { workspaceId, dryRun }) => {
    const directChannels = await ctx.db
      .query("channels")
      .withIndex("by_workspace_kind_and_deleted_at", (q) =>
        q.eq("workspaceId", workspaceId).eq("kind", "direct"))
      .take(MAX_DIRECT_CHANNEL_BACKFILL)
    const changes: Array<{
      readonly channelId: typeof directChannels[number]["_id"]
      readonly membershipId: string
      readonly action: "updated" | "unchanged"
    }> = []

    for (const channel of directChannels) {
      const memberships = await ctx.db
        .query("channelMemberships")
        .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
        .collect()
      for (const membership of memberships) {
        if (membership.channelKind === "direct") {
          changes.push({ channelId: channel._id, membershipId: membership._id, action: "unchanged" })
          continue
        }
        if (!dryRun) await ctx.db.patch(membership._id, { channelKind: "direct" })
        changes.push({ channelId: channel._id, membershipId: membership._id, action: "updated" })
      }
    }

    return { workspaceId, dryRun, changes }
  }
})
