export const desktopNotificationShowChannel = "aether:desktop-notifications-show"
export const desktopNotificationContextChannel = "aether:desktop-notifications-context"
export const desktopNotificationActivatedChannel = "aether:desktop-notifications-activated"

type DesktopNotificationConversationKind = "channel" | "direct"

export type DesktopNotificationRequest = {
  readonly messageId: string
  readonly conversationId: string
  readonly conversationKind: DesktopNotificationConversationKind
  readonly title: string
  readonly body: string
}

export type DesktopNotificationActivation = {
  readonly conversationId: string
  readonly conversationKind: DesktopNotificationConversationKind
}

const nonEmptyString = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maxLength

export const isDesktopNotificationRequest = (value: unknown): value is DesktopNotificationRequest => {
  if (typeof value !== "object" || value === null) return false
  return (
    "messageId" in value &&
    nonEmptyString(value.messageId, 200) &&
    "conversationId" in value &&
    nonEmptyString(value.conversationId, 200) &&
    "conversationKind" in value &&
    (value.conversationKind === "channel" || value.conversationKind === "direct") &&
    "title" in value &&
    nonEmptyString(value.title, 200) &&
    "body" in value &&
    nonEmptyString(value.body, 500)
  )
}

export const isDesktopNotificationActivation = (value: unknown): value is DesktopNotificationActivation => {
  if (typeof value !== "object" || value === null) return false
  return (
    "conversationId" in value &&
    nonEmptyString(value.conversationId, 200) &&
    "conversationKind" in value &&
    (value.conversationKind === "channel" || value.conversationKind === "direct")
  )
}
