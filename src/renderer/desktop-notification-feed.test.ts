import { describe, expect, it } from "vitest"
import { consumeNotificationFeedPage, takeUnseenNotificationEvents } from "./desktop-notification-feed"

describe("desktop notification subscription deduplication", () => {
  it("emits each event once across repeated and replayed snapshots", () => {
    const seen = new Set<string>()
    const first = { id: "event-1", body: "First" }
    const second = { id: "event-2", body: "Second" }

    expect(takeUnseenNotificationEvents([first], seen)).toEqual([first])
    expect(takeUnseenNotificationEvents([first], seen)).toEqual([])
    expect(takeUnseenNotificationEvents([first, second], seen)).toEqual([second])
    expect(takeUnseenNotificationEvents([first, second], seen)).toEqual([])
  })

  it("advances the acknowledged server cursor while suppressing a reconnect replay", () => {
    const seen = new Set<string>()
    const first = { id: "event-1", body: "First" }
    const second = { id: "event-2", body: "Second" }

    expect(consumeNotificationFeedPage({ cursor: 2, notifications: [first, second] }, seen)).toEqual({
      cursor: 2,
      notifications: [first, second]
    })
    expect(consumeNotificationFeedPage({ cursor: 2, notifications: [first, second] }, seen)).toEqual({
      cursor: 2,
      notifications: []
    })
    expect(consumeNotificationFeedPage({ cursor: 3, notifications: [{ id: "event-3", body: "Third" }] }, seen)).toEqual(
      { cursor: 3, notifications: [{ id: "event-3", body: "Third" }] }
    )
  })
})
