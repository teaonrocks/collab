/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

const maya = {
  tokenIdentifier: "https://issuer.example|notifications-maya",
  email: "maya@example.com",
  name: "Maya Patel"
}

const lee = {
  tokenIdentifier: "https://issuer.example|notifications-lee",
  email: "lee@example.com",
  name: "Lee Chen"
}

const initialize = async (t: ReturnType<typeof convexTest>, identity: typeof maya) =>
  t.mutation(internal.chat.ensureViewerForIdentity, {
    tokenIdentifier: identity.tokenIdentifier,
    email: identity.email,
    displayName: identity.name
  })

beforeEach(() => {
  vi.stubEnv("AETHER_ALLOWED_EMAILS", "maya@example.com,lee@example.com")
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("conversation notification preferences", () => {
  it("defaults channels to mentions, persists all and off, and only emits eligible new messages", async () => {
    const t = convexTest(schema, modules)
    const mayaViewer = await initialize(t, maya)
    await initialize(t, lee)
    const channelId = mayaViewer.channelId
    const { cursor } = await t.withIdentity(lee).mutation(api.notification_preferences.openFeed, {})

    await expect(t.withIdentity(lee).query(api.notification_preferences.preference, { channelId })).resolves.toEqual({
      mode: "mentions",
      options: ["all", "mentions", "off"]
    })

    await t.withIdentity(maya).mutation(api.chat.sendMessage, {
      channelId,
      body: "A regular channel update"
    })
    await expect(t.withIdentity(lee).query(api.notification_preferences.feed, { cursor })).resolves.toEqual({
      cursor,
      notifications: []
    })

    await t.withIdentity(maya).mutation(api.chat.sendMessage, {
      channelId,
      body: "@Lee please review this"
    })
    await expect(t.withIdentity(lee).query(api.notification_preferences.feed, { cursor })).resolves.toEqual({
      cursor: cursor + 1,
      notifications: [
        expect.objectContaining({
          conversationKind: "channel",
          channelId,
          title: "#general",
          body: "Maya Patel: @Lee please review this"
        })
      ]
    })

    await expect(
      t.withIdentity(lee).mutation(api.notification_preferences.updatePreference, {
        channelId,
        mode: "all"
      })
    ).resolves.toEqual({ mode: "all", options: ["all", "mentions", "off"] })
    await t.withIdentity(maya).mutation(api.chat.sendMessage, {
      channelId,
      body: "All-message preference update"
    })
    await expect(t.withIdentity(lee).query(api.notification_preferences.feed, { cursor })).resolves.toMatchObject({
      cursor: cursor + 2,
      notifications: [{}, {}]
    })

    await t.withIdentity(lee).mutation(api.notification_preferences.updatePreference, {
      channelId,
      mode: "off"
    })
    await t.withIdentity(maya).mutation(api.chat.sendMessage, {
      channelId,
      body: "Muted update"
    })
    await expect(t.withIdentity(lee).query(api.notification_preferences.feed, { cursor })).resolves.toMatchObject({
      cursor: cursor + 2,
      notifications: [{}, {}]
    })

    await expect(t.withIdentity(maya).query(api.notification_preferences.feed, { cursor: 0 })).resolves.toEqual({
      cursor: 0,
      notifications: []
    })
  })

  it("defaults direct messages to all, rejects mention-only mode, and ignores backfilled rows", async () => {
    const t = convexTest(schema, modules)
    await initialize(t, maya)
    const leeViewer = await initialize(t, lee)
    const direct = await t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      recipientUserId: leeViewer.userId
    })

    await expect(
      t.withIdentity(lee).query(api.notification_preferences.preference, { channelId: direct.id })
    ).resolves.toEqual({ mode: "all", options: ["all", "off"] })
    await expect(
      t.withIdentity(lee).mutation(api.notification_preferences.updatePreference, {
        channelId: direct.id,
        mode: "mentions"
      })
    ).rejects.toThrow("Direct conversations do not support mention-only notifications")

    await t.run(async (ctx) => {
      const mayaUser = await ctx.db
        .query("users")
        .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", maya.tokenIdentifier))
        .unique()
      if (mayaUser === null) throw new Error("Maya missing")
      await ctx.db.insert("messages", {
        channelId: direct.id,
        authorUserId: mayaUser._id,
        authorDisplayName: maya.name,
        body: "Historical import",
        reactionBatchReady: true,
        createdAt: 1
      })
    })
    await expect(t.withIdentity(lee).query(api.notification_preferences.feed, { cursor: 0 })).resolves.toEqual({
      cursor: 0,
      notifications: []
    })

    await t.withIdentity(maya).mutation(api.chat.sendMessage, {
      channelId: direct.id,
      body: "A new direct message"
    })
    await expect(t.withIdentity(lee).query(api.notification_preferences.feed, { cursor: 0 })).resolves.toEqual({
      cursor: 1,
      notifications: [
        expect.objectContaining({
          conversationKind: "direct",
          channelId: direct.id,
          title: "Maya Patel",
          body: "A new direct message"
        })
      ]
    })
  })

  it("opens at a server-issued cursor and replays equal-timestamp events until that cursor advances", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2032-05-01T00:00:00.000Z"))
    const t = convexTest(schema, modules)
    await initialize(t, maya)
    const leeViewer = await initialize(t, lee)
    const direct = await t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      recipientUserId: leeViewer.userId
    })

    await t.withIdentity(maya).mutation(api.chat.sendMessage, {
      channelId: direct.id,
      body: "Existing before this renderer session"
    })
    const opened = await t.withIdentity(lee).mutation(api.notification_preferences.openFeed, {})
    expect(opened).toEqual({ cursor: 1 })

    await t.withIdentity(maya).mutation(api.chat.sendMessage, {
      channelId: direct.id,
      body: "First at the shared timestamp"
    })
    await t.withIdentity(maya).mutation(api.chat.sendMessage, {
      channelId: direct.id,
      body: "Second at the shared timestamp"
    })

    const firstRead = await t.withIdentity(lee).query(api.notification_preferences.feed, opened)
    expect(firstRead.cursor).toBe(3)
    expect(firstRead.notifications.map((notification) => notification.body)).toEqual([
      "First at the shared timestamp",
      "Second at the shared timestamp"
    ])
    expect(new Set(firstRead.notifications.map((notification) => notification.createdAt)).size).toBe(1)

    await expect(t.withIdentity(lee).query(api.notification_preferences.feed, opened)).resolves.toEqual(firstRead)
    await expect(
      t.withIdentity(lee).query(api.notification_preferences.feed, { cursor: firstRead.cursor })
    ).resolves.toEqual({ cursor: 3, notifications: [] })
  })

  it("pages forward without rehydrating acknowledged events", async () => {
    const t = convexTest(schema, modules)
    await initialize(t, maya)
    const leeViewer = await initialize(t, lee)
    const direct = await t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      recipientUserId: leeViewer.userId
    })
    const opened = await t.withIdentity(lee).mutation(api.notification_preferences.openFeed, {})

    for (let index = 1; index <= 101; index += 1) {
      await t.withIdentity(maya).mutation(api.chat.sendMessage, {
        channelId: direct.id,
        body: `Queued notification ${index}`
      })
    }

    const firstPage = await t.withIdentity(lee).query(api.notification_preferences.feed, opened)
    expect(firstPage.cursor).toBe(100)
    expect(firstPage.notifications).toHaveLength(100)

    const replay = await t.withIdentity(lee).query(api.notification_preferences.feed, opened)
    expect(replay.notifications.map((notification) => notification.id)).toEqual(
      firstPage.notifications.map((notification) => notification.id)
    )

    const secondPage = await t.withIdentity(lee).query(api.notification_preferences.feed, {
      cursor: firstPage.cursor
    })
    expect(secondPage.cursor).toBe(101)
    expect(secondPage.notifications.map((notification) => notification.body)).toEqual(["Queued notification 101"])
    await expect(
      t.withIdentity(lee).query(api.notification_preferences.feed, { cursor: secondPage.cursor })
    ).resolves.toEqual({ cursor: 101, notifications: [] })
  })

  it("expires transient notification rows after the bounded retention window", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2032-05-01T00:00:00.000Z"))
    const t = convexTest(schema, modules)
    await initialize(t, maya)
    const leeViewer = await initialize(t, lee)
    const direct = await t.withIdentity(maya).mutation(api.direct_conversations.startOrReopen, {
      recipientUserId: leeViewer.userId
    })

    await t.withIdentity(maya).mutation(api.chat.sendMessage, {
      channelId: direct.id,
      body: "Transient notification"
    })
    await expect(t.run(async (ctx) => ctx.db.query("messageNotificationEvents").take(10))).resolves.toHaveLength(1)

    await t.finishAllScheduledFunctions(vi.runAllTimers)

    await expect(t.run(async (ctx) => ctx.db.query("messageNotificationEvents").take(10))).resolves.toEqual([])
  })
})
