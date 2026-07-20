import type { FunctionArgs, FunctionReturnType } from "convex/server"
import { api } from "../../convex/_generated/api"
import type { Id, TableNames } from "../../convex/_generated/dataModel"
import { isMessageReactionEmoji } from "../shared/reaction-policy"
import type { ChatDataView, ChatMessageAttachment } from "./chat-data"

export type DogfoodWorkspaceView = NonNullable<FunctionReturnType<typeof api.chat.defaultWorkspace>>
export type DogfoodChannelView = FunctionReturnType<typeof api.chat.channels>[number]
export type DogfoodChannelMessageView = FunctionReturnType<typeof api.chat.channelMessages>["page"][number]
type DogfoodMessageAttachmentView = DogfoodChannelMessageView["attachments"][number]
export type DogfoodChannelMemberView = FunctionReturnType<typeof api.chat.channelMembers>[number]
export type DogfoodPrivateChannelInviteCandidateView = FunctionReturnType<
  typeof api.chat.eligiblePrivateChannelMembers
>[number]
type DogfoodChannelIndicatorView = FunctionReturnType<typeof api.chat.conversationIndicators>[number]
export type DogfoodDirectConversationView = FunctionReturnType<typeof api.direct_conversations.list>[number]
type DogfoodNotificationPreferenceView = FunctionReturnType<typeof api.notification_preferences.preference>

export type DogfoodActiveConversation =
  { readonly kind: "channel"; readonly id: Id<"channels"> } | { readonly kind: "direct"; readonly id: Id<"channels"> }

export type DogfoodChatAdapterInput = {
  readonly data: {
    readonly workspace: DogfoodWorkspaceView
    readonly channels: ReadonlyArray<DogfoodChannelView>
    readonly directConversations?: ReadonlyArray<DogfoodDirectConversationView>
    readonly directMessageProfile?: FunctionReturnType<typeof api.social.profile>
    readonly incomingFriendRequests?: FunctionReturnType<typeof api.social.incomingFriendRequests>
    readonly selectedConversation: DogfoodActiveConversation
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
    readonly editChannel?: (
      input: FunctionArgs<typeof api.chat.editChannel>
    ) => Promise<FunctionReturnType<typeof api.chat.editChannel>>
    readonly deleteChannel?: (input: FunctionArgs<typeof api.chat.deleteChannel>) => Promise<unknown>
    readonly selectChannel?: (channelId: Id<"channels">) => void
    readonly selectDirectConversation?: (conversationId: Id<"channels">) => void
    readonly startDirectConversation?: (recipientUserId: Id<"users">) => Promise<DogfoodDirectConversationView>
    readonly searchDirectConversationCandidates?: (
      query: string
    ) => Promise<FunctionReturnType<typeof api.social.searchUsers>>
    readonly sendFriendRequest?: (input: FunctionArgs<typeof api.social.sendFriendRequest>) => Promise<unknown>
    readonly updateDirectMessageProfile?: (
      input: FunctionArgs<typeof api.social.updateProfile>
    ) => Promise<FunctionReturnType<typeof api.social.updateProfile>>
    readonly respondToFriendRequest?: (
      input: FunctionArgs<typeof api.social.respondToFriendRequest>
    ) => Promise<unknown>
    readonly addChannelMember?: (input: FunctionArgs<typeof api.chat.addPrivateChannelMember>) => Promise<unknown>
    readonly removeChannelMember?: (input: FunctionArgs<typeof api.chat.removePrivateChannelMember>) => Promise<unknown>
    readonly sendMessage: (input: FunctionArgs<typeof api.chat.sendMessage>) => Promise<unknown>
    readonly uploadMessageAttachment?: (file: File) => Promise<ChatMessageAttachment>
    readonly discardMessageAttachment?: (
      input: FunctionArgs<typeof api.chat.deleteAttachmentUpload>
    ) => Promise<unknown>
    readonly editMessage: (input: FunctionArgs<typeof api.chat.editMessage>) => Promise<unknown>
    readonly deleteMessage: (input: FunctionArgs<typeof api.chat.deleteMessage>) => Promise<unknown>
    readonly toggleMessageReaction?: (input: FunctionArgs<typeof api.chat.toggleMessageReaction>) => Promise<unknown>
    readonly searchMessages?: (
      input: FunctionArgs<typeof api.chat.searchChannelMessages>
    ) => Promise<FunctionReturnType<typeof api.chat.searchChannelMessages>>
    readonly loadOlderMessages?: () => void
    readonly operationErrorMessage?: ChatDataView["messages"]["errorMessage"]
    readonly updateNotificationPreference?: (
      input: FunctionArgs<typeof api.notification_preferences.updatePreference>
    ) => Promise<FunctionReturnType<typeof api.notification_preferences.updatePreference>>
  }
}

