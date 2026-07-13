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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

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
      const membership = await ctx.db.query("workspaceMemberships")
        .withIndex("by_workspace_user", (q) => q.eq("workspaceId", mayaUser.workspaceId).eq("userId", leeUser.userId)).unique()
      if (membership === null) throw new Error("Expected Lee workspace membership")
      await ctx.db.delete(membership._id)
    })
    await expect(t.withIdentity(lee).mutation(api.chat.sendMessage, { channelId: first.id, body: "Still here" }))
      .resolves.toMatchObject({ body: "Still here" })
    await expect(t.withIdentity(maya).query(api.direct_conversations.list, {}))
      .resolves.toEqual([expect.objectContaining({ id: first.id, otherUser: expect.objectContaining({ username: "lee" }) })])
  })

  it("enforces the recipient's preference only when starting a new DM", async () => {
    const t = convexTest(schema, modules)
    const mayaUser = await initialize(t, maya)
    const leeUser = await initialize(t, lee)
    const diegoUser = await initialize(t, diego)
    await t.withIdentity(lee).mutation(api.social.updateProfile, { directMessagePreference: "friends" })
    await expect(t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, { recipientUserId: leeUser.userId }))
      .rejects.toThrow("not accepting new direct messages")
    const request = await t.withIdentity(maya).mutation(api.social.sendFriendRequest, { recipientUserId: leeUser.userId })
    await t.withIdentity(lee).mutation(api.social.respondToFriendRequest, { friendRequestId: request.id, accept: true })
    await expect(t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, { recipientUserId: leeUser.userId }))
      .resolves.toMatchObject({ otherUser: expect.objectContaining({ id: leeUser.userId }) })
    await expect(t.withIdentity(diego).mutation(api.direct_conversations.startOrReopen, { recipientUserId: leeUser.userId }))
      .rejects.toThrow("not accepting new direct messages")
    expect(diegoUser.userId).toBeTruthy()
    expect(mayaUser.userId).toBeTruthy()
  })

  it("searches global accounts by username even when a DM is not permitted", async () => {
    const t = convexTest(schema, modules)
    await initialize(t, maya)
    await initialize(t, lee)
    await t.withIdentity(lee).mutation(api.social.updateProfile, { directMessagePreference: "friends" })
    await expect(t.withIdentity(maya).query(api.social.searchUsers, { query: "@lee" }))
      .resolves.toEqual([expect.objectContaining({ username: "lee", canStartDirectMessage: false })])
  })

  it("reports unread state for a global DM independently of a workspace", async () => {
    const t = convexTest(schema, modules)
    await initialize(t, maya)
    const leeUser = await initialize(t, lee)
    const dm = await t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, { recipientUserId: leeUser.userId })
    await t.run(async (ctx) => {
      const membership = await ctx.db.query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", dm.id).eq("userId", leeUser.userId)).unique()
      if (membership === null) throw new Error("Expected DM membership")
      await ctx.db.patch(membership._id, { lastReadAt: 1 })
    })
    await t.withIdentity(maya).mutation(api.chat.sendMessage, { channelId: dm.id, body: "Global unread" })
    await expect(t.withIdentity(lee).query(api.direct_conversations.indicators, {}))
      .resolves.toEqual([{ channelId: dm.id, indicator: "unread" }])
  })

  it("globalizes a legacy workspace DM without choosing between duplicate pairs", async () => {
    const t = convexTest(schema, modules)
    const mayaUser = await initialize(t, maya)
    const leeUser = await initialize(t, lee)
    const now = Date.now()
    const pairKey = [mayaUser.userId, leeUser.userId].sort().join(":")
    const channelId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("channels", {
        workspaceId: mayaUser.workspaceId,
        key: `direct-${pairKey}`,
        name: "Direct conversation",
        visibility: "private",
        kind: "direct",
        directPairKey: pairKey,
        createdAt: now
      })
      for (const userId of [mayaUser.userId, leeUser.userId]) {
        await ctx.db.insert("channelMemberships", { channelId: id, workspaceId: mayaUser.workspaceId, channelKind: "direct", userId, role: "member", createdAt: now })
      }
      return id
    })
    await expect(t.mutation(internal.migrations.globalizeLegacyDirectConversations, { workspaceId: mayaUser.workspaceId, dryRun: false }))
      .resolves.toMatchObject({ changes: [{ channelId, action: "globalized" }] })
    await expect(t.run((ctx) => ctx.db.get(channelId))).resolves.toSatisfy((channel) => channel?.workspaceId === undefined)
  })
})
