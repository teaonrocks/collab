import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { api } from "../../convex/_generated/api"
import type { Id, TableNames } from "../../convex/_generated/dataModel"
import type {
  ChatDataView,
  ChatMessageAttachment
} from "./chat-data"

export type DogfoodWorkspaceView = NonNullable<FunctionReturnType<typeof api.chat.defaultWorkspace>>
export type DogfoodChannelView = FunctionReturnType<typeof api.chat.channels>[number]
export type DogfoodChannelMessageView = FunctionReturnType<typeof api.chat.channelMessages>["page"][number]
export type DogfoodMessageAttachmentView = DogfoodChannelMessageView["attachments"][number]
export type DogfoodChannelMemberView = FunctionReturnType<typeof api.chat.channelMembers>[number]
export type DogfoodPrivateChannelInviteCandidateView = FunctionReturnType<typeof api.chat.eligiblePrivateChannelMembers>[number]
export type DogfoodChannelIndicatorView = FunctionReturnType<typeof api.chat.channelIndicators>[number]
export type DogfoodDirectConversationView = FunctionReturnType<typeof api.direct_conversations.list>[number]
export type DogfoodDirectConversationCandidateView = FunctionReturnType<typeof api.direct_conversations.candidates>[number]
export type DogfoodNotificationPreferenceView = FunctionReturnType<typeof api.notification_preferences.preference>

export type DogfoodActiveConversation =
  | { readonly kind: "channel"; readonly id: Id<"channels"> }
  | { readonly kind: "direct"; readonly id: Id<"channels"> }

export type DogfoodChatAdapterInput = {
  readonly data: {
    readonly workspace: DogfoodWorkspaceView
    readonly channels: ReadonlyArray<DogfoodChannelView>
    readonly directConversations?: ReadonlyArray<DogfoodDirectConversationView>
    readonly directConversationCandidates?: ReadonlyArray<DogfoodDirectConversationCandidateView>
    readonly directMessageProfile?: FunctionReturnType<typeof api.social.profile>
    readonly incomingFriendRequests?: FunctionReturnType<typeof api.social.incomingFriendRequests>
    readonly selectedConversation?: DogfoodActiveConversation
    /** Compatibility for plain adapter callers that have not selected a DM. */
    readonly selectedChannelId?: Id<"channels">
    readonly messages: ReadonlyArray<DogfoodChannelMessageView>
    readonly members?: ReadonlyArray<DogfoodChannelMemberView>
    readonly channelMemberInviteCandidates?: ReadonlyArray<DogfoodPrivateChannelInviteCandidateView>
    readonly createChannelInviteCandidates?: ReadonlyArray<DogfoodPrivateChannelInviteCandidateView>
    readonly channelIndicators?: ReadonlyArray<DogfoodChannelIndicatorView>
    readonly notificationPreference?: DogfoodNotificationPreferenceView
  }
  readonly state?: {
    readonly messagesLoading?: boolean
    readonly messagesHasMore?: boolean
    readonly messagesLoadingMore?: boolean
    readonly membersLoading?: boolean
    readonly directConversationsLoading?: boolean
  }
  readonly commands: {
    readonly createChannel?: (
      input: FunctionArgs<typeof api.chat.createChannel>
    ) => Promise<FunctionReturnType<typeof api.chat.createChannel>>
    readonly editChannel?: (input: FunctionArgs<typeof api.chat.editChannel>) => Promise<FunctionReturnType<typeof api.chat.editChannel>>
    readonly deleteChannel?: (input: FunctionArgs<typeof api.chat.deleteChannel>) => Promise<unknown>
    readonly selectChannel?: (channelId: Id<"channels">) => void
    readonly selectDirectConversation?: (conversationId: Id<"channels">) => void
    readonly startDirectConversation?: (recipientUserId: Id<"users">) => Promise<DogfoodDirectConversationView>
    readonly searchDirectConversationCandidates?: (query: string) => Promise<FunctionReturnType<typeof api.social.searchUsers>>
    readonly sendFriendRequest?: (input: FunctionArgs<typeof api.social.sendFriendRequest>) => Promise<unknown>
    readonly updateDirectMessageProfile?: (input: FunctionArgs<typeof api.social.updateProfile>) => Promise<FunctionReturnType<typeof api.social.updateProfile>>
    readonly respondToFriendRequest?: (input: FunctionArgs<typeof api.social.respondToFriendRequest>) => Promise<unknown>
    readonly addChannelMember?: (
      input: FunctionArgs<typeof api.chat.addPrivateChannelMember>
    ) => Promise<unknown>
    readonly removeChannelMember?: (
      input: FunctionArgs<typeof api.chat.removePrivateChannelMember>
    ) => Promise<unknown>
    readonly sendMessage: (input: FunctionArgs<typeof api.chat.sendMessage>) => Promise<unknown>
    readonly uploadMessageAttachment?: (file: File) => Promise<ChatMessageAttachment>
    readonly discardMessageAttachment?: (
      input: FunctionArgs<typeof api.chat.deleteAttachmentUpload>
    ) => Promise<unknown>
    readonly editMessage: (input: FunctionArgs<typeof api.chat.editMessage>) => Promise<unknown>
    readonly deleteMessage: (input: FunctionArgs<typeof api.chat.deleteMessage>) => Promise<unknown>
    readonly toggleMessageReaction?: (
      input: FunctionArgs<typeof api.chat.toggleMessageReaction>
    ) => Promise<unknown>
    readonly searchMessages?: (
      input: FunctionArgs<typeof api.chat.searchChannelMessages>
    ) => Promise<FunctionReturnType<typeof api.chat.searchChannelMessages>>
    readonly loadOlderMessages?: () => void
    readonly operationErrorMessage?: ChatDataView["operationErrorMessage"]
    readonly updateNotificationPreference?: (
      input: FunctionArgs<typeof api.notification_preferences.updatePreference>
    ) => Promise<FunctionReturnType<typeof api.notification_preferences.updatePreference>>
  }
}

