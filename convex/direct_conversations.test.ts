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

beforeEach(() => vi.stubEnv("AETHER_ALLOWED_EMAILS", "maya@example.com,lee@example.com,diego@example.com"))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

const initialize = (t: ReturnType<typeof convexTest>, identity: typeof maya) =>
  t.mutation(internal.chat.ensureViewerForIdentity, {
    tokenIdentifier: identity.tokenIdentifier,
    email: identity.email,
    displayName: identity.name
  })

describe("global direct conversations", () => {
  it("uses a global pair identity and remains usable after shared-workspace membership is removed", async () => {
    const t = convexTest(schema, modules)
    const mayaUser = await initialize(t, maya)
    const leeUser = await initialize(t, lee)
    const [first, repeat] = await Promise.all([
      t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, { recipientUserId: leeUser.userId }),
      t.withIdentity(lee).mutation(api.direct_conversations.startOrReopen, { recipientUserId: mayaUser.userId })
    ])
    expect(first.id).toBe(repeat.id)
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("workspaceMemberships")
        .withIndex("by_workspace_user", (q) => q.eq("workspaceId", mayaUser.workspaceId).eq("userId", leeUser.userId))
        .unique()
      if (membership === null) throw new Error("Expected Lee workspace membership")
      await ctx.db.delete(membership._id)
    })
    await expect(
      t.withIdentity(lee).mutation(api.chat.sendMessage, { channelId: first.id, body: "Still here" })
    ).resolves.toMatchObject({ body: "Still here" })
    await expect(t.withIdentity(maya).query(api.direct_conversations.list, {})).resolves.toEqual([
      expect.objectContaining({ id: first.id, otherUser: expect.objectContaining({ username: "lee" }) })
    ])
  })

  it("enforces the recipient's preference only when starting a new DM", async () => {
    const t = convexTest(schema, modules)
    const mayaUser = await initialize(t, maya)
    const leeUser = await initialize(t, lee)
    const diegoUser = await initialize(t, diego)
    await t.withIdentity(lee).mutation(api.social.updateProfile, { directMessagePreference: "friends" })
    await expect(
      t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, { recipientUserId: leeUser.userId })
    ).rejects.toThrow("not accepting new direct messages")
    const request = await t
      .withIdentity(maya)
      .mutation(api.social.sendFriendRequest, { recipientUserId: leeUser.userId })
    await t.withIdentity(lee).mutation(api.social.respondToFriendRequest, { friendRequestId: request.id, accept: true })
    await expect(
      t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, { recipientUserId: leeUser.userId })
    ).resolves.toMatchObject({ otherUser: expect.objectContaining({ id: leeUser.userId }) })
    await expect(
      t.withIdentity(diego).mutation(api.direct_conversations.startOrReopen, { recipientUserId: leeUser.userId })
    ).rejects.toThrow("not accepting new direct messages")
    expect(diegoUser.userId).toBeTruthy()
    expect(mayaUser.userId).toBeTruthy()
  })

  it("searches global accounts by username even when a DM is not permitted", async () => {
    const t = convexTest(schema, modules)
    await initialize(t, maya)
    await initialize(t, lee)
    await t.withIdentity(lee).mutation(api.social.updateProfile, { directMessagePreference: "friends" })
    await expect(t.withIdentity(maya).query(api.social.searchUsers, { query: "@lee" })).resolves.toEqual([
      expect.objectContaining({ username: "lee", canStartDirectMessage: false })
    ])
  })

  it("accepts a reciprocal pending friend request instead of silently keeping it pending", async () => {
    const t = convexTest(schema, modules)
    const mayaUser = await initialize(t, maya)
    const leeUser = await initialize(t, lee)
    await t.withIdentity(lee).mutation(api.social.updateProfile, { directMessagePreference: "friends" })
    const incoming = await t
      .withIdentity(lee)
      .mutation(api.social.sendFriendRequest, { recipientUserId: mayaUser.userId })

    await expect(t.withIdentity(maya).query(api.social.searchUsers, { query: "lee" })).resolves.toEqual([
      expect.objectContaining({ friendship: "pending", friendRequestDirection: "incoming" })
    ])
    await expect(
      t.withIdentity(maya).mutation(api.social.sendFriendRequest, { recipientUserId: leeUser.userId })
    ).resolves.toEqual({ id: incoming.id, status: "accepted" })
    await expect(t.withIdentity(maya).query(api.social.searchUsers, { query: "lee" })).resolves.toEqual([
      expect.objectContaining({ friendship: "accepted", friendRequestDirection: null, canStartDirectMessage: true })
    ])
  })

  it("combines workspace mentions with global DM unread state without treating DM mentions specially", async () => {
    const t = convexTest(schema, modules)
    const mayaUser = await initialize(t, maya)
    const leeUser = await initialize(t, lee)
    const dm = await t
      .withIdentity(maya)
      .mutation(api.direct_conversations.startOrReopen, { recipientUserId: leeUser.userId })
    await t.run(async (ctx) => {
      const dmMembership = await ctx.db
        .query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", dm.id).eq("userId", leeUser.userId))
        .unique()
      const workspaceMembership = await ctx.db
        .query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", leeUser.channelId).eq("userId", leeUser.userId))
        .unique()
      if (dmMembership === null || workspaceMembership === null) throw new Error("Expected Lee memberships")
      await Promise.all([
        ctx.db.patch(dmMembership._id, { lastReadAt: 1 }),
        ctx.db.patch(workspaceMembership._id, { lastReadAt: 1 })
      ])
    })
    await t.withIdentity(maya).mutation(api.chat.sendMessage, {
      channelId: mayaUser.channelId,
      body: "@lee Workspace mention"
    })
    await t.withIdentity(maya).mutation(api.chat.sendMessage, { channelId: dm.id, body: "@lee Global unread" })

    const indicators = await t.withIdentity(lee).query(api.chat.conversationIndicators, {
      workspaceId: leeUser.workspaceId
    })
    expect(indicators).toHaveLength(2)
    expect(indicators).toEqual(
      expect.arrayContaining([
        { channelId: leeUser.channelId, indicator: "mentioned" },
        { channelId: dm.id, indicator: "unread" }
      ])
    )
  })
})
