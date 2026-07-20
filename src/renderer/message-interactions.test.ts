import { describe, expect, it } from "vitest"
import type { ChatMessage } from "./chat-data"
import { createMessageInteractionView, pruneSelectedMessageIds, toggleMessageId } from "./message-interactions"

const channelId = "channel-1"

const makeMessage = (input: {
  readonly id: string
  readonly authorDisplayName?: string
  readonly createdAt?: number
  readonly deletedAt?: number | null
}): ChatMessage => ({
  id: input.id,
  channelId,
  authorType: "human",
  authorId: `human-${input.id}`,
  authorDisplayName: input.authorDisplayName ?? "Maya Patel",
  body: `Body ${input.id}`,
  createdAt: input.createdAt ?? 1,
  editedAt: null,
  deletedAt: input.deletedAt ?? null,
  parentMessageId: null,
  parentMessage: null,
  reactions: [],
  attachments: []
})

describe("message interactions", () => {
  it("toggles selected message ids without reordering the remaining selection", () => {
    const first = "message-1"
    const second = "message-2"

    expect(toggleMessageId([first], second)).toEqual([first, second])
    expect(toggleMessageId([first, second], first)).toEqual([second])
  })

  it("prunes selection to live messages", () => {
    const live = makeMessage({ id: "message-1" })
    const deleted = makeMessage({ id: "message-2", deletedAt: 12 })

    expect(pruneSelectedMessageIds([live.id, deleted.id], [live, deleted])).toEqual([live.id])
  })

  it("derives row and overlay state from a single interaction view", () => {
    const first = makeMessage({ id: "message-1", authorDisplayName: "Maya Patel", createdAt: 1 })
    const second = makeMessage({ id: "message-2", authorDisplayName: "Lee Chen", createdAt: 2 })
    const deleted = makeMessage({ id: "message-3", authorDisplayName: "Rina Shah", createdAt: 3, deletedAt: 4 })
    const view = createMessageInteractionView(
      [first, second, deleted],
      [second.id, first.id, deleted.id],
      { messageId: second.id, draft: "Updated body", saving: true },
      second.id,
      { messageId: second.id, x: 20, y: 30 }
    )

    expect(view.selectedMessageIds).toEqual([second.id, first.id])
    expect(view.topSelectedMessageId).toBe(first.id)
    expect(view.menuMessage).toBe(second)
    expect(view.pendingDeleteMessage).toBe(second)
    expect(view.getRowState(first)).toMatchObject({
      selected: true,
      selectionMode: true,
      actionsPinned: true,
      actionsAvailable: true,
      editingDraft: null,
      editSaving: false
    })
    expect(view.getRowState(second)).toMatchObject({
      selected: true,
      selectionMode: true,
      actionsPinned: false,
      actionsAvailable: false,
      editingDraft: "Updated body",
      editSaving: true
    })
    expect(view.getRowState(deleted).selected).toBe(false)
  })
})
