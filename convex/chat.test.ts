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

const diegoIdentity = {
  tokenIdentifier: "https://issuer.example|diego-private-membership",
  email: "diego@example.com",
  name: "Diego Rivera"
}

beforeEach(() => {
  vi.stubEnv("AETHER_ALLOWED_EMAILS", "maya@example.com,lee@example.com")
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("dogfood channel memberships", () => {
  it("adds dogfood allowlist entries through deployment-scoped tooling and audits the operator", async () => {
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

    await expect(t.mutation(internal.chat.administerDogfoodAllowlist, {
      operator: "Archer Chua",
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
      createdBy: "Archer Chua",
      updatedBy: "Archer Chua"
    })
    expect(records.audit).toEqual([
      expect.objectContaining({
        email: "diego@example.com",
        action: "add",
        operator: "Archer Chua",
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

    await expect(t.mutation(internal.chat.administerDogfoodAllowlist, {
      operator: "Archer Chua",
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

  it("rejects allowlist management without an attributable operator and logs no credentials", async () => {
    const t = convexTest(schema, modules)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(t.mutation(internal.chat.administerDogfoodAllowlist, {
      operator: "   ",
      email: "friend@example.com",
      action: "add"
    })).rejects.toThrow("Operator identity must contain between 1 and 120 characters")

    const audit = await t.run((ctx) =>
      ctx.db
        .query("dogfoodAllowlistAudit")
        .withIndex("by_email", (q) => q.eq("email", "friend@example.com"))
        .collect()
    )
    expect(audit).toEqual([])
    const serializedLogs = JSON.stringify(errorSpy.mock.calls)
    expect(serializedLogs).toContain("administerDogfoodAllowlist")
    expect(serializedLogs).not.toContain("friend@example.com")
    expect(serializedLogs).not.toContain("Operator identity must")
  })

  it("logs sanitized Convex diagnostic context when a dogfood function fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.ensureViewerForIdentity, {
      tokenIdentifier: mayaIdentity.tokenIdentifier,
      email: mayaIdentity.email,
      displayName: mayaIdentity.name
    })

    const unsafeInput = "https://private.example/friend@example.com?token=secret&api_key=oops"
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: unsafeInput }))
      .rejects.toThrow("Channel names can only use letters, numbers, dashes, and underscores")

    expect(errorSpy).toHaveBeenCalledWith("Dogfood Convex function failed", expect.objectContaining({
      operation: "createChannel",
      context: expect.objectContaining({
        nameLength: String(unsafeInput.length),
        visibility: "public"
      }),
      error: "Error: details redacted; use the diagnostic context and timestamp for support"
    }))
    const serializedLogs = JSON.stringify(errorSpy.mock.calls)
    expect(serializedLogs).not.toContain(mayaIdentity.email)
    expect(serializedLogs).not.toContain(mayaIdentity.tokenIdentifier)
    expect(serializedLogs).not.toContain("Channel names can only")
    expect(serializedLogs).not.toContain("https://private.example/path?token=secret")
    expect(serializedLogs).not.toContain("secret mutation details")
    expect(serializedLogs).not.toContain("friend@example.com")
    expect(serializedLogs).not.toContain("token=secret")
    expect(serializedLogs).not.toContain("api_key=oops")
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
    })).resolves.toMatchObject({ name: "leadership", visibility: "private" })
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

  it("creates private channels atomically with an admin creator and eligible initial members", async () => {
    const t = convexTest(schema, modules)
    for (const identity of [mayaIdentity, leeIdentity]) {
      await t.mutation(internal.chat.ensureViewerForIdentity, {
        tokenIdentifier: identity.tokenIdentifier,
        email: identity.email,
        displayName: identity.name
      })
    }

    const { mayaId, leeId } = await t.run(async (ctx) => {
      const maya = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", mayaIdentity.email)).unique()
      const lee = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", leeIdentity.email)).unique()
      if (maya === null || lee === null) throw new Error("Seeded users not found")
      return { mayaId: maya._id, leeId: lee._id }
    })
    const leadership = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, {
      name: "leadership-team",
      visibility: "private",
      initialMemberIds: [leeId, leeId, mayaId]
    })

    await expect(t.withIdentity(mayaIdentity).query(api.chat.channelMembers, { channelId: leadership.id }))
      .resolves.toEqual([
        expect.objectContaining({ id: leeId, role: "member" }),
        expect.objectContaining({ id: mayaId, role: "admin" })
      ])
    await expect(t.withIdentity(mayaIdentity).query(api.chat.eligiblePrivateChannelMembers, {
      channelId: leadership.id
    })).resolves.toEqual([])
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.removePrivateChannelMember, {
      channelId: leadership.id,
      userId: mayaId
    })).rejects.toThrow("The last channel admin cannot be removed")

    const invalidUserId = await t.run((ctx) => ctx.db.insert("users", {
      email: "outside@example.com",
      displayName: "Outside User",
      createdAt: 1,
      updatedAt: 1
    }))
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, {
      name: "invalid-initial-members",
      visibility: "private",
      initialMemberIds: [invalidUserId]
    })).rejects.toThrow("Current user is not a member of this workspace")
    const invalidChannel = await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
      if (workspace === null) throw new Error("Workspace not found")
      return ctx.db.query("channels").withIndex("by_workspace_key", (q) =>
        q.eq("workspaceId", workspace._id).eq("key", "invalid-initial-members")).unique()
    })
    expect(invalidChannel).toBeNull()
  })

  it("lets only private-channel admins idempotently add and remove eligible members, revoking channel access", async () => {
    const t = convexTest(schema, modules)
    await t.mutation(internal.chat.administerDogfoodAllowlist, {
      operator: "Test operator",
      email: diegoIdentity.email,
      action: "add"
    })
    for (const identity of [mayaIdentity, leeIdentity, diegoIdentity]) {
      await t.mutation(internal.chat.ensureViewerForIdentity, {
        tokenIdentifier: identity.tokenIdentifier,
        email: identity.email,
        displayName: identity.name
      })
    }

    const { workspaceId, mayaId, leeId, diegoId, blockedId } = await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
      const maya = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", mayaIdentity.email)).unique()
      const lee = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", leeIdentity.email)).unique()
      const diego = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", diegoIdentity.email)).unique()
      if (workspace === null || maya === null || lee === null || diego === null) throw new Error("Seed records not found")
      const blockedId = await ctx.db.insert("users", {
        email: "blocked@example.com",
        displayName: "Blocked User",
        createdAt: 1,
        updatedAt: 1
      })
      await ctx.db.insert("workspaceMemberships", {
        workspaceId: workspace._id,
        userId: blockedId,
        role: "member",
        createdAt: 1
      })
      return { workspaceId: workspace._id, mayaId: maya._id, leeId: lee._id, diegoId: diego._id, blockedId }
    })
    const strategy = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, {
      name: "strategy-room",
      visibility: "private"
    })

    await expect(t.withIdentity(diegoIdentity).query(api.chat.eligiblePrivateChannelMembers, {
      channelId: strategy.id
    })).rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(mayaIdentity).query(api.chat.eligiblePrivateChannelMembers, {
      channelId: strategy.id
    })).resolves.toEqual([
      { id: diegoId, displayName: "Diego Rivera" },
      { id: leeId, displayName: "Lee Chen" }
    ])

    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.addPrivateChannelMember, {
      channelId: strategy.id,
      userId: blockedId
    })).rejects.toThrow("Invited user is not on the Aether dogfood allowlist")
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.addPrivateChannelMember, {
      channelId: strategy.id,
      userId: leeId
    })).resolves.toEqual({ channelId: strategy.id, userId: leeId, member: true })
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.addPrivateChannelMember, {
      channelId: strategy.id,
      userId: leeId
    })).resolves.toEqual({ channelId: strategy.id, userId: leeId, member: true })
    await expect(t.withIdentity(leeIdentity).mutation(api.chat.addPrivateChannelMember, {
      channelId: strategy.id,
      userId: diegoId
    })).rejects.toThrow("Only channel admins can administer private channel membership")
    await expect(t.withIdentity(leeIdentity).mutation(api.chat.removePrivateChannelMember, {
      channelId: strategy.id,
      userId: mayaId
    })).rejects.toThrow("Only channel admins can administer private channel membership")

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["secret"], { type: "text/plain" })))
    await t.run((ctx) => ctx.db.insert("attachmentUploads", {
      storageId,
      uploaderUserId: mayaId,
      contentType: "text/plain",
      createdAt: Date.now()
    }))
    const secret = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: strategy.id,
      body: "Private roadmap",
      attachments: [{ storageId, name: "roadmap.txt" }]
    })
    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(strategy.id)))
      .resolves.toMatchObject({ page: [expect.objectContaining({
        id: secret.id,
        attachments: [expect.objectContaining({ url: expect.any(String) })]
      })] })

    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.removePrivateChannelMember, {
      channelId: strategy.id,
      userId: leeId
    })).resolves.toEqual({ channelId: strategy.id, userId: leeId, member: false })
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.removePrivateChannelMember, {
      channelId: strategy.id,
      userId: leeId
    })).resolves.toEqual({ channelId: strategy.id, userId: leeId, member: false })

    await expect(t.withIdentity(leeIdentity).query(api.chat.channels, { workspaceId }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: strategy.id })]))
    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(strategy.id)))
      .rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(leeIdentity).query(api.chat.searchChannelMessages, {
      channelId: strategy.id,
      query: "roadmap"
    })).rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(leeIdentity).mutation(api.chat.markChannelRead, {
      channelId: strategy.id,
      readThroughMessageId: secret.id
    })).rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMembers, { channelId: strategy.id }))
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
      await ctx.db.insert("messageMentions", {
        channelId: design.id,
        messageId: designMessageId,
        userId: lee._id,
        messageCreatedAt: 100
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
      await ctx.db.patch(membership._id, { lastReadAt: 1, mentionTrackingStartedAt: 1 })

      await ctx.db.insert("messages", {
        workspaceId: workspace._id,
        channelId: design.id,
        authorUserId: maya._id,
        authorDisplayName: maya.displayName,
        body: "Buried note for @Lee before newer unread messages.",
        createdAt: 100
      })
      const mentionMessage = await ctx.db
        .query("messages")
        .withIndex("by_channel_created_at", (q) => q.eq("channelId", design.id).eq("createdAt", 100))
        .unique()
      if (mentionMessage === null) throw new Error("Mention message not found")
      await ctx.db.insert("messageMentions", {
        channelId: design.id,
        messageId: mentionMessage._id,
        userId: lee._id,
        messageCreatedAt: mentionMessage.createdAt
      })

      for (let index = 0; index < 50; index += 1) {
        await ctx.db.insert("messages", {
          workspaceId: workspace._id,
          channelId: design.id,
          authorUserId: maya._id,
          authorDisplayName: maya.displayName,
          body: `Unread context ${index}`,
          createdAt: 101 + index
        })
      }

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

  it("keeps legacy pre-index mentions bounded as unread", async () => {
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
    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "legacy-mentions" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })

    const workspaceId = await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
      const maya = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", mayaIdentity.email)).unique()
      const lee = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", leeIdentity.email)).unique()
      if (workspace === null || maya === null || lee === null) throw new Error("Seed records not found")
      const membership = await ctx.db.query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", design.id).eq("userId", lee._id)).unique()
      if (membership === null) throw new Error("Membership not found")
      await ctx.db.patch(membership._id, { lastReadAt: 1 })
      await ctx.db.insert("messages", {
        workspaceId: workspace._id,
        channelId: design.id,
        authorUserId: maya._id,
        authorDisplayName: maya.displayName,
        body: "Legacy @Lee mention without an indexed mention row.",
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
    const { intentId: disallowedIntentId } = await t.withIdentity(mayaIdentity)
      .mutation(api.chat.generateAttachmentUploadUrl, {})
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.registerAttachmentUpload, {
      intentId: disallowedIntentId, storageId: disallowedId, contentType: "application/zip"
    })).resolves.toEqual({
      status: "rejected",
      reason: "Attachments must be a PNG, JPEG, GIF, WebP, PDF, or plain-text file"
    })
    await expect(t.run((ctx) => ctx.db.system.get("_storage", disallowedId))).resolves.toBeNull()

    const oversizedId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(25 * 1024 * 1024 + 1)])))
    const { intentId: oversizedIntentId } = await t.withIdentity(mayaIdentity)
      .mutation(api.chat.generateAttachmentUploadUrl, {})
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.registerAttachmentUpload, {
      intentId: oversizedIntentId, storageId: oversizedId, contentType: "image/png"
    })).resolves.toEqual({ status: "rejected", reason: "Attachments can be at most 25 MB" })
    await expect(t.run((ctx) => ctx.db.system.get("_storage", oversizedId))).resolves.toBeNull()

    const abandonedId = await t.run((ctx) => ctx.storage.store(new Blob(["abandoned"])))
    const { intentId: abandonedIntentId } = await t.withIdentity(mayaIdentity)
      .mutation(api.chat.generateAttachmentUploadUrl, {})
    await expect(t.withIdentity(leeIdentity).mutation(api.chat.deleteAttachmentUpload, {
      intentId: abandonedIntentId,
      storageId: abandonedId
    })).rejects.toThrow("Only the uploader")
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.deleteAttachmentUpload, {
      intentId: abandonedIntentId,
      storageId: abandonedId
    })).resolves.toEqual({ storageId: abandonedId })
    await expect(t.run((ctx) => ctx.db.system.get("_storage", abandonedId))).resolves.toBeNull()

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["private"])))
    const { intentId } = await t.withIdentity(mayaIdentity).mutation(api.chat.generateAttachmentUploadUrl, {})
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.registerAttachmentUpload, {
      intentId,
      storageId,
      contentType: "text/plain"
    })).resolves.toEqual({ status: "registered", storageId })
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.registerAttachmentUpload, {
      intentId,
      storageId,
      contentType: "text/plain"
    })).resolves.toEqual({ status: "registered", storageId })
    await expect(t.withIdentity(leeIdentity).mutation(api.chat.registerAttachmentUpload, {
      intentId,
      storageId,
      contentType: "text/plain"
    })).rejects.toThrow("already registered")
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

  it("searches the full authorized channel history with a bounded query", async () => {
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
    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design-search" })
    const product = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "product-search" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })

    await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
      const maya = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", mayaIdentity.email)).unique()
      if (workspace === null || maya === null) throw new Error("Seed records not found")
      for (let index = 0; index < 70; index += 1) {
        await ctx.db.insert("messages", {
          workspaceId: workspace._id,
          channelId: design.id,
          authorUserId: maya._id,
          authorDisplayName: maya.displayName,
          body: index === 0 ? "The buried archaeology decision is approved." : `Recent design note ${index}`,
          createdAt: 1_000 + index
        })
      }
      await ctx.db.insert("messages", {
        workspaceId: workspace._id,
        channelId: product.id,
        authorUserId: maya._id,
        authorDisplayName: maya.displayName,
        body: "A product archaeology decision.",
        createdAt: 2_000
      })
    })

    await expect(t.withIdentity(leeIdentity).query(api.chat.searchChannelMessages, {
      channelId: design.id,
      query: "archaeology"
    })).resolves.toEqual([
      expect.objectContaining({
        channelId: design.id,
        body: "The buried archaeology decision is approved."
      })
    ])
    await expect(t.withIdentity(leeIdentity).query(api.chat.searchChannelMessages, {
      channelId: product.id,
      query: "archaeology"
    })).rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(mayaIdentity).query(api.chat.searchChannelMessages, {
      channelId: design.id,
      query: "x".repeat(121)
    })).rejects.toThrow("Search queries can contain at most 120 characters")
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
          const isBuriedMention = channelIndex === 0 && messageIndex === 0
          const isRecentMention = channelIndex === 1 && messageIndex === 59
          const messageId = await ctx.db.insert("messages", {
            workspaceId: workspace._id,
            channelId: channel.id,
            authorUserId: maya._id,
            authorDisplayName: maya.displayName,
            body: isBuriedMention || isRecentMention ? "@Lee review this" : `Dense context ${messageIndex}`,
            createdAt: 100 + messageIndex
          })
          if (isBuriedMention || isRecentMention) {
            await ctx.db.insert("messageMentions", {
              channelId: channel.id,
              messageId,
              userId: lee._id,
              messageCreatedAt: 100 + messageIndex
            })
          }
        }
      }
      return workspace._id
    })

    const indicators = await t.withIdentity(leeIdentity).query(api.chat.channelIndicators, { workspaceId })
    expect(indicators).toHaveLength(10)
    expect(indicators.find((indicator) => indicator.channelId === channels[0]!.id)?.indicator).toBe("mentioned")
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

  it("batches reactions for new messages while preserving legacy fallback rows", async () => {
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
    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "reaction-batch" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })
    const current = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "Current reaction path"
    })
    const legacyId = await t.run(async (ctx) => {
      const workspace = await ctx.db.query("workspaces").withIndex("by_key", (q) => q.eq("key", "aether-dogfood")).unique()
      const maya = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", mayaIdentity.email)).unique()
      const lee = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", leeIdentity.email)).unique()
      if (workspace === null || maya === null || lee === null) throw new Error("Seed records not found")
      const legacyId = await ctx.db.insert("messages", {
        workspaceId: workspace._id,
        channelId: design.id,
        authorUserId: maya._id,
        authorDisplayName: maya.displayName,
        body: "Legacy reaction path",
        createdAt: current.createdAt - 1
      })
      await ctx.db.insert("messageReactions", {
        workspaceId: workspace._id,
        channelId: design.id,
        messageId: legacyId,
        userId: lee._id,
        emoji: "👀",
        createdAt: 10
      })
      return legacyId
    })
    await t.withIdentity(leeIdentity).mutation(api.chat.toggleMessageReaction, {
      channelId: design.id,
      messageId: current.id,
      emoji: "👍"
    })

    const page = await t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(design.id))
    expect(page.page.find((message) => message.id === current.id)?.reactions)
      .toEqual([{ emoji: "👍", count: 1, reactedByCurrentUser: true }])
    expect(page.page.find((message) => message.id === legacyId)?.reactions)
      .toEqual([{ emoji: "👀", count: 1, reactedByCurrentUser: true }])
  })
})