export const dogfoodChatToChatData = ({ data, state, commands }: DogfoodChatAdapterInput): ChatDataView => {
  const requestedConversation = data.selectedConversation
  const selectedDirectConversation =
    requestedConversation.kind === "direct"
      ? data.directConversations?.find((conversation) => conversation.id === requestedConversation.id)
      : undefined
  const selectedChannel =
    (requestedConversation.kind === "channel"
      ? data.channels.find((channel) => channel.id === requestedConversation.id)
      : undefined) ??
    data.channels.find((channel) => channel.id === data.workspace.channel.id) ??
    data.workspace.channel
  const activeConversation =
    selectedDirectConversation === undefined
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
      directMessages: {
        conversations:
          state?.directConversationsLoading === true
            ? data.directConversations === undefined
              ? { status: "loading" }
              : { status: "refreshing", data: data.directConversations.map(toChatDirectConversation) }
            : remoteData(data.directConversations, (conversations) => conversations.map(toChatDirectConversation)),
        profile: remoteData(data.directMessageProfile, (profile) => ({
          username: profile.username,
          directMessagePreference: profile.directMessagePreference
        })),
        incomingFriendRequests: remoteData(data.incomingFriendRequests, (requests) =>
          requests.map((request) => ({
            id: String(request.id),
            requester: {
              id: String(request.requester.id),
              displayName: request.requester.displayName,
              username: request.requester.username
            }
          }))
        )
      },
      conversation: {
        messages:
          state?.messagesLoading === true
            ? { status: "loading" }
            : {
                status: "ready",
                data: data.messages.map(toChatMessage),
                hasMore: state?.messagesHasMore ?? false,
                loadingMore: state?.messagesLoadingMore ?? false
              },
        members: directActive
          ? { status: "unavailable" }
          : state?.membersLoading === true
            ? { status: "loading" }
            : remoteData(data.members, (members) =>
                members.map((member) => ({
                  id: String(member.id),
                  displayName: member.displayName,
                  role: member.role
                }))
              ),
        memberInviteCandidates: directActive
          ? { status: "unavailable" }
          : remoteData(data.channelMemberInviteCandidates, (members) =>
              members.map((member) => ({
                id: String(member.id),
                displayName: member.displayName
              }))
            ),
        notificationPreference:
          directActive || data.notificationPreference !== undefined
            ? remoteData(data.notificationPreference, (preference) => preference)
            : { status: "loading" }
      },
      channelCreation: {
        inviteCandidates: remoteData(data.createChannelInviteCandidates, (members) =>
          members.map((member) => ({
            id: String(member.id),
            displayName: member.displayName
          }))
        )
      },
      indicators: remoteData(data.channelIndicators, (indicators) =>
        indicators.map((indicator) => ({
          channelId: String(indicator.channelId),
          indicator: indicator.indicator
        }))
      )
    },
    navigation: {
      ...(commands.selectChannel === undefined
        ? {}
        : { selectChannel: (channelId: string) => commands.selectChannel?.(convexId<"channels">(channelId)) }),
      ...(commands.selectDirectConversation === undefined
        ? {}
        : {
            selectDirectConversation: (conversationId: string) =>
              commands.selectDirectConversation?.(convexId<"channels">(conversationId))
          })
    },
    ...(directActive ? {} : { channels: channelCapabilities(commands) }),
    directMessages: directMessageCapabilities(commands),
    ...(commands.updateNotificationPreference === undefined
      ? {}
      : {
          notifications: {
            updatePreference: async ({ channelId, mode }: { channelId: string; mode: "all" | "mentions" | "off" }) =>
              commands.updateNotificationPreference!({ channelId: convexId<"channels">(channelId), mode })
          }
        }),
    messages: messageCapabilities(data, commands)
  }
}

const remoteData = <Input, Output>(
  value: Input | undefined,
  map: (value: Input) => Output
): { readonly status: "loading" } | { readonly status: "ready"; readonly data: Output } =>
  value === undefined ? { status: "loading" } : { status: "ready", data: map(value) }

const channelCapabilities = (commands: DogfoodChatAdapterInput["commands"]): NonNullable<ChatDataView["channels"]> => ({
  ...(commands.createChannel === undefined
    ? {}
    : {
        create: async ({ initialMemberIds, ...input }) =>
          toChatChannel(
            await commands.createChannel!({
              ...input,
              ...(initialMemberIds === undefined
                ? {}
                : { initialMemberIds: initialMemberIds.map((userId) => convexId<"users">(userId)) })
            })
          )
      }),
  ...(commands.editChannel === undefined
    ? {}
    : {
        edit: async ({ channelId, name }) =>
          toChatChannel(
            await commands.editChannel!({
              channelId: convexId<"channels">(channelId),
              name
            })
          )
      }),
  ...(commands.deleteChannel === undefined
    ? {}
    : { delete: ({ channelId }) => commands.deleteChannel!({ channelId: convexId<"channels">(channelId) }) }),
  ...(commands.addChannelMember === undefined
    ? {}
    : {
        addMember: ({ channelId, userId }) =>
          commands.addChannelMember!({
            channelId: convexId<"channels">(channelId),
            userId: convexId<"users">(userId)
          })
      }),
  ...(commands.removeChannelMember === undefined
    ? {}
    : {
        removeMember: ({ channelId, userId }) =>
          commands.removeChannelMember!({
            channelId: convexId<"channels">(channelId),
            userId: convexId<"users">(userId)
          })
      })
})

