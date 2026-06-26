import type { RpcClientError } from "@effect/rpc/RpcClientError"
import { Context, Effect, Layer, Stream } from "effect"
import type {
  Channel,
  ChannelId,
  ChannelMessage,
  ChannelMessageId,
  CollabError,
  CollabNotFound,
  CollabPolicyDenied,
  CollabSnapshot
} from "../shared/collab-rpc"
import { CollabApi } from "./collab-api"

export type ChatChannelMember = {
  readonly id: string
  readonly displayName: string
}

export type ChatChannelIndicator = "unread" | "mentioned"

export type ChatChannelIndicatorState = {
  readonly channelId: ChannelId
  readonly indicator: ChatChannelIndicator
}

export type ChatDataModel = Pick<CollabSnapshot, "currentUser" | "workspace" | "channel" | "channelMessages"> & {
  readonly channels: ReadonlyArray<Channel>
  readonly channelMembers?: ReadonlyArray<ChatChannelMember>
  readonly channelIndicators?: ReadonlyArray<ChatChannelIndicatorState>
  readonly channelMembersLoading?: boolean
  readonly channelMessagesLoading?: boolean
}

export type CreateChatChannel = (input: {
  readonly name: string
  readonly visibility?: Channel["visibility"]
}) => Promise<Channel>

export type SelectChatChannel = (channelId: ChannelId) => void

export type CreateChatMessage = (input: {
  readonly channelId: ChannelId
  readonly body: string
  readonly parentMessageId?: ChannelMessageId | null
}) => Promise<unknown>

export type EditChatMessage = (input: {
  readonly channelId: ChannelId
  readonly messageId: ChannelMessageId
  readonly body: string
}) => Promise<unknown>

export type DeleteChatMessage = (input: {
  readonly channelId: ChannelId
  readonly messageId: ChannelMessageId
}) => Promise<unknown>

export type ToggleChatMessageReaction = (input: {
  readonly channelId: ChannelId
  readonly messageId: ChannelMessageId
  readonly emoji: string
}) => Promise<unknown>

export type ChatMessageGuard = (message: ChannelMessage) => boolean
export type ChatOperation = "send" | "edit" | "delete" | "react"
export type ChatOperationErrorMessage = (operation: ChatOperation, cause: unknown) => string

export type ChatDataView = {
  readonly model: ChatDataModel
  readonly createChannel?: CreateChatChannel
  readonly selectChannel?: SelectChatChannel
  readonly createChannelMessage: CreateChatMessage
  readonly deleteChannelMessage: DeleteChatMessage
  readonly editChannelMessage?: EditChatMessage
  readonly toggleMessageReaction?: ToggleChatMessageReaction
  readonly canDeleteMessages?: boolean
  readonly canDeleteMessage?: ChatMessageGuard
  readonly canEditMessage?: ChatMessageGuard
  readonly operationErrorMessage?: ChatOperationErrorMessage
}

type ChatEffectError = CollabNotFound | CollabPolicyDenied | CollabError | RpcClientError

export class ChatData extends Context.Tag("renderer/ChatData")<
  ChatData,
  {
    readonly changes: () => Stream.Stream<ChatDataModel, RpcClientError>
    readonly createChannelMessage: (input: {
      readonly channelId: ChannelId
      readonly body: string
      readonly parentMessageId?: ChannelMessageId | null
    }) => Effect.Effect<ChannelMessage, ChatEffectError>
    readonly deleteChannelMessage: (input: {
      readonly channelId: ChannelId
      readonly messageId: ChannelMessageId
    }) => Effect.Effect<ChannelMessage, ChatEffectError>
  }
>() {}

export const layerChatDataFromCollabApi: Layer.Layer<ChatData, never, CollabApi> = Layer.effect(
  ChatData,
  Effect.map(CollabApi, (api) =>
    ChatData.of({
      changes: () => api.changes().pipe(Stream.map(toChatDataModel)),
      createChannelMessage: api.createChannelMessage,
      deleteChannelMessage: api.deleteChannelMessage
    })
  )
)

export const toChatDataModel = (snapshot: CollabSnapshot): ChatDataModel => ({
  currentUser: snapshot.currentUser,
  workspace: snapshot.workspace,
  channel: snapshot.channel,
  channels: [snapshot.channel],
  channelMessages: snapshot.channelMessages,
  channelMessagesLoading: false
})
