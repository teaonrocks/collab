import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

const workspaceRole = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"), v.literal("guest"))
const channelRole = v.union(v.literal("admin"), v.literal("member"), v.literal("guest"))

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.optional(v.string()),
    authSubject: v.optional(v.string()),
    email: v.string(),
    displayName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_token_identifier", ["tokenIdentifier"]).index("by_email", ["email"]),

  workspaces: defineTable({
    key: v.string(),
    name: v.string(),
    createdAt: v.number()
  }).index("by_key", ["key"]),

  workspaceMemberships: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: workspaceRole,
    createdAt: v.number()
  }).index("by_workspace", ["workspaceId"]).index("by_user", ["userId"]).index("by_workspace_user", [
    "workspaceId",
    "userId"
  ]),

  channels: defineTable({
    workspaceId: v.id("workspaces"),
    key: v.string(),
    name: v.string(),
    visibility: v.union(v.literal("public"), v.literal("private")),
    createdAt: v.number()
  }).index("by_workspace", ["workspaceId"]).index("by_workspace_key", ["workspaceId", "key"]),

  channelMemberships: defineTable({
    channelId: v.id("channels"),
    userId: v.id("users"),
    role: channelRole,
    createdAt: v.number(),
    lastReadAt: v.optional(v.number())
  }).index("by_channel", ["channelId"]).index("by_user", ["userId"]).index("by_channel_user", [
    "channelId",
    "userId"
  ]),

  messages: defineTable({
    workspaceId: v.id("workspaces"),
    channelId: v.id("channels"),
    authorUserId: v.id("users"),
    authorDisplayName: v.optional(v.string()),
    body: v.string(),
    createdAt: v.number(),
    editedAt: v.optional(v.number())
  }).index("by_channel_created_at", ["channelId", "createdAt"]).index("by_workspace_created_at", [
    "workspaceId",
    "createdAt"
  ]),

  messageReactions: defineTable({
    workspaceId: v.id("workspaces"),
    channelId: v.id("channels"),
    messageId: v.id("messages"),
    userId: v.id("users"),
    emoji: v.string(),
    createdAt: v.number()
  }).index("by_message", ["messageId"]).index("by_message_user_emoji", [
    "messageId",
    "userId",
    "emoji"
  ]).index("by_channel_message", [
    "channelId",
    "messageId"
  ])
})
