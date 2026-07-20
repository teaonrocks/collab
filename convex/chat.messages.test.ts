/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest"
import {
  MESSAGE_REACTION_EMOJIS,
  api,
  internal,
  createChatScenario,
  ensureViewer,
  ensureViewers,
  leeIdentity,
  mayaIdentity,
  messagePageArgs,
  silenceExpectedDogfoodDiagnostics
} from "../src/test/convex-chat"

describe("dogfood channel messages", () => {
  it("accepts the shared reaction policy and broadcasts current-user state", async () => {
    const t = createChatScenario()
    await ensureViewers(t, mayaIdentity, leeIdentity)

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

    await expect(
      t
        .withIdentity(leeIdentity)
        .query(api.chat.channelMessages, messagePageArgs(design.id))
        .then((result) => result.page)
    ).resolves.toEqual([
      expect.objectContaining({
        id: message.id,
        reactions: [{ emoji: "👍", count: 1, reactedByCurrentUser: true }]
      })
    ])
    await expect(
      t
        .withIdentity(mayaIdentity)
        .query(api.chat.channelMessages, messagePageArgs(design.id))
        .then((result) => result.page)
    ).resolves.toEqual([
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

    await expect(
      t
        .withIdentity(leeIdentity)
        .query(api.chat.channelMessages, messagePageArgs(design.id))
        .then((result) => result.page)
    ).resolves.toEqual([expect.objectContaining({ id: message.id, reactions: [] })])

    for (const emoji of MESSAGE_REACTION_EMOJIS) {
      await t.withIdentity(leeIdentity).mutation(api.chat.toggleMessageReaction, {
        channelId: design.id,
        messageId: message.id,
        emoji
      })
    }
    await expect(
      t
        .withIdentity(leeIdentity)
        .query(api.chat.channelMessages, messagePageArgs(design.id))
        .then((result) => result.page)
    ).resolves.toEqual([
      expect.objectContaining({
        id: message.id,
        reactions: MESSAGE_REACTION_EMOJIS.map((emoji) => ({ emoji, count: 1, reactedByCurrentUser: true }))
      })
    ])
  })

  it("creates message replies with compact parent previews", async () => {
    const t = createChatScenario()
    await ensureViewers(t, mayaIdentity, leeIdentity)

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

    await expect(
      t
        .withIdentity(leeIdentity)
        .query(api.chat.channelMessages, messagePageArgs(design.id))
        .then((result) => result.page)
    ).resolves.toEqual([
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
    const t = createChatScenario()
    await ensureViewer(t, mayaIdentity)

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["image"], { type: "image/png" })))
    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", mayaIdentity.tokenIdentifier))
        .unique()
      if (user === null) throw new Error("test user missing")
      await ctx.db.insert("attachmentUploads", {
        storageId,
        uploaderUserId: user._id,
        contentType: "image/png",
        createdAt: Date.now()
      })
    })
    const message = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "",
      attachments: [{ storageId, name: "  brief.png  " }]
    })

    expect(message).toMatchObject({
      body: "",
      attachments: [
        expect.objectContaining({
          storageId,
          name: "brief.png",
          contentType: "image/png",
          size: 5,
          kind: "image"
        })
      ]
    })
    expect(message.attachments[0]?.url).toEqual(expect.any(String))

    await expect(
      t
        .withIdentity(mayaIdentity)
        .query(api.chat.channelMessages, messagePageArgs(design.id))
        .then((result) => result.page)
    ).resolves.toEqual([
      expect.objectContaining({
        id: message.id,
        attachments: [expect.objectContaining({ storageId, url: expect.any(String) })]
      })
    ])
  })

  it("enforces attachment policy and ownership, then deletes claimed storage with its message", async () => {
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
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
    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "attachment-policy" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })

    const disallowedId = await t.run((ctx) => ctx.storage.store(new Blob(["binary"])))
    const { intentId: disallowedIntentId } = await t
      .withIdentity(mayaIdentity)
      .mutation(api.chat.generateAttachmentUploadUrl, {})
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.registerAttachmentUpload, {
        intentId: disallowedIntentId,
        storageId: disallowedId,
        contentType: "application/zip"
      })
    ).resolves.toEqual({
      status: "rejected",
      reason: "Attachments must be a PNG, JPEG, GIF, WebP, PDF, or plain-text file"
    })
    await expect(t.run((ctx) => ctx.db.system.get("_storage", disallowedId))).resolves.toBeNull()

    const oversizedId = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(25 * 1024 * 1024 + 1)])))
    const { intentId: oversizedIntentId } = await t
      .withIdentity(mayaIdentity)
      .mutation(api.chat.generateAttachmentUploadUrl, {})
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.registerAttachmentUpload, {
        intentId: oversizedIntentId,
        storageId: oversizedId,
        contentType: "image/png"
      })
    ).resolves.toEqual({ status: "rejected", reason: "Attachments can be at most 25 MB" })
    await expect(t.run((ctx) => ctx.db.system.get("_storage", oversizedId))).resolves.toBeNull()

    const abandonedId = await t.run((ctx) => ctx.storage.store(new Blob(["abandoned"])))
    const { intentId: abandonedIntentId } = await t
      .withIdentity(mayaIdentity)
      .mutation(api.chat.generateAttachmentUploadUrl, {})
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.deleteAttachmentUpload, {
        intentId: abandonedIntentId,
        storageId: abandonedId
      })
    ).rejects.toThrow("Only the uploader")
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.deleteAttachmentUpload, {
        intentId: abandonedIntentId,
        storageId: abandonedId
      })
    ).resolves.toEqual({ storageId: abandonedId })
    await expect(t.run((ctx) => ctx.db.system.get("_storage", abandonedId))).resolves.toBeNull()

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["private"])))
    const { intentId } = await t.withIdentity(mayaIdentity).mutation(api.chat.generateAttachmentUploadUrl, {})
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.registerAttachmentUpload, {
        intentId,
        storageId,
        contentType: "text/plain"
      })
    ).resolves.toEqual({ status: "registered", storageId })
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.registerAttachmentUpload, {
        intentId,
        storageId,
        contentType: "text/plain"
      })
    ).resolves.toEqual({ status: "registered", storageId })
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.registerAttachmentUpload, {
        intentId,
        storageId,
        contentType: "text/plain"
      })
    ).rejects.toThrow("already registered")
    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.sendMessage, {
        channelId: design.id,
        body: "",
        attachments: [{ storageId, name: "private.txt" }]
      })
    ).rejects.toThrow("Attachment upload is not owned by the current user")

    const message = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "",
      attachments: [{ storageId, name: "private.txt" }]
    })
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
        channelId: design.id,
        body: "",
        attachments: [{ storageId, name: "again.txt" }]
      })
    ).rejects.toThrow("has already been claimed")
    const issuedUrl = message.attachments[0]?.url
    expect(issuedUrl).toEqual(expect.any(String))

    await t.withIdentity(mayaIdentity).mutation(api.chat.deleteMessage, { channelId: design.id, messageId: message.id })
    await expect(t.run((ctx) => ctx.db.system.get("_storage", storageId))).resolves.toBeNull()
    expect(issuedUrl).not.toBeNull()
  })

  it("rejects reply parents from another channel and keeps replies visible after parent deletion", async () => {
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
    await ensureViewers(t, mayaIdentity, leeIdentity)

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    const product = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "product" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: product.id })
    const parent = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "Parent in design."
    })

    await expect(
      t.withIdentity(leeIdentity).mutation(api.chat.sendMessage, {
        channelId: product.id,
        body: "Wrong channel reply.",
        parentMessageId: parent.id
      })
    ).rejects.toThrow("Parent message not found")

    const reply = await t.withIdentity(leeIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "Valid reply before deletion.",
      parentMessageId: parent.id
    })
    await t.withIdentity(mayaIdentity).mutation(api.chat.deleteMessage, {
      channelId: design.id,
      messageId: parent.id
    })

    await expect(
      t
        .withIdentity(leeIdentity)
        .query(api.chat.channelMessages, messagePageArgs(design.id))
        .then((result) => result.page)
    ).resolves.toEqual([
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
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
    await ensureViewer(t, mayaIdentity)
    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })

    await t.run(async (ctx) => {
      const workspace = await ctx.db
        .query("workspaces")
        .withIndex("by_key", (q) => q.eq("key", "aether-dogfood"))
        .unique()
      const maya = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", mayaIdentity.email))
        .unique()
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
    await expect(
      t.withIdentity(mayaIdentity).query(api.chat.channelMessages, messagePageArgs(design.id, 101))
    ).rejects.toThrow("Message pages must contain between 1 and 100 items")
  })

  it("searches the full authorized channel history with a bounded query", async () => {
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
    await ensureViewers(t, mayaIdentity, leeIdentity)
    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design-search" })
    const product = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "product-search" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })

    await t.run(async (ctx) => {
      const workspace = await ctx.db
        .query("workspaces")
        .withIndex("by_key", (q) => q.eq("key", "aether-dogfood"))
        .unique()
      const maya = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", mayaIdentity.email))
        .unique()
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

    await expect(
      t.withIdentity(leeIdentity).query(api.chat.searchChannelMessages, {
        channelId: design.id,
        query: "archaeology"
      })
    ).resolves.toEqual([
      expect.objectContaining({
        channelId: design.id,
        body: "The buried archaeology decision is approved."
      })
    ])
    await expect(
      t.withIdentity(leeIdentity).query(api.chat.searchChannelMessages, {
        channelId: product.id,
        query: "archaeology"
      })
    ).rejects.toThrow("Current user is not a member of this channel")
    await expect(
      t.withIdentity(mayaIdentity).query(api.chat.searchChannelMessages, {
        channelId: design.id,
        query: "x".repeat(121)
      })
    ).rejects.toThrow("Search queries can contain at most 120 characters")
  })

  it("enforces exact channel, message, edit, and attachment metadata limits", async () => {
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
    await ensureViewer(t, mayaIdentity)

    const boundaryChannel = await t
      .withIdentity(mayaIdentity)
      .mutation(api.chat.createChannel, { name: "c".repeat(80) })
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "c".repeat(81) })
    ).rejects.toThrow("Channel names can contain at most 80 characters")

    const boundaryMessage = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: boundaryChannel.id,
      body: "m".repeat(8_000)
    })
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
        channelId: boundaryChannel.id,
        body: "m".repeat(8_001)
      })
    ).rejects.toThrow("Message bodies can contain at most 8000 characters")
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.editMessage, {
        channelId: boundaryChannel.id,
        messageId: boundaryMessage.id,
        body: "e".repeat(8_000)
      })
    ).resolves.toMatchObject({ body: "e".repeat(8_000) })
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.editMessage, {
        channelId: boundaryChannel.id,
        messageId: boundaryMessage.id,
        body: "e".repeat(8_001)
      })
    ).rejects.toThrow("Message bodies can contain at most 8000 characters")

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["file"])))
    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", mayaIdentity.tokenIdentifier))
        .unique()
      if (user === null) throw new Error("test user missing")
      await ctx.db.insert("attachmentUploads", {
        storageId,
        uploaderUserId: user._id,
        contentType: "text/plain",
        createdAt: Date.now()
      })
    })
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
        channelId: boundaryChannel.id,
        body: "",
        attachments: [{ storageId, name: "a".repeat(180) }]
      })
    ).resolves.toMatchObject({ attachments: [expect.objectContaining({ name: "a".repeat(180) })] })
    const secondStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["file"])))
    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", mayaIdentity.tokenIdentifier))
        .unique()
      if (user === null) throw new Error("test user missing")
      await ctx.db.insert("attachmentUploads", {
        storageId: secondStorageId,
        uploaderUserId: user._id,
        contentType: "text/plain",
        createdAt: Date.now()
      })
    })
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
        channelId: boundaryChannel.id,
        body: "",
        attachments: [{ storageId: secondStorageId, name: "a".repeat(181) }]
      })
    ).rejects.toThrow("Attachment names can contain at most 180 characters")
    await expect(
      t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
        channelId: boundaryChannel.id,
        body: "",
        attachments: Array.from({ length: 5 }, () => ({ storageId, name: "file" }))
      })
    ).rejects.toThrow("Messages can include at most 4 attachments")
  })

  it("collapses duplicate reaction rows from the same user", async () => {
    const t = createChatScenario()
    await ensureViewers(t, mayaIdentity, leeIdentity)

    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "design" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })
    const message = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "Duplicate rows should not double count."
    })

    await t.run(async (ctx) => {
      const lee = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", leeIdentity.email))
        .unique()
      if (lee === null) throw new Error("Seed user not found")
      await ctx.db.insert("messageReactions", {
        channelId: design.id,
        messageId: message.id,
        userId: lee._id,
        emoji: "👍",
        createdAt: 10
      })
      await ctx.db.insert("messageReactions", {
        channelId: design.id,
        messageId: message.id,
        userId: lee._id,
        emoji: "👍",
        createdAt: 11
      })
    })

    await expect(
      t
        .withIdentity(leeIdentity)
        .query(api.chat.channelMessages, messagePageArgs(design.id))
        .then((result) => result.page)
    ).resolves.toEqual([
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
    const t = createChatScenario()
    await ensureViewers(t, mayaIdentity, leeIdentity)
    const design = await t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: "reaction-batch" })
    await t.withIdentity(leeIdentity).mutation(api.chat.ensureChannelMember, { channelId: design.id })
    const current = await t.withIdentity(mayaIdentity).mutation(api.chat.sendMessage, {
      channelId: design.id,
      body: "Current reaction path"
    })
    const legacyId = await t.run(async (ctx) => {
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
      const legacyId = await ctx.db.insert("messages", {
        workspaceId: workspace._id,
        channelId: design.id,
        authorUserId: maya._id,
        authorDisplayName: maya.displayName,
        body: "Legacy reaction path",
        createdAt: current.createdAt - 1
      })
      await ctx.db.insert("messageReactions", {
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
    expect(page.page.find((message) => message.id === current.id)?.reactions).toEqual([
      { emoji: "👍", count: 1, reactedByCurrentUser: true }
    ])
    expect(page.page.find((message) => message.id === legacyId)?.reactions).toEqual([
      { emoji: "👀", count: 1, reactedByCurrentUser: true }
    ])
  })
})
