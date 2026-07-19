import { describe, expect, it } from "vitest"
import type { Doc, Id } from "./_generated/dataModel"
import { aggregateReactionRows, trimParentPreview } from "./chat_message_projection"

const id = <TableName extends "channels" | "messages" | "users" | "messageReactions">(
  value: string
): Id<TableName> => value as Id<TableName>

const reaction = (
  reactionId: string,
  userId: Id<"users">,
  emoji: string
): Doc<"messageReactions"> => ({
  _id: id<"messageReactions">(reactionId),
  _creationTime: 1,
  channelId: id<"channels">("channel"),
  messageId: id<"messages">("message"),
  userId,
  emoji,
  messageCreatedAt: 1,
  createdAt: 1
})

describe("message projection internals", () => {
  it("deduplicates legacy reaction rows by user and preserves the product emoji order", () => {
    const currentUserId = id<"users">("current-user")
    const otherUserId = id<"users">("other-user")

    expect(aggregateReactionRows([
      reaction("one", currentUserId, "🎉"),
      reaction("two", currentUserId, "🎉"),
      reaction("three", otherUserId, "👍"),
      reaction("four", otherUserId, "custom")
    ], currentUserId)).toEqual([
      { emoji: "👍", count: 1, reactedByCurrentUser: false },
      { emoji: "🎉", count: 1, reactedByCurrentUser: true },
      { emoji: "custom", count: 1, reactedByCurrentUser: false }
    ])
  })

  it("normalizes and bounds parent previews", () => {
    expect(trimParentPreview("  compact\n\tparent   preview  ")).toBe("compact parent preview")
    expect(trimParentPreview("x".repeat(121))).toBe(`${"x".repeat(117)}...`)
  })
})
