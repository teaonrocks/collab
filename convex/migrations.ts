import { v } from "convex/values"
import { internalMutation } from "./_generated/server"

const MAX_CHANNELS_PER_WORKSPACE = 100
const MAX_DIRECT_CHANNEL_BACKFILL = 100

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
