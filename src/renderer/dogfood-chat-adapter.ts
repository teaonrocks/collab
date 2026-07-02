import type { Id } from "../../convex/_generated/dataModel"
import type {
  ChatDataView,
  ChatMessageAttachment
} from "./chat-data"

export type DogfoodChannelView = {
  readonly id: Id<"channels">
  readonly key: string
  readonly name: string
  readonly visibility: "public" | "private"
  readonly createdAt: number
}

export type DogfoodWorkspaceView = {
  readonly currentUser: {
    readonly id: Id<"users">
    readonly displayName: string
  }
  readonly workspace: {
    readonly id: Id<"workspaces">
    readonly name: string
  }
  readonly channel: {
    readonly id: Id<"channels">
    readonly name: string
    readonly visibility: "public" | "private"
  }
}

export type DogfoodChannelMessageView = {
  readonly id: Id<"messages">
  readonly channelId: Id<"channels">
  readonly authorUserId: Id<"users">
  readonly authorDisplayName: string
  readonly body: string
  readonly parentMessageId?: Id<"messages"> | null
  readonly parentMessage?: {
    readonly id: Id<"messages">
    readonly authorDisplayName: string
    readonly bodyPreview: string
    readonly deleted: boolean
  } | null
  readonly createdAt: number
  readonly editedAt?: number | null
  readonly reactions?: ReadonlyArray<{
    readonly emoji: string
    readonly count: number
    readonly reactedByCurrentUser: boolean
  }>
  readonly attachments?: ReadonlyArray<DogfoodMessageAttachmentView>
}

export type DogfoodMessageAttachmentView = {
  readonly storageId: Id<"_storage">
  readonly name: string
  readonly contentType: string
  readonly size: number
  readonly kind: "file" | "image"
  readonly url: string | null
}

export type DogfoodChannelMemberView = {
  readonly id: Id<"users">
  readonly displayName: string
  readonly joinedAt: number
}

type DogfoodChatAdapterInput = {
  readonly workspace: DogfoodWorkspaceView
  readonly channels: ReadonlyArray<DogfoodChannelView>
  readonly selectedChannelId: Id<"channels">
  readonly messages: ReadonlyArray<DogfoodChannelMessageView>
  readonly members?: ReadonlyArray<DogfoodChannelMemberView>
  readonly channelIndicators?: ReadonlyArray<{
    readonly channelId: Id<"channels">
    readonly indicator: "unread" | "mentioned"
  }>
  readonly messagesLoading?: boolean
  readonly messagesHasMore?: boolean
  readonly messagesLoadingMore?: boolean
  readonly membersLoading?: boolean
  readonly createChannel?: (input: { readonly name: string; readonly visibility?: "public" | "private" }) => Promise<DogfoodChannelView>
  readonly selectChannel?: (channelId: Id<"channels">) => void
  readonly sendMessage: (input: {
    readonly channelId: Id<"channels">
    readonly body: string
    readonly parentMessageId?: Id<"messages">
    readonly attachments?: Array<{ readonly storageId: Id<"_storage">; readonly name: string }>
  }) => Promise<unknown>
  readonly uploadMessageAttachment?: (file: File) => Promise<ChatMessageAttachment>
  readonly discardMessageAttachment?: (attachment: ChatMessageAttachment) => Promise<unknown>
  readonly resolveStorageId?: (storageId: string) => Id<"_storage">
  readonly editMessage: (input: {
    readonly channelId: Id<"channels">
    readonly messageId: Id<"messages">
    readonly body: string
  }) => Promise<unknown>
  readonly deleteMessage: (input: {
    readonly channelId: Id<"channels">
    readonly messageId: Id<"messages">
  }) => Promise<unknown>
  readonly toggleMessageReaction?: (input: {
    readonly channelId: Id<"channels">
    readonly messageId: Id<"messages">
    readonly emoji: string
  }) => Promise<unknown>
  readonly loadOlderMessages?: () => void
  readonly operationErrorMessage?: ChatDataView["operationErrorMessage"]
}