export const dogfoodChatToChatData = ({ data, state, commands }: DogfoodChatAdapterInput): ChatDataView => {
  const requestedConversation = data.selectedConversation ?? {
    kind: "channel" as const,
    id: data.selectedChannelId ?? data.workspace.channel.id
  }
  const selectedDirectConversation = requestedConversation.kind === "direct"
    ? data.directConversations?.find((conversation) => conversation.id === requestedConversation.id)
    : undefined
  const selectedChannel =
    (requestedConversation.kind === "channel"
      ? data.channels.find((channel) => channel.id === requestedConversation.id)
      : undefined) ??
    data.channels.find((channel) => channel.id === data.workspace.channel.id) ??
    data.workspace.channel
  const activeConversation = selectedDirectConversation === undefined
    ? { kind: "channel" as const, channel: toChatChannel(selectedChannel) }
    : { kind: "direct" as const, directConversation: toChatDirectConversation(selectedDirectConversation) }
  const directActive = activeConversation.kind === "direct"

  return {
    model: {
      currentUser: {
        id: String(data.workspace.currentUser.id),
        displayName: data.workspace.currentUser.displayName
      },
      workspace: { name: data.workspace.workspace.name },
      channel: toChatChannel(selectedChannel),
      activeConversation,
      channels: data.channels.map(toChatChannel),
      directConversations: data.directConversations?.map(toChatDirectConversation) ?? [],
      directConversationCandidates: data.directConversationCandidates?.map((candidate) => ({
        id: String(candidate.id),
        displayName: candidate.displayName,
        username: candidate.username,
        canStartDirectMessage: candidate.canStartDirectMessage
      })),
      directConversationsLoading: state?.directConversationsLoading ?? data.directConversations === undefined,
      directMessageProfile: data.directMessageProfile === undefined ? undefined : {
        username: data.directMessageProfile.username,
        directMessagePreference: data.directMessageProfile.directMessagePreference
      },
      incomingFriendRequests: data.incomingFriendRequests?.map((request) => ({
        id: String(request.id),
        requester: { id: String(request.requester.id), displayName: request.requester.displayName, username: request.requester.username }
      })),
      channelMessages: data.messages.map(toChatMessage),
      channelMembers: directActive ? undefined : data.members?.map((member) => ({
        id: String(member.id),
        displayName: member.displayName,
        role: member.role
      })),
      channelMemberInviteCandidates: directActive ? undefined : data.channelMemberInviteCandidates?.map((member) => ({
        id: String(member.id),
        displayName: member.displayName
      })),
      createChannelInviteCandidates: data.createChannelInviteCandidates?.map((member) => ({
        id: String(member.id),
        displayName: member.displayName
      })),
      channelIndicators: data.channelIndicators?.map((indicator) => ({
        channelId: String(indicator.channelId),
        indicator: indicator.indicator
      })),
      notificationPreference: data.notificationPreference,
      channelMembersLoading: state?.membersLoading ?? false,
      channelMessagesLoading: state?.messagesLoading ?? false,
      channelMessagesHasMore: state?.messagesHasMore ?? false,
      channelMessagesLoadingMore: state?.messagesLoadingMore ?? false
    },
    createChannel: commands.createChannel === undefined
      ? undefined
      : async ({ initialMemberIds, ...input }) => toChatChannel(await commands.createChannel!({
          ...input,
          ...(initialMemberIds === undefined
            ? {}
            : { initialMemberIds: initialMemberIds.map((userId) => convexId<"users">(userId)) })
        })),
    editChannel: directActive || commands.editChannel === undefined
      ? undefined
      : async ({ channelId, name }) => toChatChannel(await commands.editChannel!({
          channelId: convexId<"channels">(channelId),
          name
        })),
    deleteChannel: directActive || commands.deleteChannel === undefined
      ? undefined
      : ({ channelId }) => commands.deleteChannel!({ channelId: convexId<"channels">(channelId) }),
    selectChannel: commands.selectChannel === undefined
      ? undefined
      : (channelId) => commands.selectChannel?.(convexId<"channels">(channelId)),
    selectDirectConversation: commands.selectDirectConversation === undefined
      ? undefined
      : (conversationId) => commands.selectDirectConversation?.(convexId<"channels">(conversationId)),
    startDirectConversation: commands.startDirectConversation === undefined
      ? undefined
      : async (recipientUserId) => toChatDirectConversation(await commands.startDirectConversation!(convexId<"users">(recipientUserId))),
    searchDirectConversationCandidates: commands.searchDirectConversationCandidates === undefined
      ? undefined
      : async (query) => (await commands.searchDirectConversationCandidates!(query)).map((candidate) => ({
          id: String(candidate.id),
          displayName: candidate.displayName,
          username: candidate.username,
          canStartDirectMessage: candidate.canStartDirectMessage,
          friendship: candidate.friendship,
          friendRequestDirection: candidate.friendRequestDirection
        })),
    sendFriendRequest: commands.sendFriendRequest === undefined
      ? undefined
      : (recipientUserId) => commands.sendFriendRequest!({ recipientUserId: convexId<"users">(recipientUserId) }),
    updateDirectMessageProfile: commands.updateDirectMessageProfile === undefined
      ? undefined
      : async (input) => {
          const profile = await commands.updateDirectMessageProfile!({
            username: input.username ?? undefined,
            directMessagePreference: input.directMessagePreference
          })
          return { username: profile.username, directMessagePreference: profile.directMessagePreference }
        },
    respondToFriendRequest: commands.respondToFriendRequest === undefined
      ? undefined
      : ({ friendRequestId, accept }) => commands.respondToFriendRequest!({ friendRequestId: convexId<"friendRequests">(friendRequestId), accept }),
    updateNotificationPreference: commands.updateNotificationPreference === undefined
      ? undefined
      : async ({ channelId, mode }) => commands.updateNotificationPreference!({
          channelId: convexId<"channels">(channelId),
          mode
        }),
    addChannelMember: directActive || commands.addChannelMember === undefined
      ? undefined
      : ({ channelId, userId }) => commands.addChannelMember!({
          channelId: convexId<"channels">(channelId),
          userId: convexId<"users">(userId)
        }),
    removeChannelMember: directActive || commands.removeChannelMember === undefined
      ? undefined
      : ({ channelId, userId }) => commands.removeChannelMember!({
          channelId: convexId<"channels">(channelId),
          userId: convexId<"users">(userId)
        }),
    createChannelMessage: ({ channelId, body, parentMessageId, attachments }) => commands.sendMessage({
      channelId: convexId<"channels">(channelId),
      body,
      parentMessageId: parentMessageId == null ? undefined : convexId<"messages">(parentMessageId),
      attachments: attachments?.map((attachment) => ({
        storageId: convexId<"_storage">(attachment.storageId),
        name: attachment.name
      }))
    }),
    uploadMessageAttachment: commands.uploadMessageAttachment,
    discardMessageAttachment: commands.discardMessageAttachment === undefined
      ? undefined
      : (attachment) => commands.discardMessageAttachment!({
        storageId: convexId<"_storage">(attachment.storageId)
      }),
    editChannelMessage: ({ channelId, messageId, body }) => commands.editMessage({
      channelId: convexId<"channels">(channelId),
      messageId: convexId<"messages">(messageId),
      body
    }),
    deleteChannelMessage: ({ channelId, messageId }) => commands.deleteMessage({
      channelId: convexId<"channels">(channelId),
      messageId: convexId<"messages">(messageId)
    }),
    toggleMessageReaction: commands.toggleMessageReaction === undefined
      ? undefined
      : ({ channelId, messageId, emoji }) => commands.toggleMessageReaction!({
        channelId: convexId<"channels">(channelId),
        messageId: convexId<"messages">(messageId),
        emoji: toReactionEmoji(emoji)
      }),
    searchChannelMessages: commands.searchMessages === undefined
      ? undefined
      : async ({ channelId, query }) => (await commands.searchMessages!({
          channelId: convexId<"channels">(channelId),
          query
        })).map(toChatMessage),
    loadOlderChannelMessages: commands.loadOlderMessages,
    operationErrorMessage: commands.operationErrorMessage,
    canEditMessage: (message) => message.authorId === String(data.workspace.currentUser.id),
    canDeleteMessage: (message) => message.authorId === String(data.workspace.currentUser.id)
  }
}

