import { usePaginatedQuery, useQuery } from "convex/react"
import { useMemo } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import type { DogfoodConversationSelection } from "./use-conversation-selection"

export function useDogfoodWorkspaceData(viewerReady: boolean) {
  const workspace = useQuery(api.chat.defaultWorkspace, viewerReady ? {} : "skip")
  const channels = useQuery(
    api.chat.channels,
    workspace === undefined || workspace === null ? "skip" : { workspaceId: workspace.workspace.id }
  )
  const directConversations = useQuery(api.direct_conversations.list, viewerReady ? {} : "skip")
  const directMessageProfile = useQuery(api.social.profile, viewerReady ? {} : "skip")
  const incomingFriendRequests = useQuery(api.social.incomingFriendRequests, viewerReady ? {} : "skip")
  const createChannelInviteCandidates = useQuery(
    api.chat.eligiblePrivateChannelMembers,
    workspace === undefined || workspace === null ? "skip" : {}
  )
  const conversationIndicators = useQuery(
    api.chat.conversationIndicators,
    workspace === undefined || workspace === null ? "skip" : { workspaceId: workspace.workspace.id }
  )

  return {
    workspace,
    channels,
    directConversations,
    directMessageProfile,
    incomingFriendRequests,
    createChannelInviteCandidates,
    conversationIndicators
  }
}

export function useActiveConversationData(
  selection: DogfoodConversationSelection,
  currentUserId: Id<"users"> | undefined
) {
  const { activeChannel, activeChannelId, activeChannelJoined, activeKind } = selection
  const messagePagination = usePaginatedQuery(
    api.chat.channelMessages,
    activeChannelId === undefined || (activeKind === "channel" && !activeChannelJoined)
      ? "skip"
      : { channelId: activeChannelId },
    { initialNumItems: 50 }
  )
  const messages = useMemo(() => [...messagePagination.results].reverse(), [messagePagination.results])
  const members = useQuery(
    api.chat.channelMembers,
    activeKind === "direct" || activeChannelId === undefined || !activeChannelJoined
      ? "skip"
      : { channelId: activeChannelId }
  )
  const currentUserIsPrivateChannelAdmin =
    activeChannel?.visibility === "private" &&
    members?.some((member) => member.id === currentUserId && member.role === "admin") === true
  const channelMemberInviteCandidates = useQuery(
    api.chat.eligiblePrivateChannelMembers,
    activeChannelId === undefined || !currentUserIsPrivateChannelAdmin ? "skip" : { channelId: activeChannelId }
  )
  const notificationPreference = useQuery(
    api.notification_preferences.preference,
    activeChannelId === undefined || (activeKind === "channel" && !activeChannelJoined)
      ? "skip"
      : { channelId: activeChannelId }
  )

  return {
    messages,
    members,
    channelMemberInviteCandidates,
    notificationPreference,
    messagesLoading: messagePagination.status === "LoadingFirstPage",
    messagesHasMore: messagePagination.status === "CanLoadMore" || messagePagination.status === "LoadingMore",
    messagesLoadingMore: messagePagination.status === "LoadingMore",
    loadOlderMessages: () => messagePagination.loadMore(50)
  }
}

export const latestMessageId = (
  messages: ReadonlyArray<{ readonly id: Id<"messages">; readonly createdAt: number }>
): Id<"messages"> | null =>
  messages.reduce<(typeof messages)[number] | null>(
    (latest, message) => (latest === null || message.createdAt > latest.createdAt ? message : latest),
    null
  )?.id ?? null
