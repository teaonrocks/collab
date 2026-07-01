/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")
const messagePageArgs = (channelId: Id<"channels">, numItems = 100, cursor: string | null = null) => ({
  channelId,
  paginationOpts: { numItems, cursor }
})

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
  vi.stubEnv("AETHER_ALLOWLIST_OPERATOR_KEY", "test-operator-key")
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("dogfood channel memberships", () => {
  it("adds dogfood allowlist entries through an operator-key protected flow and audits the change", async () => {
    const t = convexTest(schema, modules)
    const diegoIdentity = {
      tokenIdentifier: "https://issuer.example|diego",
      email: "DIEGO@EXAMPLE.COM",
      name: "Diego Rivera"
    }

    await expect(t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: diegoIdentity.tokenIdentifier,
      email: diegoIdentity.email,
      displayName: diegoIdentity.name
    })).rejects.toThrow("This email is not on the Aether dogfood allowlist")

    await expect(t.mutation(api.chat.updateDogfoodAllowlist, {
      operatorKey: "test-operator-key",
      email: "  Diego@Example.com ",
      action: "add",
      reason: "  first dogfood group  "
    })).resolves.toEqual({ email: "diego@example.com", active: true })

    await expect(t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: diegoIdentity.tokenIdentifier,
      email: diegoIdentity.email,
      displayName: diegoIdentity.name
    })).resolves.toMatchObject({
      displayName: "Diego Rivera"
    })

    const records = await t.run(async (ctx) => ({
      entry: await ctx.db
        .query("dogfoodAllowlistEntries")
        .withIndex("by_email", (q) => q.eq("email", "diego@example.com"))
        .unique(),
      audit: await ctx.db
        .query("dogfoodAllowlistAudit")
        .withIndex("by_email", (q) => q.eq("email", "diego@example.com"))
        .collect()
    }))

    expect(records.entry).toMatchObject({
      email: "diego@example.com",
      active: true,
      createdBy: "operator-key",
      updatedBy: "operator-key"
    })
    expect(records.audit).toEqual([
      expect.objectContaining({
        email: "diego@example.com",
        action: "add",
        operator: "operator-key",
        reason: "first dogfood group"
      })
    ])
  })

  it("removes dogfood users, overrides bootstrap env entries, and keeps removed users blocked", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: leeIdentity.tokenIdentifier,
      email: leeIdentity.email,
      displayName: leeIdentity.name
    })

    await expect(t.mutation(api.chat.updateDogfoodAllowlist, {
      operatorKey: "test-operator-key",
      email: "Lee@Example.com",
      action: "remove",
      reason: "offboarded"
    })).resolves.toEqual({ email: "lee@example.com", active: false })

    await expect(t.withIdentity(leeIdentity).query(api.chat.viewer))
      .rejects.toThrow("This email is not on the Aether dogfood allowlist")
    await expect(t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: leeIdentity.tokenIdentifier,
      email: leeIdentity.email,
      displayName: leeIdentity.name
    })).rejects.toThrow("This email is not on the Aether dogfood allowlist")

    const audit = await t.run((ctx) =>
      ctx.db
        .query("dogfoodAllowlistAudit")
        .withIndex("by_email", (q) => q.eq("email", "lee@example.com"))
        .collect()
    )
    expect(audit).toEqual([
      expect.objectContaining({
        email: "lee@example.com",
        action: "remove",
        reason: "offboarded"
      })
    ])
  })

  it("rejects allowlist management without the server-side operator key", async () => {
    const t = convexTest(schema, modules)

    await expect(t.mutation(api.chat.updateDogfoodAllowlist, {
      operatorKey: "wrong-key",
      email: "friend@example.com",
      action: "add"
    })).rejects.toThrow("Dogfood allowlist operator key is invalid")

    const audit = await t.run((ctx) =>
      ctx.db
        .query("dogfoodAllowlistAudit")
        .withIndex("by_email", (q) => q.eq("email", "friend@example.com"))
        .collect()
    )
    expect(audit).toEqual([])
  })

  it("logs sanitized Convex diagnostic context when a dogfood function fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier,
      email: mayaIdentity.email,
      displayName: mayaIdentity.name
    })

    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design!" }))
      .rejects.toThrow("Channel names can only use letters, numbers, dashes, and underscores")

    expect(errorSpy).toHaveBeenCalledWith("Dogfood Convex function failed", expect.objectContaining({
      operation: "createChannel",
      context: expect.objectContaining({
        nameLength: "7",
        visibility: "public"
      }),
      error: "Channel names can only use letters, numbers, dashes, and underscores"
    }))
    const serializedLogs = JSON.stringify(errorSpy.mock.calls)
    expect(serializedLogs).not.toContain(mayaIdentity.email)
    expect(serializedLogs).not.toContain(mayaIdentity.tokenIdentifier)
  })

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

    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, {
      name: "leadership",
      visibility: "private"
    })).rejects.toThrow("Private channel creation is unavailable until member invitations are supported")
  })

  it("lets allowlisted users idempotently join created shared channels before reading messages", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier,
      email: mayaIdentity.email,
      displayName: mayaIdentity.name
    })

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(design.id)))
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

    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(design.id)))
      .resolves.toMatchObject({ page: [] })

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
    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(privateChannelId)))
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

    const { workspaceId, designMessageId, productMessageId } = await t.run(async (ctx) => {
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
      const designMessageId = await ctx.db.insert("messages", {
        workspaceId: workspace._id,
        channelId: design.id,
        authorUserId: maya._id,
        authorDisplayName: maya.displayName,
        body: "@Lee can you review the design notes?",
        createdAt: 100
      })
      const productMessageId = await ctx.db.insert("messages", {
        workspaceId: workspace._id,
        channelId: product.id,
        authorUserId: maya._id,
        authorDisplayName: maya.displayName,
        body: "@Maya left product context for later.",
        createdAt: 101
      })
      return { workspaceId: workspace._id, designMessageId, productMessageId }
    })

    await t.withIdentity(leeIdentity).mutation(api.chat.markChannelRead, {
      channelId: product.id,
      readThroughMessageId: productMessageId
    })

    expect(await t.withIdentity(leeIdentity).query(api.chat.channelIndicators, { workspaceId }))
      .toEqual([{ channelId: design.id, indicator: "mentioned" }])

    await t.withIdentity(leeIdentity).mutation(api.chat.markChannelRead, {
      channelId: design.id,
      readThroughMessageId: designMessageId
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

    const { workspaceId, loadedMessageId } = await t.run(async (ctx) => {
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
      const loadedMessageId = await ctx.db.insert("messages", {
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
      return { workspaceId: workspace._id, loadedMessageId }
    })

    await t.withIdentity(leeIdentity).mutation(api.chat.markChannelRead, {
      channelId: design.id,
      readThroughMessageId: loadedMessageId
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

  it("keeps near-match mention text as unread instead of mentioned", async () => {
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
        body: "Could @Leeland review lee@example.com before launch?",
        createdAt: 100
      })

      return workspace._id
    })

    await expect(t.withIdentity(leeIdentity).query(api.chat.channelIndicators, { workspaceId }))
      .resolves.toEqual([{ channelId: design.id, indicator: "unread" }])
  })

  it("lists every workspace member for public channels and only channel members for private channels", async () => {
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
    const leadership = await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").first()
      const maya = await ctx.db
        .query("users")
        .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", mayaIdentity.tokenIdentifier))
        .unique()
      if (workspace === null || maya === null) throw new Error("Expected seeded workspace and user")
      const now = Date.now()
      const channelId = await ctx.db.insert("channels", {
        workspaceId: workspace._id,
        key: "leadership",
        name: "leadership",
        visibility: "private",
        createdAt: now
      })
      await ctx.db.insert("channelMemberships", {
        channelId,
        userId: maya._id,
        role: "member",
        createdAt: now,
        lastReadAt: now
      })
      return { id: channelId }
    })

    await expect(t.withIdentity(mayaIdentity).query(api.chat.channelMembers, { channelId: design.id }))
      .resolves.toEqual([
        expect.objectContaining({ displayName: "Lee Chen" }),
        expect.objectContaining({ displayName: "Maya Patel" })
      ])

    await expect(t.withIdentity(mayaIdentity).query(api.chat.channelMembers, { channelId: leadership.id }))
      .resolves.toEqual([expect.objectContaining({ displayName: "Maya Patel" })])
  })

  it("adds, removes, and broadcasts message reactions with current-user state", async () => {
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
    const message = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "Reaction state should stay realtime."
    })

    await t.withIdentity(leeIdentity).mutation(api.chat.toggleMessageReaction, {
      channelId: design.id,
      messageId: message.id,
      emoji: "👍"
    })

    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(design.id)).then((result) => result.page))
      .resolves.toEqual([
        expect.objectContaining({
          id: message.id,
          reactions: [{ emoji: "👍", count: 1, reactedByCurrentUser: true }]
        })
      ])
    await expect(t.withIdentity(mayaIdentity).query(api.chat.channelMessages, messagePageArgs(design.id)).then((result) => result.page))
      .resolves.toEqual([
        expect.objectContaining({
          id: message.id,
          reactions: [{ emoji: "👍", count: 1, reactedByCurrentUser: false }]
        })
      ])

    await t.withIdentity(leeIdentity).mutation(api.chat.toggleMessageReaction, {
      channelId: design.id,
      messageId: message.id,
      emoji: "👍"
    })

    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(design.id)).then((result) => result.page))
      .resolves.toEqual([expect.objectContaining({ id: message.id, reactions: [] })])
  })

  it("creates message replies with compact parent previews", async () => {
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
    const parent = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "Parent context ".repeat(20)
    })
    const reply = await t.withIdentity(leeIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "Replying with the next step.",
      parentMessageId: parent.id
    })

    expect(reply).toMatchObject({
      parentMessageId: parent.id,
      parentMessage: {
        id: parent.id,
        authorDisplayName: "Maya Patel",
        deleted: false
      }
    })
    expect(reply.parentMessage?.bodyPreview.length).toBeLessThanOrEqual(120)

    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(design.id)).then((result) => result.page))
      .resolves.toEqual([
        expect.objectContaining({
          id: reply.id,
          parentMessageId: parent.id,
          parentMessage: expect.objectContaining({
            id: parent.id,
            authorDisplayName: "Maya Patel",
            deleted: false
          })
        }),
        expect.objectContaining({ id: parent.id, parentMessageId: null, parentMessage: null })
      ])
  })

  it("stores attachment metadata from Convex storage and hydrates signed URLs", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier,
      email: mayaIdentity.email,
      displayName: mayaIdentity.name
    })

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["image"], { type: "image/png" })))
    await t.run(async (ctx) => {
      const user = await ctx.db.query("users").withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", mayaIdentity.tokenIdentifier)).unique()
      if (user === null) throw new Error("test user missing")
      await ctx.db.insert("attachmentUploads", { storageId, uploaderUserId: user._id, contentType: "image/png", createdAt: Date.now() })
    })
    const message = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "",
      attachments: [{ storageId, name: "  brief.png  " }]
    })

    expect(message).toMatchObject({
      body: "",
      attachments: [expect.objectContaining({
        storageId,
        name: "brief.png",
        contentType: "image/png",
        size: 5,
        kind: "image"
      })]
    })
    expect(message.attachments[0]?.url).toEqual(expect.any(String))

    await expect(t.withIdentity(mayaIdentity).query(api.chat.channelMessages, messagePageArgs(design.id)).then((result) => result.page))
      .resolves.toEqual([
        expect.objectContaining({
          id: message.id,
          attachments: [expect.objectContaining({ storageId, url: expect.any(String) })]
        })
      ])
  })

  it("enforces attachment policy and ownership, then deletes claimed storage with its message", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier, email: mayaIdentity.email, displayName: mayaIdentity.name
    })
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: leeIdentity.tokenIdentifier, email: leeIdentity.email, displayName: leeIdentity.name
    })
    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "attachment-policy" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })

    const disallowedId = await t.run((ctx) => ctx.storage.store(new Blob(["binary"])))
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.registerAttachmentUpload, {
      storageId: disallowedId, contentType: "application/zip"
    })).rejects.toThrow("Attachments must be a PNG, JPEG, GIF, WebP, PDF, or plain-text file")

    const oversizedId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(25 * 1024 * 1024 + 1)])))
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.registerAttachmentUpload, {
      storageId: oversizedId, contentType: "image/png"
    })).rejects.toThrow("Attachments can be at most 25 MB")

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["private"])))
    await t.withIdentity(mayaIdentity).mutation(api.chat.registerAttachmentUpload, { storageId, contentType: "text/plain" })
    await expect(t.withIdentity(leeIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id, body: "", attachments: [{ storageId, name: "private.txt" }]
    })).rejects.toThrow("Attachment upload is not owned by the current user")

    const message = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id, body: "", attachments: [{ storageId, name: "private.txt" }]
    })
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id, body: "", attachments: [{ storageId, name: "again.txt" }]
    })).rejects.toThrow("has already been claimed")
    const issuedUrl = message.attachments[0]?.url
    expect(issuedUrl).toEqual(expect.any(String))

    await t.withIdentity(mayaIdentity).mutation(api.chat.deleteMessage, { channelId: design.id, messageId: message.id })
    await expect(t.run((ctx) => ctx.db.system.get("_storage", storageId))).resolves.toBeNull()
    expect(issuedUrl).not.toBeNull()
  })

  it("rejects reply parents from another channel and keeps replies visible after parent deletion", async () => {
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
    const parent = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "Parent in design."
    })

    await expect(t.withIdentity(leeIdentity).mutation(api.chat.sendMessage, {
      channelId: product.id,
      body: "Wrong channel reply.",
      parentMessageId: parent.id
    })).rejects.toThrow("Parent message not found")

    const reply = await t.withIdentity(leeIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "Valid reply before deletion.",
      parentMessageId: parent.id
    })
    await t.withIdentity(mayaIdentity).mutation(api.chat.deleteMessage, {
      channelId: design.id,
      messageId: parent.id
    })

    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(design.id)).then((result) => result.page))
      .resolves.toEqual([
        expect.objectContaining({
          id: reply.id,
          body: "Valid reply before deletion.",
          parentMessageId: parent.id,
          parentMessage: {
            id: parent.id,
            authorDisplayName: "Original message",
            bodyPreview: "",
            deleted: true
          }
        })
      ])
  })

  it("paginates through complete channel history with an explicit page-size limit", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier,
      email: mayaIdentity.email,
      displayName: mayaIdentity.name
    })
    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })

    await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
      const maya = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", mayaIdentity.email)).unique()
      if (workspace === null || maya === null) throw new Error("Seed records not found")
      for (let index = 0; index < 225; index += 1) {
        await ctx.db.insert("messages", {
          workspaceId: workspace._id,
          channelId: design.id,
          authorUserId: maya._id,
          authorDisplayName: maya.displayName,
          body: `History ${index}`,
          createdAt: 1_000 + index
        })
      }
    })

    const bodies: Array<string> = []
    let cursor: string | null = null
    let done = false
    while (!done) {
      const page: {
        readonly page: Array<{ readonly body: string }>
        readonly continueCursor: string
        readonly isDone: boolean
      } = await t.withIdentity(mayaIdentity).query(api.chat.channelMessages, messagePageArgs(design.id, 50, cursor))
      bodies.push(...page.page.map((message) => message.body))
      cursor = page.continueCursor
      done = page.isDone
    }

    expect(bodies).toHaveLength(225)
    expect(new Set(bodies)).toHaveLength(225)
    expect(bodies[0]).toBe("History 224")
    expect(bodies.at(-1)).toBe("History 0")
    await expect(t.withIdentity(mayaIdentity).query(api.chat.channelMessages, messagePageArgs(design.id, 101)))
      .rejects.toThrow("Message pages must contain between 1 and 100 items")
  })

  it("enforces exact channel, message, edit, and attachment metadata limits", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier,
      email: mayaIdentity.email,
      displayName: mayaIdentity.name
    })

    const boundaryChannel = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "c".repeat(80) })
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "c".repeat(81) }))
      .rejects.toThrow("Channel names can contain at most 80 characters")

    const boundaryMessage = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: boundaryChannel.id,
      body: "m".repeat(8_000)
    })
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: boundaryChannel.id,
      body: "m".repeat(8_001)
    })).rejects.toThrow("Message bodies can contain at most 8000 characters")
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.editMessage, {
      channelId: boundaryChannel.id,
      messageId: boundaryMessage.id,
      body: "e".repeat(8_000)
    })).resolves.toMatchObject({ body: "e".repeat(8_000) })
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.editMessage, {
      channelId: boundaryChannel.id,
      messageId: boundaryMessage.id,
      body: "e".repeat(8_001)
    })).rejects.toThrow("Message bodies can contain at most 8000 characters")

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["file"])))
    await t.run(async (ctx) => {
      const user = await ctx.db.query("users").withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", mayaIdentity.tokenIdentifier)).unique()
      if (user === null) throw new Error("test user missing")
      await ctx.db.insert("attachmentUploads", { storageId, uploaderUserId: user._id, contentType: "text/plain", createdAt: Date.now() })
    })
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: boundaryChannel.id,
      body: "",
      attachments: [{ storageId, name: "a".repeat(180) }]
    })).resolves.toMatchObject({ attachments: [expect.objectContaining({ name: "a".repeat(180) })] })
    const secondStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["file"])))
    await t.run(async (ctx) => {
      const user = await ctx.db.query("users").withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", mayaIdentity.tokenIdentifier)).unique()
      if (user === null) throw new Error("test user missing")
      await ctx.db.insert("attachmentUploads", { storageId: secondStorageId, uploaderUserId: user._id, contentType: "text/plain", createdAt: Date.now() })
    })
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: boundaryChannel.id,
      body: "",
      attachments: [{ storageId: secondStorageId, name: "a".repeat(181) }]
    })).rejects.toThrow("Attachment names can contain at most 180 characters")
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: boundaryChannel.id,
      body: "",
      attachments: Array.from({ length: 5 }, () => ({ storageId, name: "file" }))
    })).rejects.toThrow("Messages can include at most 4 attachments")
  })

  it("enforces the maximum channel count instead of hiding excess channels", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier,
      email: mayaIdentity.email,
      displayName: mayaIdentity.name
    })
    await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
      if (workspace === null) throw new Error("Workspace not found")
      for (let index = 1; index < 100; index += 1) {
        await ctx.db.insert("channels", {
          workspaceId: workspace._id,
          key: `channel-${index}`,
          name: `channel-${index}`,
          visibility: "public",
          createdAt: index
        })
      }
    })

    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "one-too-many" }))
      .rejects.toThrow("Workspaces can contain at most 100 channels")
  })

  it("validates read markers against a real message in the selected channel", async () => {
    const t = convexTest(schema, modules)
    for (const identity of [mayaIdentity, leeIdentity]) {
      await t.mutation(internal.chat.ensureViewerForIdentity, {
        tokenIdentifier: identity.tokenIdentifier,
        email: identity.email,
        displayName: identity.name
      })
    }
    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    const product = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "product" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })
    const productMessage = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: product.id,
      body: "Product-only marker"
    })

    await expect(t.withIdentity(leeIdentity).mutation(api.chat.markChannelRead, {
      channelId: design.id,
      readThroughMessageId: productMessage.id
    })).rejects.toThrow("Read-through message not found in this channel")
  })

  it("keeps unread and mention work bounded across a dense multi-channel dataset", async () => {
    const t = convexTest(schema, modules)
    for (const identity of [mayaIdentity, leeIdentity]) {
      await t.mutation(internal.chat.ensureViewerForIdentity, {
        tokenIdentifier: identity.tokenIdentifier,
        email: identity.email,
        displayName: identity.name
      })
    }

    const channels: Array<{ readonly id: Id<"channels"> }> = []
    for (let index = 0; index < 10; index += 1) {
      const channel = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: `dense-${index}` })
      await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: channel.id })
      channels.push(channel)
    }

    const workspaceId = await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
      const maya = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", mayaIdentity.email)).unique()
      const lee = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", leeIdentity.email)).unique()
      if (workspace === null || maya === null || lee === null) throw new Error("Seed records not found")
      for (const channel of channels) {
        const membership = await ctx.db
          .query("channelMemberships")
          .withIndex("by_channel_user", (q) => q.eq("channelId", channel.id).eq("userId", lee._id))
          .unique()
        if (membership === null) throw new Error("Membership not found")
        await ctx.db.patch(membership._id, { lastReadAt: 1 })
      }
      for (const [channelIndex, channel] of channels.entries()) {
        for (let messageIndex = 0; messageIndex < 60; messageIndex += 1) {
          const isBoundedOutMention = channelIndex === 0 && messageIndex === 0
          const isRecentMention = channelIndex === 1 && messageIndex === 59
          await ctx.db.insert("messages", {
            workspaceId: workspace._id,
            channelId: channel.id,
            authorUserId: maya._id,
            authorDisplayName: maya.displayName,
            body: isBoundedOutMention || isRecentMention ? "@Lee review this" : `Dense context ${messageIndex}`,
            createdAt: 100 + messageIndex
          })
        }
      }
      return workspace._id
    })

    const indicators = await t.withIdentity(leeIdentity).query(api.chat.channelIndicators, { workspaceId })
    expect(indicators).toHaveLength(10)
    expect(indicators.find((indicator) => indicator.channelId === channels[0]!.id)?.indicator).toBe("unread")
    expect(indicators.find((indicator) => indicator.channelId === channels[1]!.id)?.indicator).toBe("mentioned")
  })

  it("collapses duplicate reaction rows from the same user", async () => {
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
    const message = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "Duplicate rows should not double count."
    })

    await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
      const lee = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", leeIdentity.email)).unique()
      if (workspace === null || lee === null) throw new Error("Seed records not found")
      await ctx.db.insert("messageReactions", {
        workspaceId: workspace._id,
        channelId: design.id,
        messageId: message.id,
        userId: lee._id,
        emoji: "👍",
        createdAt: 10
      })
      await ctx.db.insert("messageReactions", {
        workspaceId: workspace._id,
        channelId: design.id,
        messageId: message.id,
        userId: lee._id,
        emoji: "👍",
        createdAt: 11
      })
    })

    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(design.id)).then((result) => result.page))
      .resolves.toEqual([
        expect.objectContaining({
          id: message.id,
          reactions: [{ emoji: "👍", count: 1, reactedByCurrentUser: true }]
        })
      ])

    await t.withIdentity(leeIdentity).mutation(api.chat.toggleMessageReaction, {
      channelId: design.id,
      messageId: message.id,
      emoji: "👍"
    })

    const rows = await t.run((ctx) =>
      ctx.db
        .query("messageReactions")
        .withIndex("by_message", (q) => q.eq("messageId", message.id))
        .collect()
    )
    expect(rows).toHaveLength(0)
  })
})