export const dogfoodChatToChatData = (input: DogfoodChatAdapterInput): ChatDataView => {
  const selectedChannel =
    input.channels.find((channel) => channel.id === input.selectedChannelId) ??
    input.channels.find((channel) => channel.id === input.workspace.channel.id) ??
    input.workspace.channel
  const channelIds = new Map(input.channels.map((channel) => [String(channel.id), channel.id]))
  channelIds.set(String(input.workspace.channel.id), input.workspace.channel.id)
  const messageIds = new Map< string, Id<"messages"> >()
  const storageIds = new Map<string, Id<"_storage">>()
  input.messages.forEach((message) => {
    messageIds.set(String(message.id), message.id)
    if (message.parentMessageId != null) messageIds.set(String(message.parentMessageId), message.parentMessageId)
    if (message.parentMessage != null) messageIds.set(String(message.parentMessage.id), message.parentMessage.id)
    message.attachments?.forEach((attachment) => storageIds.set(String(attachment.storageId), attachment.storageId))
  })
  const resolveChannelId = (id: string) => requiredId(channelIds, id, "channel")
  const resolveMessageId = (id: string) => requiredId(messageIds, id, "message")
  const resolveStorageId = (id: string) =>
    storageIds.get(id) ?? input.resolveStorageId?.(id) ?? requiredId(storageIds, id, "attachment storage")

  return {
    model: {
      currentUser: {
        id: String(input.workspace.currentUser.id),
        displayName: input.workspace.currentUser.displayName
      },
      workspace: { name: input.workspace.workspace.name },
      channel: toChatChannel(selectedChannel),
      channels: input.channels.map(toChatChannel),
      channelMessages: input.messages.map((message) => ({
        id: String(message.id),
        channelId: String(message.channelId),
        authorType: "human" as const,
        authorId: String(message.authorUserId),
        authorDisplayName: message.authorDisplayName,
        body: message.body,
        createdAt: message.createdAt,
        editedAt: message.editedAt ?? null,
        deletedAt: null,
        parentMessageId: message.parentMessageId == null ? null : String(message.parentMessageId),
        parentMessage: message.parentMessage == null ? null : {
          id: String(message.parentMessage.id),
          authorDisplayName: message.parentMessage.authorDisplayName,
          bodyPreview: message.parentMessage.bodyPreview,
          deleted: message.parentMessage.deleted
        },
        reactions: message.reactions ?? [],
        attachments: (message.attachments ?? []).map(toChatAttachment)
      })),
      channelMembers: input.members?.map((member) => ({
        id: String(member.id),
        displayName: member.displayName
      })),
      channelIndicators: input.channelIndicators?.map((state) => ({
        channelId: String(state.channelId),
        indicator: state.indicator
      })),
      channelMembersLoading: input.membersLoading ?? false,
      channelMessagesLoading: input.messagesLoading ?? false,
      channelMessagesHasMore: input.messagesHasMore ?? false,
      channelMessagesLoadingMore: input.messagesLoadingMore ?? false
    },
    createChannel: input.createChannel === undefined
      ? undefined
      : async ({ name, visibility }) => toChatChannel(await input.createChannel!({ name, visibility })),
    selectChannel: input.selectChannel === undefined
      ? undefined
      : (channelId) => input.selectChannel?.(resolveChannelId(channelId)),
    createChannelMessage: ({ channelId, body, parentMessageId, attachments }) => input.sendMessage({
      channelId: resolveChannelId(channelId),
      body,
      parentMessageId: parentMessageId == null ? undefined : resolveMessageId(parentMessageId),
      attachments: attachments?.map((attachment) => ({
        storageId: resolveStorageId(attachment.storageId),
        name: attachment.name
      }))
    }),
    uploadMessageAttachment: input.uploadMessageAttachment,
    discardMessageAttachment: input.discardMessageAttachment,
    editChannelMessage: ({ channelId, messageId, body }) => input.editMessage({
      channelId: resolveChannelId(channelId),
      messageId: resolveMessageId(messageId),
      body
    }),
    deleteChannelMessage: ({ channelId, messageId }) => input.deleteMessage({
      channelId: resolveChannelId(channelId),
      messageId: resolveMessageId(messageId)
    }),
    toggleMessageReaction: input.toggleMessageReaction === undefined
      ? undefined
      : ({ channelId, messageId, emoji }) => input.toggleMessageReaction!({
        channelId: resolveChannelId(channelId),
        messageId: resolveMessageId(messageId),
        emoji
      }),
    loadOlderChannelMessages: input.loadOlderMessages,
    operationErrorMessage: input.operationErrorMessage,
    canEditMessage: (message) => message.authorId === String(input.workspace.currentUser.id),
    canDeleteMessage: (message) => message.authorId === String(input.workspace.currentUser.id)
  }
}

const toChatChannel = (channel: {
  readonly id: Id<"channels">
  readonly name: string
  readonly visibility: "public" | "private"
}) => ({
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

const requiredId = <IdType extends string>(ids: ReadonlyMap<string, IdType>, id: string, domain: string): IdType => {
  const resolved = ids.get(id)
  if (resolved === undefined) throw new Error(`Unknown ${domain} id`)
  return resolved
}
