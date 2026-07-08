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
})