const convexId = <TableName extends TableNames | "_storage">(id: string): Id<TableName> => id as Id<TableName>

const toReactionEmoji = (
  emoji: string
): FunctionArgs<typeof api.chat.toggleMessageReaction>["emoji"] => {
  switch (emoji) {
    case "👍":
    case "🎉":
    case "👀":
      return emoji
    default:
      throw new Error("Unsupported reaction emoji")
  }
}

const toChatChannel = (channel: Pick<DogfoodChannelView, "id" | "name" | "visibility">) => ({
  id: String(channel.id),
  name: channel.name,
  visibility: channel.visibility
})

const toChatDirectConversation = (conversation: DogfoodDirectConversationView) => ({
  id: String(conversation.id),
  otherUser: {
    id: String(conversation.otherUser.id),
    displayName: conversation.otherUser.displayName
  }
})

const toChatAttachment = (attachment: DogfoodMessageAttachmentView): ChatMessageAttachment => ({
  id: String(attachment.storageId),
  storageId: String(attachment.storageId),
  name: attachment.name,
  contentType: attachment.contentType,
  size: attachment.size,
  kind: attachment.kind,
  url: attachment.url
})

const toChatMessage = (message: DogfoodChannelMessageView) => ({
  id: String(message.id),
  channelId: String(message.channelId),
  authorType: "human" as const,
  authorId: String(message.authorUserId),
  authorDisplayName: message.authorDisplayName,
  body: message.body,
  createdAt: message.createdAt,
  editedAt: message.editedAt,
  deletedAt: null,
  parentMessageId: message.parentMessageId === null ? null : String(message.parentMessageId),
  parentMessage: message.parentMessage === null ? null : {
    id: String(message.parentMessage.id),
    authorDisplayName: message.parentMessage.authorDisplayName,
    bodyPreview: message.parentMessage.bodyPreview,
    deleted: message.parentMessage.deleted
  },
  reactions: message.reactions,
  attachments: message.attachments.map(toChatAttachment)
})
