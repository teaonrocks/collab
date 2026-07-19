import {
  desktopNotificationActivatedChannel,
  type DesktopNotificationActivation,
  type DesktopNotificationRequest
} from "../shared/desktop-notifications"

const MAX_DEDUPLICATION_KEYS = 1_000

type DesktopNotificationWindow = {
  readonly id: number
  readonly webContents: { readonly send: (channel: string, payload: DesktopNotificationActivation) => void }
  readonly isDestroyed: () => boolean
  readonly isFocused: () => boolean
  readonly isVisible: () => boolean
  readonly isMinimized: () => boolean
  readonly restore: () => void
  readonly show: () => void
  readonly focus: () => void
}

export type DesktopNotificationWindowRecord = {
  readonly accountId: string
  readonly window: DesktopNotificationWindow
}

type NativeNotification = {
  readonly on: (event: "click", listener: () => void) => void
  readonly show: () => void
}

export const createDesktopNotificationCoordinator = (options: {
  readonly records: () => Iterable<DesktopNotificationWindowRecord>
  readonly isSupported: () => boolean
  readonly createNotification: (input: { readonly title: string; readonly body: string }) => NativeNotification
}) => {
  const activeConversationByWindowId = new Map<number, string>()
  const deduplicationKeys = new Map<string, true>()

  const remember = (key: string) => {
    deduplicationKeys.set(key, true)
    if (deduplicationKeys.size <= MAX_DEDUPLICATION_KEYS) return
    const oldest = deduplicationKeys.keys().next().value
    if (oldest !== undefined) deduplicationKeys.delete(oldest)
  }

  const accountRecords = (accountId: string) =>
    [...options.records()].filter((record) => record.accountId === accountId && !record.window.isDestroyed())

  return {
    updateContext(record: DesktopNotificationWindowRecord, conversationId: string) {
      activeConversationByWindowId.set(record.window.id, conversationId)
    },
    removeWindow(windowId: number) {
      activeConversationByWindowId.delete(windowId)
    },
    show(record: DesktopNotificationWindowRecord, request: DesktopNotificationRequest): "shown" | "duplicate" | "suppressed" | "unsupported" {
      const key = `${record.accountId}:${request.messageId}`
      if (deduplicationKeys.has(key)) return "duplicate"
      remember(key)

      const records = accountRecords(record.accountId)
      const activelyViewed = records.some((candidate) =>
        activeConversationByWindowId.get(candidate.window.id) === request.conversationId &&
        candidate.window.isFocused() &&
        candidate.window.isVisible()
      )
      if (activelyViewed) return "suppressed"
      if (!options.isSupported()) return "unsupported"

      const notification = options.createNotification({ title: request.title, body: request.body })
      notification.on("click", () => {
        const currentRecords = accountRecords(record.accountId)
        const target = currentRecords.find((candidate) =>
          activeConversationByWindowId.get(candidate.window.id) === request.conversationId
        ) ?? (record.window.isDestroyed() ? currentRecords[0] : record)
        if (target === undefined || target.window.isDestroyed()) return
        if (target.window.isMinimized()) target.window.restore()
        target.window.show()
        target.window.focus()
        target.window.webContents.send(desktopNotificationActivatedChannel, {
          conversationId: request.conversationId,
          conversationKind: request.conversationKind
        })
      })
      notification.show()
      return "shown"
    }
  }
}
