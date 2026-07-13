import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

const workspaceRole = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"), v.literal("guest"))
const channelRole = v.union(v.literal("admin"), v.literal("member"), v.literal("guest"))
const directMessagePreference = v.union(v.literal("all"), v.literal("mutuals"), v.literal("friends"))
const friendRequestStatus = v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined"))
const messageAttachmentKind = v.union(v.literal("file"), v.literal("image"))
const messageAttachment = v.object({
  storageId: v.id("_storage"),
  name: v.string(),
  contentType: v.string(),
  size: v.number(),
  kind: messageAttachmentKind
})

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.optional(v.string()),
    authSubject: v.optional(v.string()),
    email: v.string(),
    displayName: v.string(),
    // Optional during the rollout so existing accounts can be backfilled safely.
    username: v.optional(v.string()),
    directMessagePreference: v.optional(directMessagePreference),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number())
  }).index("by_token_identifier", ["tokenIdentifier"]).index("by_email", ["email"])
    .index("by_username", ["username"])
    .searchIndex("search_username", { searchField: "username" }),

  friendRequests: defineTable({
    pairKey: v.string(),
    requesterUserId: v.id("users"),
    recipientUserId: v.id("users"),
    status: friendRequestStatus,
    createdAt: v.number(),
    respondedAt: v.optional(v.number())
  }).index("by_pair_key", ["pairKey"])
    .index("by_recipient_and_status", ["recipientUserId", "status"])
    .index("by_requester_and_status", ["requesterUserId", "status"]),

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
    // Workspace channels require this; global direct conversations omit it.
    workspaceId: v.optional(v.id("workspaces")),
    key: v.string(),
    name: v.string(),
    visibility: v.union(v.literal("public"), v.literal("private")),
    kind: v.optional(v.literal("direct")),
    directPairKey: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    deletedAt: v.optional(v.number()),
    createdAt: v.number()
  }).index("by_workspace", ["workspaceId"])
    .index("by_workspace_and_deleted_at", ["workspaceId", "deletedAt"])
    .index("by_workspace_kind_and_deleted_at", ["workspaceId", "kind", "deletedAt"])
    .index("by_workspace_key", ["workspaceId", "key"])
    .index("by_workspace_and_direct_pair_key", ["workspaceId", "directPairKey"])
    .index("by_direct_pair_key", ["directPairKey"]),

  channelMemberships: defineTable({
    channelId: v.id("channels"),
    workspaceId: v.optional(v.id("workspaces")),
    channelKind: v.optional(v.literal("direct")),
    userId: v.id("users"),
    role: channelRole,
    createdAt: v.number(),
    lastReadAt: v.optional(v.number()),
    mentionTrackingStartedAt: v.optional(v.number())
  }).index("by_channel", ["channelId"]).index("by_user", ["userId"])
    .index("by_user_and_workspace", ["userId", "workspaceId"])
    .index("by_user_workspace_and_channel_kind", ["userId", "workspaceId", "channelKind"])
    .index("by_user_and_channel_kind", ["userId", "channelKind"])
    .index("by_channel_user", [
    "channelId",
    "userId"
  ]),

  messages: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    channelId: v.id("channels"),
    authorUserId: v.id("users"),
    authorDisplayName: v.optional(v.string()),
    body: v.string(),
    parentMessageId: v.optional(v.id("messages")),
    attachments: v.optional(v.array(messageAttachment)),
    reactionBatchReady: v.optional(v.boolean()),
    createdAt: v.number(),
    editedAt: v.optional(v.number())
  }).index("by_channel_created_at", ["channelId", "createdAt"]).index("by_workspace_created_at", [
    "workspaceId",
    "createdAt"
  ]).index("by_parent_message", ["parentMessageId"]).searchIndex("search_body", {
    searchField: "body",
    filterFields: ["channelId"]
  }),

  messageMentions: defineTable({
    channelId: v.id("channels"),
    messageId: v.id("messages"),
    userId: v.id("users"),
    messageCreatedAt: v.number()
  }).index("by_channel_user_created_at", ["channelId", "userId", "messageCreatedAt"])
    .index("by_message", ["messageId"]),

  attachmentUploads: defineTable({
    storageId: v.id("_storage"),
    uploaderUserId: v.id("users"),
    contentType: v.string(),
    createdAt: v.number(),
    claimedMessageId: v.optional(v.id("messages"))
  }).index("by_storage_id", ["storageId"]).index("by_uploader", ["uploaderUserId"]),

  attachmentUploadIntents: defineTable({
    uploaderUserId: v.id("users"),
    createdAt: v.number()
  }).index("by_uploader", ["uploaderUserId"]),

  messageReactions: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    channelId: v.id("channels"),
    messageId: v.id("messages"),
    userId: v.id("users"),
    emoji: v.string(),
    messageCreatedAt: v.optional(v.number()),
    createdAt: v.number()
  }).index("by_message", ["messageId"]).index("by_message_user_emoji", [
    "messageId",
    "userId",
    "emoji"
  ]).index("by_channel_message", [
    "channelId",
    "messageId"
  ]).index("by_channel_and_message_created_at", [
    "channelId",
    "messageCreatedAt"
  ]),

  dogfoodAllowlistEntries: defineTable({
    email: v.string(),
    active: v.boolean(),
    createdAt: v.number(),
    createdBy: v.string(),
    updatedAt: v.number(),
    updatedBy: v.string()
  }).index("by_email", ["email"]).index("by_active", ["active"]),

  dogfoodAllowlistAudit: defineTable({
    email: v.string(),
    action: v.union(v.literal("add"), v.literal("remove")),
    operator: v.string(),
    reason: v.optional(v.string()),
    createdAt: v.number()
  }).index("by_email", ["email"]).index("by_created_at", ["createdAt"])
})
