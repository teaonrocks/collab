/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

const mayaIdentity = {
  tokenIdentifier: "https://issuer.example|maya",
  email: "maya@example.com",
  name: "Maya Patel"
}

const leeIdentity = {
  tokenIdentifier: "https://issuer.example|lee",
  email: "lee@example.com",
  name: "Lee Chen"
}

beforeEach(() => {
  vi.stubEnv("AETHER_ALLOWED_EMAILS", "maya@example.com,lee@example.com")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("dogfood channel memberships", () => {
  it("normalizes channel names and rejects empty, duplicate, and unsupported names", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier,
      email: mayaIdentity.email,
      displayName: mayaIdentity.name
    })

    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "   ###   " }))
      .rejects.toThrow("Channel name is required")
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design!" }))
      .rejects.toThrow("Channel names can only use letters, numbers, dashes, and underscores")

    const product = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "  #Product Team  " })
    expect(product).toMatchObject({
      key: "product-team",
      name: "product-team",
      visibility: "public"
    })

    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "product team" }))
      .rejects.toThrow("Channel already exists")
  })

  it("lets allowlisted users idempotently join created shared channels before reading messages", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier,
      email: mayaIdentity.email,
      displayName: mayaIdentity.name
    })

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMessages, { channelId: design.id }))
      .rejects.toThrow("Current user has not been initialized")

    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: leeIdentity.tokenIdentifier,
      email: leeIdentity.email,
      displayName: leeIdentity.name
    })

    const visibleChannels = await t.withIdentity(leeIdentity).query(api.chat.channels, {
      workspaceId: await t.run(async (ctx) => {
        const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
        if (workspace === null) throw new Error("Workspace not found")
        return workspace._id
      })
    })
    expect(visibleChannels.map((channel) => channel.name)).toContain("design")

    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMessages, { channelId: design.id }))
      .resolves.toEqual([])

    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMembers, { channelId: design.id }))
      .resolves.toEqual([
        expect.objectContaining({ displayName: "Lee Chen" }),
        expect.objectContaining({ displayName: "Maya Patel" })
      ])

    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })

    const leeDesignMemberships = await t.run(async (ctx) => {
      const lee = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", leeIdentity.email)).unique()
      if (lee === null) throw new Error("Lee not found")
      return ctx.db
        .query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", design.id).eq("userId", lee._id))
        .collect()
    })
    expect(leeDesignMemberships).toHaveLength(1)
  })

  it("keeps private channels hidden and requires explicit membership", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier,
      email: mayaIdentity.email,
      displayName: mayaIdentity.name
    })
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: leeIdentity.tokenIdentifier,
      email: leeIdentity.email,
      displayName: leeIdentity.name
    })

    const { workspaceId, privateChannelId } = await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
      if (workspace === null) throw new Error("Workspace not found")
      const privateChannelId = await ctx.db.insert("channels", {
        workspaceId: workspace._id,
        key: "strategy",
        name: "strategy",
        visibility: "private",
        createdAt: 100
      })
      return { workspaceId: workspace._id, privateChannelId }
    })

    const visibleChannels = await t.withIdentity(leeIdentity).query(api.chat.channels, { workspaceId })
    expect(visibleChannels.map((channel) => channel.name)).not.toContain("strategy")
    await expect(t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: privateChannelId }))
      .rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMessages, { channelId: privateChannelId }))
      .rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMembers, { channelId: privateChannelId }))
      .rejects.toThrow("Current user is not a member of this channel")
  })

  it("tracks unread and mention state per channel and clears read channels", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier,
      email: mayaIdentity.email,
      displayName: mayaIdentity.name
    })
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: leeIdentity.tokenIdentifier,
      email: leeIdentity.email,
      displayName: leeIdentity.name
    })

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    const product = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "product" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: product.id })

    const workspaceId = await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
      const maya = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", mayaIdentity.email)).unique()
      const lee = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", leeIdentity.email)).unique()
      if (workspace === null || maya === null || lee === null) throw new Error("Seed records not found")
      const leeMemberships = await ctx.db
        .query("channelMemberships")
        .withIndex("by_user", (q) => q.eq("userId", lee._id))
        .collect()
      for (const membership of leeMemberships) {
        await ctx.db.patch(membership._id, { lastReadAt: 1 })
      }
      await ctx.db.insert("messages", {
        workspaceId: workspace._id,
        channelId: design.id,
        authorUserId: maya._id,
        authorDisplayName: maya.displayName,
        body: "@Lee can you review the design notes?",
        createdAt: 100
      })
      await ctx.db.insert("messages", {
        workspaceId: workspace._id,
        channelId: product.id,
        authorUserId: maya._id,
        authorDisplayName: maya.displayName,
        body: "@Maya left product context for later.",
        createdAt: 101
      })
      return workspace._id
    })

    await t.withIdentity(leeIdentity).mutation(api.chat.markChannelRead, {
      channelId: product.id,
      readThroughCreatedAt: 101
    })

    expect(await t.withIdentity(leeIdentity).query(api.chat.channelIndicators, { workspaceId }))
      .toEqual([{ channelId: design.id, indicator: "mentioned" }])

    await t.withIdentity(leeIdentity).mutation(api.chat.markChannelRead, {
      channelId: design.id,
      readThroughCreatedAt: 100
    })

    expect(await t.withIdentity(leeIdentity).query(api.chat.channelIndicators, { workspaceId }))
      .toEqual([])
  })

  it("marks a channel read only through the loaded message timestamp", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier,
      email: mayaIdentity.email,
      displayName: mayaIdentity.name
    })
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: leeIdentity.tokenIdentifier,
      email: leeIdentity.email,
      displayName: leeIdentity.name
    })

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })

    const workspaceId = await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
      const maya = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", mayaIdentity.email)).unique()
      const lee = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", leeIdentity.email)).unique()
      if (workspace === null || maya === null || lee === null) throw new Error("Seed records not found")
      const membership = await ctx.db
        .query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", design.id).eq("userId", lee._id))
        .unique()
      if (membership === null) throw new Error("Membership not found")
      await ctx.db.patch(membership._id, { lastReadAt: 1 })
      await ctx.db.insert("messages", {
        workspaceId: workspace._id,
        channelId: design.id,
        authorUserId: maya._id,
        authorDisplayName: maya.displayName,
        body: "Loaded before the read receipt.",
        createdAt: 100
      })
      await ctx.db.insert("messages", {
        workspaceId: workspace._id,
        channelId: design.id,
        authorUserId: maya._id,
        authorDisplayName: maya.displayName,
        body: "Arrived after the loaded snapshot.",
        createdAt: 200
      })
      return workspace._id
    })

    await t.withIdentity(leeIdentity).mutation(api.chat.markChannelRead, {
      channelId: design.id,
      readThroughCreatedAt: 100
    })

    await expect(t.withIdentity(leeIdentity).query(api.chat.channelIndicators, { workspaceId }))
      .resolves.toEqual([{ channelId: design.id, indicator: "unread" }])

    await t.run(async (ctx) => {
      const lee = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", leeIdentity.email)).unique()
      if (lee === null) throw new Error("Lee not found")
      const membership = await ctx.db
        .query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", design.id).eq("userId", lee._id))
        .unique()
      expect(membership?.lastReadAt).toBe(100)
    })
  })

  it("detects mentions after the first 50 unread messages", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier,
      email: mayaIdentity.email,
      displayName: mayaIdentity.name
    })
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: leeIdentity.tokenIdentifier,
      email: leeIdentity.email,
      displayName: leeIdentity.name
    })

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })

    const workspaceId = await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
      const maya = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", mayaIdentity.email)).unique()
      const lee = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", leeIdentity.email)).unique()
      if (workspace === null || maya === null || lee === null) throw new Error("Seed records not found")
      const membership = await ctx.db
        .query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", design.id).eq("userId", lee._id))
        .unique()
      if (membership === null) throw new Error("Membership not found")
      await ctx.db.patch(membership._id, { lastReadAt: 1 })

      for (let index = 0; index < 50; index += 1) {
        await ctx.db.insert("messages", {
          workspaceId: workspace._id,
          channelId: design.id,
          authorUserId: maya._id,
          authorDisplayName: maya.displayName,
          body: `Unread context ${index}`,
          createdAt: 100 + index
        })
      }

      await ctx.db.insert("messages", {
        workspaceId: workspace._id,
        channelId: design.id,
        authorUserId: maya._id,
        authorDisplayName: maya.displayName,
        body: "Buried note for @Lee after the old scan cap.",
        createdAt: 200
      })

      return workspace._id
    })

    await expect(t.withIdentity(leeIdentity).query(api.chat.channelIndicators, { workspaceId }))
      .resolves.toEqual([{ channelId: design.id, indicator: "mentioned" }])
  })
})
