import { describe, expect, it, vi } from "vitest"
import { desktopNotificationActivatedChannel, type DesktopNotificationRequest } from "../shared/desktop-notifications"
import { createDesktopNotificationCoordinator, type DesktopNotificationWindowRecord } from "./desktop-notifications"

const request: DesktopNotificationRequest = {
  messageId: "message-1",
  conversationId: "channel-1",
  conversationKind: "channel",
  title: "#general",
  body: "Maya: Hello"
}

const record = (input: {
  readonly windowId: number
  readonly accountId?: string
  readonly focused?: boolean
  readonly visible?: boolean
}) => {
  let click: (() => void) | null = null
  const notification = {
    on: vi.fn((_event: "click", listener: () => void) => {
      click = listener
    }),
    show: vi.fn()
  }
  const window = {
    id: input.windowId,
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => input.focused ?? false),
    isVisible: vi.fn(() => input.visible ?? true),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn()
  }
  return {
    value: { accountId: input.accountId ?? "account-1", window } satisfies DesktopNotificationWindowRecord,
    notification,
    click: () => click?.()
  }
}

describe("desktop notification coordinator", () => {
  it("suppresses a conversation actively viewed in any same-account window", () => {
    const source = record({ windowId: 1 })
    const active = record({ windowId: 2, focused: true })
    const createNotification = vi.fn(() => source.notification)
    const coordinator = createDesktopNotificationCoordinator({
      records: () => [source.value, active.value],
      isSupported: () => true,
      createNotification
    })
    coordinator.updateContext(source.value, "channel-2")
    coordinator.updateContext(active.value, "channel-1")

    expect(coordinator.show(source.value, request)).toBe("suppressed")
    expect(coordinator.show(source.value, request)).toBe("duplicate")
    expect(createNotification).not.toHaveBeenCalled()
  })

  it("deduplicates across windows and activates the conversation when clicked", () => {
    const source = record({ windowId: 1 })
    const second = record({ windowId: 2 })
    const coordinator = createDesktopNotificationCoordinator({
      records: () => [source.value, second.value],
      isSupported: () => true,
      createNotification: () => source.notification
    })
    coordinator.updateContext(source.value, "channel-2")
    coordinator.updateContext(second.value, "channel-1")

    expect(coordinator.show(source.value, request)).toBe("shown")
    expect(coordinator.show(second.value, request)).toBe("duplicate")
    expect(source.notification.show).toHaveBeenCalledOnce()

    source.click()
    expect(second.value.window.focus).toHaveBeenCalledOnce()
    expect(second.value.window.webContents.send).toHaveBeenCalledWith(desktopNotificationActivatedChannel, {
      conversationId: "channel-1",
      conversationKind: "channel"
    })
  })
})
