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
export type DogfoodChannelIndicatorView = FunctionReturnType<typeof api.chat.channelIndicators>[number]

export type DogfoodChatAdapterInput = {
  readonly data: {
    readonly workspace: DogfoodWorkspaceView
    readonly channels: ReadonlyArray<DogfoodChannelView>
    readonly selectedChannelId: Id<"channels">
    readonly messages: ReadonlyArray<DogfoodChannelMessageView>
    readonly members?: ReadonlyArray<DogfoodChannelMemberView>
    readonly channelIndicators?: ReadonlyArray<DogfoodChannelIndicatorView>
  }
  readonly state?: {
    readonly messagesLoading?: boolean
    readonly messagesHasMore?: boolean
    readonly messagesLoadingMore?: boolean
    readonly membersLoading?: boolean
  }
  readonly commands: {
    readonly createChannel?: (
      input: FunctionArgs<typeof api.chat.createChannel>
    ) => Promise<FunctionReturnType<typeof api.chat.createChannel>>
    readonly selectChannel?: (channelId: Id<"channels">) => void
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
  }
}

export const dogfoodChatToChatData = ({ data, state, commands }: DogfoodChatAdapterInput): ChatDataView => {
  const selectedChannel =
    data.channels.find((channel) => channel.id === data.selectedChannelId) ??
    data.channels.find((channel) => channel.id === data.workspace.channel.id) ??
    data.workspace.channel

  return {
    model: {
      currentUser: {
        id: String(data.workspace.currentUser.id),
        displayName: data.workspace.currentUser.displayName
      },
      workspace: { name: data.workspace.workspace.name },
      channel: toChatChannel(selectedChannel),
      channels: data.channels.map(toChatChannel),
      channelMessages: data.messages.map(toChatMessage),
      channelMembers: data.members?.map((member) => ({
        id: String(member.id),
        displayName: member.displayName
      })),
      channelIndicators: data.channelIndicators?.map((indicator) => ({
        channelId: String(indicator.channelId),
        indicator: indicator.indicator
      })),
      channelMembersLoading: state?.membersLoading ?? false,
      channelMessagesLoading: state?.messagesLoading ?? false,
      channelMessagesHasMore: state?.messagesHasMore ?? false,
      channelMessagesLoadingMore: state?.messagesLoadingMore ?? false
    },
    createChannel: commands.createChannel === undefined
      ? undefined
      : async (input) => toChatChannel(await commands.createChannel!(input)),
    selectChannel: commands.selectChannel === undefined
      ? undefined
      : (channelId) => commands.selectChannel?.(convexId<"channels">(channelId)),
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
