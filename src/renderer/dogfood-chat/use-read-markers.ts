import { useMutation } from "convex/react"
import { useEffect, useRef, useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { latestMessageId } from "./use-dogfood-data"

type ReadMarkerInput = {
  readonly viewerReady: boolean
  readonly activeKind: "channel" | "direct"
  readonly activeChannelId: Id<"channels"> | undefined
  readonly activeChannelJoined: boolean
  readonly messagesLoading: boolean
  readonly messages: ReadonlyArray<{ readonly id: Id<"messages">; readonly createdAt: number }>
  readonly onFailure: (cause: unknown) => void
}

export function useReadMarkers(input: ReadMarkerInput): void {
  const markChannelRead = useMutation(api.chat.markChannelRead)
  const lastReadMarkerRef = useRef<string | null>(null)
  const windowActive = useWindowActive()

  useEffect(() => {
    if (
      !input.viewerReady ||
      !windowActive ||
      input.activeChannelId === undefined ||
      (input.activeKind === "channel" && !input.activeChannelJoined) ||
      input.messagesLoading
    )
      return
    const readThroughMessageId = latestMessageId(input.messages)
    if (readThroughMessageId === null) return
    const readMarker = `${input.activeChannelId}:${readThroughMessageId}`
    if (lastReadMarkerRef.current === readMarker) return
    lastReadMarkerRef.current = readMarker
    void markChannelRead({ channelId: input.activeChannelId, readThroughMessageId }).catch(input.onFailure)
  }, [input, markChannelRead, windowActive])
}

function useWindowActive(): boolean {
  const [windowActive, setWindowActive] = useState(() => document.visibilityState === "visible" && document.hasFocus())

  useEffect(() => {
    const update = () => setWindowActive(document.visibilityState === "visible" && document.hasFocus())
    window.addEventListener("focus", update)
    window.addEventListener("blur", update)
    document.addEventListener("visibilitychange", update)
    return () => {
      window.removeEventListener("focus", update)
      window.removeEventListener("blur", update)
      document.removeEventListener("visibilitychange", update)
    }
  }, [])

  return windowActive
}
