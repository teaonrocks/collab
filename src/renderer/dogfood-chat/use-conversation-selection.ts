import type { Id } from "../../../convex/_generated/dataModel"
import { useMutation } from "convex/react"
import { useEffect, useMemo, useState } from "react"
import { api } from "../../../convex/_generated/api"
import type {
  DogfoodActiveConversation,
  DogfoodChannelView,
  DogfoodDirectConversationView,
  DogfoodWorkspaceView
} from "../dogfood-chat-adapter"

type SelectionInput = {
  readonly viewerReady: boolean
  readonly workspace: DogfoodWorkspaceView | null | undefined
  readonly channels: ReadonlyArray<DogfoodChannelView> | undefined
  readonly directConversations: ReadonlyArray<DogfoodDirectConversationView> | undefined
  readonly onMembershipError: (cause: unknown) => void
}

export type DogfoodConversationSelection = {
  readonly selectedConversation: DogfoodActiveConversation | null
  readonly activeKind: DogfoodActiveConversation["kind"]
  readonly activeChannel: Pick<DogfoodChannelView, "id" | "name" | "visibility"> | undefined
  readonly activeChannelId: Id<"channels"> | undefined
  readonly activeChannelJoined: boolean
  readonly channelList: ReadonlyArray<DogfoodChannelView> | undefined
  readonly directConversations: ReadonlyArray<DogfoodDirectConversationView>
  readonly selectChannel: (channelId: Id<"channels">) => void
  readonly selectDirectConversation: (conversationId: Id<"channels">) => void
  readonly recordCreatedChannel: (channel: DogfoodChannelView) => void
  readonly recordDeletedChannel: (channelId: Id<"channels">) => void
  readonly recordDirectConversation: (conversation: DogfoodDirectConversationView) => void
  readonly recordSelfRemoved: (channelId: Id<"channels">) => void
  readonly activateConversation: (conversation: DogfoodActiveConversation) => void
}

export function useConversationSelection({
  viewerReady,
  workspace,
  channels,
  directConversations,
  onMembershipError
}: SelectionInput): DogfoodConversationSelection {
  const ensureChannelMember = useMutation(api.chat.ensureChannelMember)
  const [selectedConversation, setSelectedConversation] = useState<DogfoodActiveConversation | null>(null)
  const [stableDirectConversations, setStableDirectConversations] = useState<
    ReadonlyArray<DogfoodDirectConversationView>
  >([])
  const [joinedChannelIds, setJoinedChannelIds] = useState<ReadonlySet<Id<"channels">>>(() => new Set())
  const [createdChannels, setCreatedChannels] = useState<ReadonlyArray<DogfoodChannelView>>([])

  const channelList = useMemo(
    () => (channels === undefined ? undefined : mergeChannels(channels, createdChannels)),
    [channels, createdChannels]
  )

  useEffect(() => {
    if (directConversations !== undefined) setStableDirectConversations(directConversations)
  }, [directConversations])

  useEffect(() => {
    if (workspace === undefined || workspace === null) return
    setJoinedChannelIds((existing) =>
      existing.has(workspace.channel.id) ? existing : new Set([...existing, workspace.channel.id])
    )
  }, [workspace])

  const activeKind = selectedConversation?.kind ?? "channel"
  const selectedChannelId = selectedConversation?.kind === "channel" ? selectedConversation.id : null
  const activeChannel =
    activeKind === "direct"
      ? undefined
      : selectedChannelId === null
        ? workspace?.channel
        : (channelList?.find((channel) => channel.id === selectedChannelId) ?? workspace?.channel)
  const activeDirectConversation =
    selectedConversation?.kind === "direct"
      ? stableDirectConversations.find((conversation) => conversation.id === selectedConversation.id)
      : undefined
  const activeChannelId = activeDirectConversation?.id ?? activeChannel?.id
  const activeChannelJoined = activeChannelId === undefined ? false : joinedChannelIds.has(activeChannelId)

  useEffect(() => {
    if (!viewerReady || activeKind === "direct" || activeChannelId === undefined || activeChannelJoined) return
    let cancelled = false
    void ensureChannelMember({ channelId: activeChannelId })
      .then(() => {
        if (cancelled) return
        setJoinedChannelIds((existing) =>
          existing.has(activeChannelId) ? existing : new Set([...existing, activeChannelId])
        )
      })
      .catch((cause: unknown) => {
        if (!cancelled) onMembershipError(cause)
      })
    return () => {
      cancelled = true
    }
  }, [activeChannelId, activeChannelJoined, activeKind, ensureChannelMember, onMembershipError, viewerReady])

  useEffect(() => {
    if (workspace === undefined || workspace === null || channelList === undefined) return
    if (selectedConversation?.kind !== "channel") return
    if (channelList.some((channel) => channel.id === selectedChannelId)) return
    setSelectedConversation({ kind: "channel", id: workspace.channel.id })
  }, [channelList, selectedChannelId, selectedConversation, workspace])

  useEffect(() => {
    if (selectedConversation?.kind !== "direct" || directConversations === undefined) return
    if (directConversations.some((conversation) => conversation.id === selectedConversation.id)) return
    if (workspace !== undefined && workspace !== null) {
      setSelectedConversation({ kind: "channel", id: workspace.channel.id })
    }
  }, [directConversations, selectedConversation, workspace])

  const recordCreatedChannel = (channel: DogfoodChannelView) => {
    setCreatedChannels((existing) => mergeChannels(existing, [channel]))
    setJoinedChannelIds((existing) => new Set([...existing, channel.id]))
    setSelectedConversation({ kind: "channel", id: channel.id })
  }

  const recordDeletedChannel = (channelId: Id<"channels">) => {
    if (selectedConversation?.kind === "channel" && selectedConversation.id === channelId && workspace != null) {
      setSelectedConversation({ kind: "channel", id: workspace.channel.id })
    }
    setCreatedChannels((existing) => existing.filter((channel) => channel.id !== channelId))
  }

  const recordDirectConversation = (conversation: DogfoodDirectConversationView) => {
    setStableDirectConversations((existing) => [
      conversation,
      ...existing.filter((item) => item.id !== conversation.id)
    ])
    setSelectedConversation({ kind: "direct", id: conversation.id })
  }

  const recordSelfRemoved = (channelId: Id<"channels">) => {
    if (workspace != null) setSelectedConversation({ kind: "channel", id: workspace.channel.id })
    setJoinedChannelIds((existing) => {
      const next = new Set(existing)
      next.delete(channelId)
      return next
    })
    setCreatedChannels((existing) => existing.filter((channel) => channel.id !== channelId))
  }

  return {
    selectedConversation,
    activeKind,
    activeChannel,
    activeChannelId,
    activeChannelJoined,
    channelList,
    directConversations: stableDirectConversations,
    selectChannel: (channelId) => setSelectedConversation({ kind: "channel", id: channelId }),
    selectDirectConversation: (conversationId) => setSelectedConversation({ kind: "direct", id: conversationId }),
    recordCreatedChannel,
    recordDeletedChannel,
    recordDirectConversation,
    recordSelfRemoved,
    activateConversation: setSelectedConversation
  }
}

const mergeChannels = (
  channels: ReadonlyArray<DogfoodChannelView>,
  nextChannels: ReadonlyArray<DogfoodChannelView>
): ReadonlyArray<DogfoodChannelView> => {
  const byId = new Map<Id<"channels">, DogfoodChannelView>()
  channels.forEach((channel) => byId.set(channel.id, channel))
  nextChannels.forEach((channel) => byId.set(channel.id, channel))
  return Array.from(byId.values())
}