const directMessageCapabilities = (
  commands: DogfoodChatAdapterInput["commands"]
): NonNullable<ChatDataView["directMessages"]> => ({
  ...(commands.startDirectConversation === undefined
    ? {}
    : {
        startConversation: async (recipientUserId: string) =>
          toChatDirectConversation(await commands.startDirectConversation!(convexId<"users">(recipientUserId)))
      }),
  ...(commands.searchDirectConversationCandidates === undefined
    ? {}
    : {
        searchCandidates: async (query: string) =>
          (await commands.searchDirectConversationCandidates!(query)).map((candidate) => ({
            id: String(candidate.id),
            displayName: candidate.displayName,
            username: candidate.username,
            canStartDirectMessage: candidate.canStartDirectMessage,
            friendship: candidate.friendship,
            friendRequestDirection: candidate.friendRequestDirection
          }))
      }),
  ...(commands.sendFriendRequest === undefined
    ? {}
    : {
        sendFriendRequest: (recipientUserId: string) =>
          commands.sendFriendRequest!({ recipientUserId: convexId<"users">(recipientUserId) })
      }),
  ...(commands.updateDirectMessageProfile === undefined
    ? {}
    : {
        updateProfile: async (input) => {
          const profile = await commands.updateDirectMessageProfile!({
            ...(input.username === null ? {} : { username: input.username }),
            directMessagePreference: input.directMessagePreference
          })
          return { username: profile.username, directMessagePreference: profile.directMessagePreference }
        }
      }),
  ...(commands.respondToFriendRequest === undefined
    ? {}
    : {
        respondToFriendRequest: ({ friendRequestId, accept }) =>
          commands.respondToFriendRequest!({
            friendRequestId: convexId<"friendRequests">(friendRequestId),
            accept
          })
      })
})

const messageCapabilities = (
  data: DogfoodChatAdapterInput["data"],
  commands: DogfoodChatAdapterInput["commands"]
): ChatDataView["messages"] => ({
  create: ({ channelId, body, parentMessageId, attachments }) =>
    commands.sendMessage({
      channelId: convexId<"channels">(channelId),
      body,
      ...(parentMessageId == null ? {} : { parentMessageId: convexId<"messages">(parentMessageId) }),
      ...(attachments === undefined
        ? {}
        : {
            attachments: attachments.map((attachment) => ({
              storageId: convexId<"_storage">(attachment.storageId),
              name: attachment.name
            }))
          })
    }),
  ...(commands.uploadMessageAttachment === undefined ? {} : { upload: commands.uploadMessageAttachment }),
  ...(commands.discardMessageAttachment === undefined
    ? {}
    : {
        discard: (attachment: ChatMessageAttachment) =>
          commands.discardMessageAttachment!({
            storageId: convexId<"_storage">(attachment.storageId)
          })
      }),
  edit: ({ channelId, messageId, body }) =>
    commands.editMessage({
      channelId: convexId<"channels">(channelId),
      messageId: convexId<"messages">(messageId),
      body
    }),
  delete: ({ channelId, messageId }) =>
    commands.deleteMessage({
      channelId: convexId<"channels">(channelId),
      messageId: convexId<"messages">(messageId)
    }),
  ...(commands.toggleMessageReaction === undefined
    ? {}
    : {
        toggleReaction: ({ channelId, messageId, emoji }) =>
          commands.toggleMessageReaction!({
            channelId: convexId<"channels">(channelId),
            messageId: convexId<"messages">(messageId),
            emoji: toReactionEmoji(emoji)
          })
      }),
  ...(commands.searchMessages === undefined
    ? {}
    : {
        search: async ({ channelId, query }) =>
          (
            await commands.searchMessages!({
              channelId: convexId<"channels">(channelId),
              query
            })
          ).map(toChatMessage)
      }),
  ...(commands.loadOlderMessages === undefined ? {} : { loadOlder: commands.loadOlderMessages }),
  canDeleteMessages: true,
  canEdit: (message) => message.authorId === String(data.workspace.currentUser.id),
  canDelete: (message) => message.authorId === String(data.workspace.currentUser.id),
  ...(commands.operationErrorMessage === undefined ? {} : { errorMessage: commands.operationErrorMessage })
})

const convexId = <TableName extends TableNames | "_storage">(id: string): Id<TableName> => id as Id<TableName>

const toReactionEmoji = (emoji: string): FunctionArgs<typeof api.chat.toggleMessageReaction>["emoji"] => {
  if (!isMessageReactionEmoji(emoji)) throw new Error("Unsupported reaction emoji")
  return emoji
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
  parentMessage:
    message.parentMessage === null
      ? null
      : {
          id: String(message.parentMessage.id),
          authorDisplayName: message.parentMessage.authorDisplayName,
          bodyPreview: message.parentMessage.bodyPreview,
          deleted: message.parentMessage.deleted
        },
  reactions: message.reactions,
  attachments: message.attachments.map(toChatAttachment)
})
