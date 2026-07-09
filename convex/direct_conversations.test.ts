/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")
const maya = { tokenIdentifier: "issuer|maya-dm", email: "maya@example.com", name: "Maya Patel" }
const lee = { tokenIdentifier: "issuer|lee-dm", email: "lee@example.com", name: "Lee Chen" }
const diego = { tokenIdentifier: "issuer|diego-dm", email: "diego@example.com", name: "Diego Rivera" }
const guest = { tokenIdentifier: "issuer|guest-dm", email: "guest@example.com", name: "Guest User" }

beforeEach(() => vi.stubEnv("AETHER_ALLOWED_EMAILS", "maya@example.com,lee@example.com"))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

const initialize = async (t: ReturnType<typeof convexTest>, identity: typeof maya) =>
  t.mutation(internal.chat.ensureViewerForIdentity, {
    tokenIdentifier: identity.tokenIdentifier,
    email: identity.email,
    displayName: identity.name
  })

describe("direct conversation contract", () => {
  it("lists eligible recipients and creates one canonical pair with exactly two participants", async () => {
    const t = convexTest(schema, modules)
    const mayaUser = await initialize(t, maya)
    const leeUser = await initialize(t, lee)
    const workspaceId = mayaUser.workspaceId

    await expect(t.withIdentity(maya).query(api.direct_conversations.candidates, {
      workspaceId
    })).resolves.toEqual([{ id: leeUser.userId, displayName: lee.name }])

    const [first, reverse] = await Promise.all([
      t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
        workspaceId,
        recipientUserId: leeUser.userId
      }),
      t.withIdentity(lee).mutation(api.direct_conversations.startOrReopen, {
        workspaceId,
        recipientUserId: mayaUser.userId
      })
    ])
    const repeated = await t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      workspaceId,
      recipientUserId: leeUser.userId
    })
    expect(reverse.id).toBe(first.id)
    expect(repeated.id).toBe(first.id)

    const records = await t.run(async (ctx) => ({
      directChannels: await ctx.db.query("channels")
        .withIndex("by_workspace_and_direct_pair_key", (q) => q.eq("workspaceId", workspaceId))
        .collect().then((channels) => channels.filter((channel) => channel.kind === "direct")),
      participants: await ctx.db.query("channelMemberships")
        .withIndex("by_channel", (q) => q.eq("channelId", first.id)).collect()
    }))
    expect(records.directChannels).toHaveLength(1)
    expect(records.participants.map((membership) => membership.userId).sort())
      .toEqual([mayaUser.userId, leeUser.userId].sort())

    await expect(t.withIdentity(maya).query(api.direct_conversations.list, {
      workspaceId
    })).resolves.toEqual([expect.objectContaining({ id: first.id, otherUser: { id: leeUser.userId, displayName: lee.name } })])
    await expect(t.withIdentity(maya).query(api.chat.channels, { workspaceId }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: first.id })]))
  })

  it("rejects self, non-member, non-allowlisted, deleted, and other-workspace recipients", async () => {
    const t = convexTest(schema, modules)
    const mayaUser = await initialize(t, maya)
    const leeUser = await initialize(t, lee)
    const workspaceId = mayaUser.workspaceId
    await expect(t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      workspaceId, recipientUserId: mayaUser.userId
    })).rejects.toThrow("Cannot start a direct conversation with yourself")

    const outsiders = await t.run(async (ctx) => {
      const now = Date.now()
      const otherWorkspaceId = await ctx.db.insert("workspaces", { key: "other", name: "Other", createdAt: now })
      const nonMemberId = await ctx.db.insert("users", { email: "nobody@example.com", displayName: "Nobody", createdAt: now, updatedAt: now })
      const nonAllowedId = await ctx.db.insert("users", { email: diego.email, displayName: diego.name, createdAt: now, updatedAt: now })
      await ctx.db.insert("workspaceMemberships", { workspaceId, userId: nonAllowedId, role: "member", createdAt: now })
      const deletedId = await ctx.db.insert("users", { email: "deleted@example.com", displayName: "Deleted", createdAt: now, updatedAt: now, deletedAt: now })
      await ctx.db.insert("workspaceMemberships", { workspaceId, userId: deletedId, role: "member", createdAt: now })
      await ctx.db.insert("workspaceMemberships", { workspaceId: otherWorkspaceId, userId: leeUser.userId, role: "member", createdAt: now })
      return { otherWorkspaceId, nonMemberId, nonAllowedId, deletedId }
    })
    for (const recipientUserId of [outsiders.nonMemberId, outsiders.nonAllowedId, outsiders.deletedId]) {
      await expect(t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
        workspaceId, recipientUserId
      })).rejects.toThrow("Direct conversation recipient is not eligible")
    }
    await expect(t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      workspaceId: outsiders.otherWorkspaceId, recipientUserId: leeUser.userId
    })).rejects.toThrow("Current user is not a member of this workspace")
  })

  it("hides and rejects guest recipients even when they are allowlisted workspace members", async () => {
    const t = convexTest(schema, modules)
    vi.stubEnv("AETHER_ALLOWED_EMAILS", "maya@example.com,lee@example.com,guest@example.com")
    const mayaUser = await initialize(t, maya)
    const workspaceId = mayaUser.workspaceId
    const guestUserId = await t.run(async (ctx) => {
      const now = Date.now()
      const userId = await ctx.db.insert("users", {
        email: guest.email,
        displayName: guest.name,
        createdAt: now,
        updatedAt: now
      })
      await ctx.db.insert("workspaceMemberships", { workspaceId, userId, role: "guest", createdAt: now })
      return userId
    })

    await expect(t.withIdentity(maya).query(api.direct_conversations.candidates, { workspaceId }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: guestUserId })]))
    await expect(t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      workspaceId,
      recipientUserId: guestUserId
    })).rejects.toThrow("Direct conversation recipient is not eligible")
  })

  it("stops listing and reopening a DM after the other participant loses eligibility", async () => {
    const t = convexTest(schema, modules)
    const mayaUser = await initialize(t, maya)
    const leeUser = await initialize(t, lee)
    const workspaceId = mayaUser.workspaceId
    const dm = await t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      workspaceId,
      recipientUserId: leeUser.userId
    })

    await t.mutation(internal.chat.administerDogfoodAllowlist, {
      operator: "test",
      email: lee.email,
      action: "remove"
    })
    await expect(t.withIdentity(maya).query(api.direct_conversations.list, { workspaceId }))
      .resolves.toEqual([])
    await expect(t.withIdentity(maya).query(api.direct_conversations.candidates, { workspaceId }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: leeUser.userId })]))
    await expect(t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      workspaceId,
      recipientUserId: leeUser.userId
    })).rejects.toThrow("Direct conversation recipient is not eligible")

    await t.mutation(internal.chat.administerDogfoodAllowlist, {
      operator: "test",
      email: lee.email,
      action: "add"
    })
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("workspaceMemberships")
        .withIndex("by_workspace_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", leeUser.userId))
        .unique()
      if (membership === null) throw new Error("Lee workspace membership not found")
      await ctx.db.delete(membership._id)
    })
    await expect(t.withIdentity(maya).query(api.direct_conversations.list, { workspaceId }))
      .resolves.toEqual([])
    await expect(t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      workspaceId,
      recipientUserId: leeUser.userId
    })).rejects.toThrow("Direct conversation recipient is not eligible")
    await expect(t.withIdentity(lee).query(api.chat.channelMessages, {
      channelId: dm.id,
      paginationOpts: { numItems: 20, cursor: null }
    })).rejects.toThrow("Current user is not a member of this workspace")
  })

  it("lists DMs after many ordinary channel memberships for the same user and workspace", async () => {
    const t = convexTest(schema, modules)
    const mayaUser = await initialize(t, maya)
    const leeUser = await initialize(t, lee)
    const workspaceId = mayaUser.workspaceId
    await t.run(async (ctx) => {
      const now = Date.now()
      for (let index = 0; index < 101; index += 1) {
        const channelId = await ctx.db.insert("channels", {
          workspaceId,
          key: `ordinary-${index}`,
          name: `ordinary-${index}`,
          visibility: "private",
          createdAt: now + index
        })
        await ctx.db.insert("channelMemberships", {
          channelId,
          workspaceId,
          userId: mayaUser.userId,
          role: "member",
          createdAt: now + index,
          lastReadAt: now + index,
          mentionTrackingStartedAt: now + index
        })
      }
    })
    const dm = await t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      workspaceId,
      recipientUserId: leeUser.userId
    })

    await expect(t.withIdentity(maya).query(api.direct_conversations.list, { workspaceId }))
      .resolves.toEqual([expect.objectContaining({ id: dm.id })])
  })

  it("uses message machinery while denying discovery, reads, joins, and management to non-participants", async () => {
    const t = convexTest(schema, modules)
    await initialize(t, maya)
    const leeUser = await initialize(t, lee)
    vi.stubEnv("AETHER_ALLOWED_EMAILS", "maya@example.com,lee@example.com,diego@example.com")
    await initialize(t, diego)
    const workspaceId = leeUser.workspaceId
    const dm = await t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      workspaceId, recipientUserId: leeUser.userId
    })
    const message = await t.withIdentity(maya).mutation(api.chat.sendMessage, { channelId: dm.id, body: "private hello" })
    await expect(t.withIdentity(lee).query(api.chat.channelMessages, {
      channelId: dm.id, paginationOpts: { numItems: 20, cursor: null }
    })).resolves.toMatchObject({ page: [expect.objectContaining({ id: message.id })] })

    await expect(t.withIdentity(diego).query(api.direct_conversations.list, { workspaceId }))
      .resolves.toEqual([])
    await expect(t.withIdentity(diego).query(api.chat.channelMembers, { channelId: dm.id }))
      .rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(diego).query(api.chat.channelMessages, {
      channelId: dm.id, paginationOpts: { numItems: 20, cursor: null }
    })).rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(diego).query(api.chat.searchChannelMessages, { channelId: dm.id, query: "private" }))
      .rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(diego).mutation(api.chat.sendMessage, { channelId: dm.id, body: "intrusion" }))
      .rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(diego).mutation(api.chat.editMessage, {
      channelId: dm.id, messageId: message.id, body: "intrusion"
    })).rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(diego).mutation(api.chat.deleteMessage, {
      channelId: dm.id, messageId: message.id
    })).rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(diego).mutation(api.chat.toggleMessageReaction, {
      channelId: dm.id, messageId: message.id, emoji: "👍"
    })).rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(diego).mutation(api.chat.markChannelRead, {
      channelId: dm.id, readThroughMessageId: message.id
    })).rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(diego).mutation(api.chat.ensureChannelMember, { channelId: dm.id }))
      .rejects.toThrow("Current user is not a member of this channel")
    await expect(t.withIdentity(maya).mutation(api.chat.editChannel, { channelId: dm.id, name: "oops" }))
      .rejects.toThrow("Direct conversations cannot be managed as channels")
    await expect(t.withIdentity(maya).mutation(api.chat.addPrivateChannelMember, {
      channelId: dm.id, userId: leeUser.userId
    })).rejects.toThrow("Private channel membership can only be administered for private channels")
  })

  it("matches channel message semantics while keeping DM indicators user-scoped and non-channel mentions plain", async () => {
    const t = convexTest(schema, modules)
    vi.stubEnv("AETHER_ALLOWED_EMAILS", "maya@example.com,lee@example.com,diego@example.com")
    const mayaUser = await initialize(t, maya)
    const leeUser = await initialize(t, lee)
    await initialize(t, diego)
    const workspaceId = mayaUser.workspaceId
    const dm = await t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      workspaceId,
      recipientUserId: leeUser.userId
    })

    await t.run(async (ctx) => {
      const leeMembership = await ctx.db
        .query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", dm.id).eq("userId", leeUser.userId))
        .unique()
      if (leeMembership === null) throw new Error("Lee DM membership not found")
      await ctx.db.patch(leeMembership._id, { lastReadAt: 1, mentionTrackingStartedAt: 1 })
    })

    const parent = await t.withIdentity(maya).mutation(api.chat.sendMessage, {
      channelId: dm.id,
      body: "@Lee this should remain an unread DM, not a channel mention."
    })
    await t.withIdentity(maya).mutation(api.chat.sendMessage, {
      channelId: dm.id,
      body: "Older direct-message context."
    })
    const reply = await t.withIdentity(lee).mutation(api.chat.sendMessage, {
      channelId: dm.id,
      body: "Replying inside the same DM.",
      parentMessageId: parent.id
    })
    await expect(t.withIdentity(maya).mutation(api.chat.editMessage, {
      channelId: dm.id,
      messageId: parent.id,
      body: "Edited private context"
    })).resolves.toMatchObject({ body: "Edited private context" })
    await t.withIdentity(lee).mutation(api.chat.toggleMessageReaction, {
      channelId: dm.id,
      messageId: parent.id,
      emoji: "👍"
    })

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["dm file"], { type: "text/plain" })))
    await t.run((ctx) => ctx.db.insert("attachmentUploads", {
      storageId,
      uploaderUserId: mayaUser.userId,
      contentType: "text/plain",
      createdAt: Date.now()
    }))
    const attachmentMessage = await t.withIdentity(maya).mutation(api.chat.sendMessage, {
      channelId: dm.id,
      body: "",
      attachments: [{ storageId, name: "direct-note.txt" }]
    })

    const firstPage = await t.withIdentity(lee).query(api.chat.channelMessages, {
      channelId: dm.id,
      paginationOpts: { numItems: 2, cursor: null }
    })
    expect(firstPage.page).toEqual([
      expect.objectContaining({
        id: attachmentMessage.id,
        attachments: [expect.objectContaining({ storageId, url: expect.any(String) })]
      }),
      expect.objectContaining({
        id: reply.id,
        parentMessage: expect.objectContaining({ id: parent.id })
      })
    ])
    expect(firstPage.isDone).toBe(false)

    await expect(t.withIdentity(lee).query(api.chat.searchChannelMessages, {
      channelId: dm.id,
      query: "private context"
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: parent.id, body: "Edited private context" })
    ]))
    await expect(t.withIdentity(lee).query(api.chat.channelMessages, {
      channelId: dm.id,
      paginationOpts: { numItems: 20, cursor: null }
    }).then((result) => result.page.find((message) => message.id === parent.id)?.reactions))
      .resolves.toEqual([{ emoji: "👍", count: 1, reactedByCurrentUser: true }])

    await expect(t.withIdentity(lee).query(api.chat.channelIndicators, { workspaceId }))
      .resolves.toEqual([{ channelId: dm.id, indicator: "unread" }])
    await expect(t.run((ctx) => ctx.db
      .query("messageMentions")
      .withIndex("by_message", (q) => q.eq("messageId", parent.id))
      .collect()))
      .resolves.toEqual([])

    await t.withIdentity(lee).mutation(api.chat.markChannelRead, {
      channelId: dm.id,
      readThroughMessageId: attachmentMessage.id
    })
    await expect(t.withIdentity(lee).query(api.chat.channelIndicators, { workspaceId }))
      .resolves.toEqual([])

    await t.withIdentity(maya).mutation(api.chat.deleteMessage, {
      channelId: dm.id,
      messageId: attachmentMessage.id
    })
    await expect(t.withIdentity(lee).query(api.chat.channelMessages, {
      channelId: dm.id,
      paginationOpts: { numItems: 20, cursor: null }
    }).then((result) => result.page.map((message) => message.id)))
      .resolves.not.toContain(attachmentMessage.id)

    await expect(t.withIdentity(diego).query(api.chat.channelIndicators, { workspaceId }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ channelId: dm.id })]))
    await expect(t.withIdentity(diego).query(api.chat.channels, { workspaceId }))
      .resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: dm.id })]))
    await expect(t.withIdentity(diego).query(api.direct_conversations.list, { workspaceId }))
      .resolves.toEqual([])
    await expect(t.withIdentity(diego).query(api.chat.channelMessages, {
      channelId: dm.id,
      paginationOpts: { numItems: 20, cursor: null }
    })).rejects.toThrow("Current user is not a member of this channel")
  })
})
