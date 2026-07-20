import { useMutation, useQuery } from "convex/react"
import { useEffect, useRef, useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { consumeNotificationFeedPage } from "../desktop-notification-feed"
import {
  showDesktopNotification,
  subscribeToDesktopNotificationActivation,
  updateDesktopNotificationContext
} from "../electron-shell"
import type { DogfoodActiveConversation } from "../dogfood-chat-adapter"

type NotificationInput = {
  readonly viewerReady: boolean
  readonly authUserId: string | null
  readonly activeChannelId: Id<"channels"> | undefined
  readonly activateConversation: (conversation: DogfoodActiveConversation) => void
}

export function useDesktopNotifications({
  viewerReady,
  authUserId,
  activeChannelId,
  activateConversation
}: NotificationInput): void {
  const openFeed = useMutation(api.notification_preferences.openFeed)
  const seenEventIdsRef = useRef(new Set<string>())
  const [cursor, setCursor] = useState<number | null>(null)
  const events = useQuery(api.notification_preferences.feed, viewerReady && cursor !== null ? { cursor } : "skip")

  useEffect(() => {
    if (!viewerReady) {
      setCursor(null)
      seenEventIdsRef.current.clear()
      return
    }
    let cancelled = false
    setCursor(null)
    seenEventIdsRef.current.clear()
    void openFeed({})
      .then(({ cursor: openedCursor }) => {
        if (!cancelled) setCursor(openedCursor)
      })
      .catch((cause: unknown) => {
        console.warn("Could not open the desktop notification feed", cause)
      })
    return () => {
      cancelled = true
    }
  }, [authUserId, openFeed, viewerReady])

  useEffect(() => {
    if (activeChannelId === undefined) return
    void updateDesktopNotificationContext(String(activeChannelId)).catch((cause: unknown) => {
      console.warn("Could not update the desktop notification context", cause)
    })
  }, [activeChannelId])

  useEffect(
    () =>
      subscribeToDesktopNotificationActivation((activation) => {
        activateConversation({
          kind: activation.conversationKind,
          id: activation.conversationId as Id<"channels">
        })
      }),
    [activateConversation]
  )

  useEffect(() => {
    if (events === undefined) return
    const page = consumeNotificationFeedPage(events, seenEventIdsRef.current)
    for (const event of page.notifications) {
      void showDesktopNotification({
        messageId: String(event.messageId),
        conversationId: String(event.channelId),
        conversationKind: event.conversationKind,
        title: event.title,
        body: event.body
      }).catch((cause: unknown) => {
        console.warn("Could not show a desktop notification", cause)
      })
    }
    setCursor((current) => (current === null ? page.cursor : Math.max(current, page.cursor)))
  }, [events])
}
