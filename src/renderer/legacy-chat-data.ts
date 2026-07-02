import type { RpcClientError } from "@effect/rpc/RpcClientError"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import {
  ChannelId,
  ChannelMessageId,
  type CollabError,
  type CollabNotFound,
  type CollabPolicyDenied,
  type CollabSnapshot
} from "../shared/collab-rpc"
import { CollabApi } from "./collab-api"
import type { ChatDataModel } from "./chat-data"

type ChatEffectError = CollabNotFound | CollabPolicyDenied | CollabError | RpcClientError

export class LegacyChatData extends Context.Tag("renderer/LegacyChatData")<
  LegacyChatData,
  {
    readonly changes: () => Stream.Stream<ChatDataModel, RpcClientError>
    readonly createChannelMessage: (input: {
      readonly channelId: string
      readonly body: string
      readonly parentMessageId?: string | null
    }) => Effect.Effect<unknown, ChatEffectError>
    readonly deleteChannelMessage: (input: {
      readonly channelId: string
      readonly messageId: string
    }) => Effect.Effect<unknown, ChatEffectError>
  }
>() {}

const decodeChannelId = Schema.decodeUnknownSync(ChannelId)
const decodeMessageId = Schema.decodeUnknownSync(ChannelMessageId)

export const layerLegacyChatDataFromCollabApi: Layer.Layer<LegacyChatData, never, CollabApi> = Layer.effect(
  LegacyChatData,
  Effect.map(CollabApi, (api) =>
    LegacyChatData.of({
      changes: () => api.changes().pipe(Stream.map(toLegacyChatDataModel)),
      createChannelMessage: ({ channelId, body, parentMessageId }) => api.createChannelMessage({
        channelId: decodeChannelId(channelId),
        body,
        parentMessageId: parentMessageId == null ? null : decodeMessageId(parentMessageId)
      }),
      deleteChannelMessage: ({ channelId, messageId }) => api.deleteChannelMessage({
        channelId: decodeChannelId(channelId),
        messageId: decodeMessageId(messageId)
      })
    })
  )
)

export const toLegacyChatDataModel = (snapshot: CollabSnapshot): ChatDataModel => ({
  currentUser: {
    id: snapshot.currentUser.id,
    displayName: snapshot.currentUser.displayName
  },
  workspace: { name: snapshot.workspace.name },
  channel: {
    id: snapshot.channel.id,
    name: snapshot.channel.name,
    visibility: snapshot.channel.visibility
  },
  channels: [{
    id: snapshot.channel.id,
    name: snapshot.channel.name,
    visibility: snapshot.channel.visibility
  }],
  channelMessages: snapshot.channelMessages.map((message) => ({
    id: message.id,
    channelId: message.channelId,
    authorType: message.authorType,
    authorId: message.authorId,
    authorDisplayName: message.authorDisplayName,
    body: message.body,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
    parentMessageId: message.parentMessageId,
    parentMessage: message.parentMessage,
    reactions: message.reactions,
    attachments: message.attachments
  })),
  channelMessagesLoading: false
})
