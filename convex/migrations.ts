import { v } from "convex/values"
import { internalMutation } from "./_generated/server"

const MAX_CHANNELS_PER_WORKSPACE = 100

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
