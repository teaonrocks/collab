/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest"
import {
  api,
  internal,
  Id,
  createChatScenario,
  ensureViewers,
  leeIdentity,
  mayaIdentity,
  silenceExpectedDogfoodDiagnostics
} from "../src/test/convex-chat"

describe("dogfood channel read and mention indicators", () => {
  it("tracks unread and mention state per channel and clears read channels", async () => {
    const t = createChatScenario()
    await ensureViewers(t, mayaIdentity, leeIdentity)

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    const product = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "product" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: product.id })

    const { workspaceId, designMessageId, productMessageId } = await t.run(async (ctx) => {
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

    expect(await t.withIdentity(leeIdentity).query(api.chat.conversationIndicators, { workspaceId })).toEqual([
      { channelId: design.id, indicator: "mentioned" }
    ])

    await t.withIdentity(leeIdentity).mutation(api.chat.markChannelRead, {
      channelId: design.id,
      readThroughMessageId: designMessageId
    })

    expect(await t.withIdentity(leeIdentity).query(api.chat.conversationIndicators, { workspaceId })).toEqual([])
  })

  it("marks a channel read only through the loaded message timestamp", async () => {
    const t = createChatScenario()
    await ensureViewers(t, mayaIdentity, leeIdentity)

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })

    const { workspaceId, loadedMessageId } = await t.run(async (ctx) => {
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

    await expect(t.withIdentity(leeIdentity).query(api.chat.conversationIndicators, { workspaceId })).resolves.toEqual([
      { channelId: design.id, indicator: "unread" }
    ])

    await t.run(async (ctx) => {
      const lee = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", leeIdentity.email))
        .unique()
      if (lee === null) throw new Error("Lee not found")
      const membership = await ctx.db
        .query("channelMemberships")
        .withIndex("by_channel_user", (q) => q.eq("channelId", design.id).eq("userId", lee._id))
        .unique()
      expect(membership?.lastReadAt).toBe(100)
    })
  })

  it("detects mentions after the first 50 unread messages", async () => {
    const t = createChatScenario()
    await ensureViewers(t, mayaIdentity, leeIdentity)

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })

    const workspaceId = await t.run(async (ctx) => {
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

    await expect(t.withIdentity(leeIdentity).query(api.chat.conversationIndicators, { workspaceId })).resolves.toEqual([
      { channelId: design.id, indicator: "mentioned" }
    ])
  })

  it("keeps near-match mention text as unread instead of mentioned", async () => {
    const t = createChatScenario()
    await ensureViewers(t, mayaIdentity, leeIdentity)

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })

    const workspaceId = await t.run(async (ctx) => {
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

    await expect(t.withIdentity(leeIdentity).query(api.chat.conversationIndicators, { workspaceId })).resolves.toEqual([
      { channelId: design.id, indicator: "unread" }
    ])
  })

  it("keeps legacy pre-index mentions bounded as unread", async () => {
    const t = createChatScenario()
    await ensureViewers(t, mayaIdentity, leeIdentity)
    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "legacy-mentions" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })

    const workspaceId = await t.run(async (ctx) => {
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
        body: "Legacy @Lee mention without an indexed mention row.",
        createdAt: 100
      })
      return workspace._id
    })

    await expect(t.withIdentity(leeIdentity).query(api.chat.conversationIndicators, { workspaceId })).resolves.toEqual([
      { channelId: design.id, indicator: "unread" }
    ])
  })

  it("validates read markers against a real message in the selected channel", async () => {
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
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

    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.markChannelRead, {
        channelId: design.id,
        readThroughMessageId: productMessage.id
      })
    ).rejects.toThrow("Read-through message not found in this channel")
  })

  it("keeps unread and mention work bounded across a dense multi-channel dataset", async () => {
    const t = createChatScenario()
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

    const indicators = await t.withIdentity(leeIdentity).query(api.chat.conversationIndicators, { workspaceId })
    expect(indicators).toHaveLength(10)
    expect(indicators.find((indicator) => indicator.channelId === channels[0].id)?.indicator).toBe("mentioned")
    expect(indicators.find((indicator) => indicator.channelId === channels[1].id)?.indicator).toBe("mentioned")
  })
})
