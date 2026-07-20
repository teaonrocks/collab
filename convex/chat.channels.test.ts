/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { describe, expect, it, vi } from "vitest"
import {
  api,
  internal,
  createChatScenario,
  diegoIdentity,
  ensureViewer,
  ensureViewers,
  leeIdentity,
  mayaIdentity,
  messagePageArgs,
  requireDogfoodWorkspace,
  requireSeededUser,
  silenceExpectedDogfoodDiagnostics
} from "../src/test/convex-chat"

describe("dogfood channel lifecycle and membership", () => {
  it("normalizes channel names and rejects empty, duplicate, and unsupported names", async () => {
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
    await ensureViewer(t, mayaIdentity)

    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "   ###   " })).rejects.toThrow(
      "Channel name is required"
    )
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design!" })).rejects.toThrow(
      "Channel names can only use letters, numbers, dashes, and underscores"
    )

    const product = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "  #Product Team  " })
    expect(product).toMatchObject({
      key: "product-team",
      name: "product-team",
      visibility: "public"
    })

    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "product team" })
    ).rejects.toThrow("Channel already exists")

    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, {
        name: "leadership",
        visibility: "private"
      })
    ).resolves.toMatchObject({ name: "leadership", visibility: "private" })
  })

  it("lets a channel creator rename and soft-delete their channel", async () => {
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
    await ensureViewer(t, mayaIdentity)
    const channel = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })

    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.editChannel, {
        channelId: channel.id,
        name: "product team"
      })
    ).resolves.toMatchObject({ id: channel.id, name: "product-team" })
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.deleteChannel, { channelId: channel.id })
    ).resolves.toBeNull()
    await expect(
      t.withIdentity(mayaIdentity).query(api.chat.channelMessages, messagePageArgs(channel.id))
    ).rejects.toThrow("Channel not found")
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
        channelId: channel.id,
        body: "This channel is deleted"
      })
    ).rejects.toThrow("Channel not found")

    const workspaceId = (await requireDogfoodWorkspace(t))._id
    const visible = await t.withIdentity(mayaIdentity).query(api.chat.channels, { workspaceId })
    expect(visible.some((candidate) => candidate.id === channel.id)).toBe(false)
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "product-team" })
    ).resolves.toMatchObject({ name: "product-team" })

    const defaultChannelId = await t.run(async (ctx) => {
      const defaultChannel = await ctx.db
        .query("channels")
        .withIndex("by_workspace_key", (q) => q.eq("workspaceId", workspaceId).eq("key", "general"))
        .unique()
      if (defaultChannel === null) throw new Error("Default channel not found")
      const maya = await ctx.db
        .query("users")
        .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", mayaIdentity.tokenIdentifier))
        .unique()
      if (maya === null) throw new Error("Maya not found")
      const membership = await ctx.db
        .query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", defaultChannel._id).eq("userId", maya._id))
        .unique()
      if (membership === null) throw new Error("Default channel membership not found")
      await ctx.db.patch(membership._id, { role: "admin" })
      return defaultChannel._id
    })
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.editChannel, {
        channelId: defaultChannelId,
        name: "renamed-general"
      })
    ).rejects.toThrow("The default channel cannot be renamed")
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.deleteChannel, { channelId: defaultChannelId })
    ).rejects.toThrow("The default channel cannot be deleted")
  })

  it("lets allowlisted users idempotently join created shared channels before reading messages", async () => {
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
    await ensureViewer(t, mayaIdentity)

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    await expect(
      t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(design.id))
    ).rejects.toThrow("Current user has not been initialized")

    await ensureViewer(t, leeIdentity)

    const visibleChannels = await t.withIdentity(leeIdentity).query(api.chat.channels, {
      workspaceId: (await requireDogfoodWorkspace(t))._id
    })
    expect(visibleChannels.map((channel) => channel.name)).toContain("design")

    await expect(
      t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(design.id))
    ).resolves.toMatchObject({ page: [] })

    await expect(t.withIdentity(leeIdentity).query(api.chat.channelMembers, { channelId: design.id })).resolves.toEqual(
      [expect.objectContaining({ displayName: "Lee Chen" }), expect.objectContaining({ displayName: "Maya Patel" })]
    )

    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })

    const lee = await requireSeededUser(t, leeIdentity.email)
    const leeDesignMemberships = await t.run((ctx) =>
      ctx.db
        .query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", design.id).eq("userId", lee._id))
        .collect()
    )
    expect(leeDesignMemberships).toHaveLength(1)
  })

  it("keeps non-members isolated from private-channel discovery, reads, and mutations", async () => {
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
    await ensureViewers(t, mayaIdentity, leeIdentity)

    const { workspaceId, privateChannelId, mayaId } = await t.run(async (ctx) => {
      const workspace = await ctx.db
        .query("workspaces")
        .withIndex("by_key", (q) => q.eq("key", "aether-dogfood"))
        .unique()
      const maya = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", mayaIdentity.email))
        .unique()
      if (workspace === null || maya === null) throw new Error("Seed records not found")
      const privateChannelId = await ctx.db.insert("channels", {
        workspaceId: workspace._id,
        key: "strategy",
        name: "strategy",
        visibility: "private",
        createdAt: 100
      })
      await ctx.db.insert("channelMemberships", {
        channelId: privateChannelId,
        userId: maya._id,
        role: "admin",
        createdAt: 100,
        lastReadAt: 100
      })
      return { workspaceId: workspace._id, privateChannelId, mayaId: maya._id }
    })

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["secret"], { type: "text/plain" })))
    await t.run((ctx) =>
      ctx.db.insert("attachmentUploads", {
        storageId,
        uploaderUserId: mayaId,
        contentType: "text/plain",
        createdAt: 101
      })
    )
    const secret = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: privateChannelId,
      body: "Private strategy",
      attachments: [{ storageId, name: "strategy.txt" }]
    })
    await expect(
      t.withIdentity(mayaIdentity).query(api.chat.channelMessages, messagePageArgs(privateChannelId))
    ).resolves.toMatchObject({
      page: [
        expect.objectContaining({
          id: secret.id,
          attachments: [expect.objectContaining({ url: expect.any(String) })]
        })
      ]
    })

    const visibleChannels = await t.withIdentity(leeIdentity).query(api.chat.channels, { workspaceId })
    expect(visibleChannels.map((channel) => channel.name)).not.toContain("strategy")
    await expect(
      t.withIdentity(leeIdentity).query(api.chat.conversationIndicators, { workspaceId })
    ).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ channelId: privateChannelId })]))
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: privateChannelId })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(privateChannelId))
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).query(api.chat.channelMembers, { channelId: privateChannelId })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).query(api.chat.searchChannelMessages, {
        channelId: privateChannelId,
        query: "strategy"
      })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.sendMessage, {
        channelId: privateChannelId,
        body: "Intrusion"
      })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.editMessage, {
        channelId: privateChannelId,
        messageId: secret.id,
        body: "Tampered"
      })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.deleteMessage, {
        channelId: privateChannelId,
        messageId: secret.id
      })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.toggleMessageReaction, {
        channelId: privateChannelId,
        messageId: secret.id,
        emoji: "👍"
      })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.markChannelRead, {
        channelId: privateChannelId,
        readThroughMessageId: secret.id
      })
    ).rejects.toThrow("Current user is not a member of this channel")

    await expect(
      t.withIdentity(mayaIdentity).query(api.chat.channelMessages, messagePageArgs(privateChannelId))
    ).resolves.toMatchObject({
      page: [
        expect.objectContaining({
          id: secret.id,
          body: "Private strategy",
          reactions: [],
          attachments: [expect.objectContaining({ url: expect.any(String) })]
        })
      ]
    })
  })

  it("creates private channels atomically with an admin creator and eligible initial members", async () => {
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
    vi.stubEnv("AETHER_ALLOWED_EMAILS", "maya@example.com,lee@example.com,diego@example.com")
    for (const identity of [mayaIdentity, leeIdentity, diegoIdentity]) {
      await t.mutation(internal.chat.ensureViewerForIdentity, {
        tokenIdentifier: identity.tokenIdentifier,
        email: identity.email,
        displayName: identity.name
      })
    }

    const { mayaId, leeId, workspaceId } = await t.run(async (ctx) => {
      const maya = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", mayaIdentity.email))
        .unique()
      const lee = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", leeIdentity.email))
        .unique()
      if (maya === null || lee === null) throw new Error("Seeded users not found")
      const workspace = await ctx.db
        .query("workspaces")
        .withIndex("by_key", (q) => q.eq("key", "aether-dogfood"))
        .unique()
      if (workspace === null) throw new Error("Workspace not found")
      return { mayaId: maya._id, leeId: lee._id, workspaceId: workspace._id }
    })
    await expect(t.withIdentity(mayaIdentity).query(api.chat.eligiblePrivateChannelMembers, {})).resolves.toEqual([
      expect.objectContaining({ displayName: "Diego Rivera" }),
      expect.objectContaining({ id: leeId, displayName: "Lee Chen" })
    ])
    const leadership = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, {
      name: "leadership-team",
      visibility: "private",
      initialMemberIds: [leeId, leeId, mayaId]
    })

    await expect(
      t.withIdentity(mayaIdentity).query(api.chat.channelMembers, { channelId: leadership.id })
    ).resolves.toEqual([
      expect.objectContaining({ id: leeId, role: "member" }),
      expect.objectContaining({ id: mayaId, role: "admin" })
    ])
    await expect(
      t.withIdentity(mayaIdentity).query(api.chat.eligiblePrivateChannelMembers, {
        channelId: leadership.id
      })
    ).resolves.toEqual([expect.objectContaining({ displayName: "Diego Rivera" })])
    await expect(t.withIdentity(leeIdentity).query(api.chat.channels, { workspaceId })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: leadership.id })])
    )
    await expect(
      t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(leadership.id))
    ).resolves.toMatchObject({ page: [] })
    await expect(t.withIdentity(diegoIdentity).query(api.chat.channels, { workspaceId })).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: leadership.id })])
    )
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.removePrivateChannelMember, {
        channelId: leadership.id,
        userId: mayaId
      })
    ).rejects.toThrow("The last channel admin cannot be removed")

    const invalidUserId = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "outside@example.com",
        displayName: "Outside User",
        username: "outside",
        directMessagePreference: "all",
        createdAt: 1,
        updatedAt: 1
      })
    )
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, {
        name: "invalid-initial-members",
        visibility: "private",
        initialMemberIds: [invalidUserId]
      })
    ).rejects.toThrow("Current user is not a member of this workspace")
    const invalidChannel = await t.run(async (ctx) => {
      const workspace = await ctx.db
        .query("workspaces")
        .withIndex("by_key", (q) => q.eq("key", "aether-dogfood"))
        .unique()
      if (workspace === null) throw new Error("Workspace not found")
      return ctx.db
        .query("channels")
        .withIndex("by_workspace_key", (q) => q.eq("workspaceId", workspace._id).eq("key", "invalid-initial-members"))
        .unique()
    })
    expect(invalidChannel).toBeNull()
  })

  it("lets only private-channel admins idempotently add and remove eligible members, revoking channel access", async () => {
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
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
      const workspace = await ctx.db
        .query("workspaces")
        .withIndex("by_key", (q) => q.eq("key", "aether-dogfood"))
        .unique()
      const maya = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", mayaIdentity.email))
        .unique()
      const lee = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", leeIdentity.email))
        .unique()
      const diego = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", diegoIdentity.email))
        .unique()
      if (workspace === null || maya === null || lee === null || diego === null)
        throw new Error("Seed records not found")
      const blockedId = await ctx.db.insert("users", {
        email: "blocked@example.com",
        displayName: "Blocked User",
        username: "blocked",
        directMessagePreference: "all",
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

    await expect(
      t.withIdentity(diegoIdentity).query(api.chat.eligiblePrivateChannelMembers, {
        channelId: strategy.id
      })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(mayaIdentity).query(api.chat.eligiblePrivateChannelMembers, {
        channelId: strategy.id
      })
    ).resolves.toEqual([
      { id: diegoId, displayName: "Diego Rivera" },
      { id: leeId, displayName: "Lee Chen" }
    ])

    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.addPrivateChannelMember, {
        channelId: strategy.id,
        userId: blockedId
      })
    ).rejects.toThrow("Invited user is not on the Aether dogfood allowlist")
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.addPrivateChannelMember, {
        channelId: strategy.id,
        userId: leeId
      })
    ).resolves.toEqual({ channelId: strategy.id, userId: leeId, member: true })
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.addPrivateChannelMember, {
        channelId: strategy.id,
        userId: leeId
      })
    ).resolves.toEqual({ channelId: strategy.id, userId: leeId, member: true })
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.addPrivateChannelMember, {
        channelId: strategy.id,
        userId: diegoId
      })
    ).rejects.toThrow("Only channel admins can administer private channel membership")
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.removePrivateChannelMember, {
        channelId: strategy.id,
        userId: mayaId
      })
    ).rejects.toThrow("Only channel admins can administer private channel membership")

    const addedMembership = await t.run((ctx) =>
      ctx.db
        .query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", strategy.id).eq("userId", leeId))
        .unique()
    )
    expect(addedMembership).toMatchObject({
      role: "member",
      lastReadAt: addedMembership?.createdAt
    })
    await expect(t.withIdentity(leeIdentity).query(api.chat.channels, { workspaceId })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: strategy.id })])
    )
    await expect(
      t.withIdentity(leeIdentity).query(api.chat.conversationIndicators, { workspaceId })
    ).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ channelId: strategy.id })]))

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["secret"], { type: "text/plain" })))
    await t.run((ctx) =>
      ctx.db.insert("attachmentUploads", {
        storageId,
        uploaderUserId: mayaId,
        contentType: "text/plain",
        createdAt: Date.now()
      })
    )
    const secret = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: strategy.id,
      body: "Private roadmap",
      attachments: [{ storageId, name: "roadmap.txt" }]
    })
    await expect(
      t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(strategy.id))
    ).resolves.toMatchObject({
      page: [
        expect.objectContaining({
          id: secret.id,
          attachments: [expect.objectContaining({ url: expect.any(String) })]
        })
      ]
    })
    await t.run(async (ctx) => {
      if (addedMembership === null) throw new Error("Added membership not found")
      const mentionedMessageId = await ctx.db.insert("messages", {
        workspaceId,
        channelId: strategy.id,
        authorUserId: mayaId,
        authorDisplayName: mayaIdentity.name,
        body: "@Lee post-invite update",
        createdAt: addedMembership.createdAt + 1
      })
      await ctx.db.insert("messageMentions", {
        messageId: mentionedMessageId,
        channelId: strategy.id,
        userId: leeId,
        messageCreatedAt: addedMembership.createdAt + 1
      })
    })
    await expect(t.withIdentity(leeIdentity).query(api.chat.conversationIndicators, { workspaceId })).resolves.toEqual(
      expect.arrayContaining([{ channelId: strategy.id, indicator: "mentioned" }])
    )

    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.removePrivateChannelMember, {
        channelId: strategy.id,
        userId: leeId
      })
    ).resolves.toEqual({ channelId: strategy.id, userId: leeId, member: false })
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.removePrivateChannelMember, {
        channelId: strategy.id,
        userId: leeId
      })
    ).resolves.toEqual({ channelId: strategy.id, userId: leeId, member: false })

    await expect(t.withIdentity(leeIdentity).query(api.chat.channels, { workspaceId })).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: strategy.id })])
    )
    await expect(
      t.withIdentity(leeIdentity).query(api.chat.channelMessages, messagePageArgs(strategy.id))
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).query(api.chat.searchChannelMessages, {
        channelId: strategy.id,
        query: "roadmap"
      })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.markChannelRead, {
        channelId: strategy.id,
        readThroughMessageId: secret.id
      })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).query(api.chat.channelMembers, { channelId: strategy.id })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.sendMessage, {
        channelId: strategy.id,
        body: "Post-removal write"
      })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.editMessage, {
        channelId: strategy.id,
        messageId: secret.id,
        body: "Post-removal edit"
      })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.deleteMessage, {
        channelId: strategy.id,
        messageId: secret.id
      })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.toggleMessageReaction, {
        channelId: strategy.id,
        messageId: secret.id,
        emoji: "👍"
      })
    ).rejects.toThrow("Current user is not a member of this channel")

    await expect(
      t.withIdentity(mayaIdentity).query(api.chat.channelMessages, messagePageArgs(strategy.id))
    ).resolves.toMatchObject({
      page: expect.arrayContaining([
        expect.objectContaining({
          id: secret.id,
          body: "Private roadmap",
          reactions: [],
          attachments: [expect.objectContaining({ url: expect.any(String) })]
        })
      ])
    })
    await expect(t.run((ctx) => ctx.db.system.get("_storage", storageId))).resolves.not.toBeNull()
  })

  it("lists every workspace member for public channels and only channel members for private channels", async () => {
    const t = createChatScenario()
    await ensureViewers(t, mayaIdentity, leeIdentity)

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

    await expect(
      t.withIdentity(mayaIdentity).query(api.chat.channelMembers, { channelId: design.id })
    ).resolves.toEqual([
      expect.objectContaining({ displayName: "Lee Chen" }),
      expect.objectContaining({ displayName: "Maya Patel" })
    ])

    await expect(
      t.withIdentity(mayaIdentity).query(api.chat.channelMembers, { channelId: leadership.id })
    ).resolves.toEqual([expect.objectContaining({ displayName: "Maya Patel" })])
  })

  it("enforces the maximum channel count instead of hiding excess channels", async () => {
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
    await ensureViewer(t, mayaIdentity)
    await t.run(async (ctx) => {
      const workspace = await ctx.db
        .query("workspaces")
        .withIndex("by_key", (q) => q.eq("key", "aether-dogfood"))
        .unique()
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

    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "one-too-many" })
    ).rejects.toThrow("Workspaces can contain at most 100 channels")

    await t.run(async (ctx) => {
      const workspace = await ctx.db
        .query("workspaces")
        .withIndex("by_key", (q) => q.eq("key", "aether-dogfood"))
        .unique()
      if (workspace === null) throw new Error("Workspace not found")
      const deleted = await ctx.db
        .query("channels")
        .withIndex("by_workspace_key", (q) => q.eq("workspaceId", workspace._id).eq("key", "channel-1"))
        .unique()
      if (deleted === null) throw new Error("Channel to delete not found")
      await ctx.db.patch(deleted._id, { deletedAt: Date.now(), key: `deleted-${deleted._id}` })
    })
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "replacement" })
    ).resolves.toMatchObject({ name: "replacement" })
  })
})
