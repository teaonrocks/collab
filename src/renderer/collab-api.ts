import type { RpcClientError } from "@effect/rpc/RpcClientError"
import { Context, type Effect, type Stream } from "effect"
import type {
  AgentId,
  AgentRunStartResult,
  ChannelAgentEnablement,
  ChannelId,
  ChannelMessage,
  ChannelMessageAttachment,
  ChannelMessageId,
  CollabError,
  CollabNotFound,
  CollabPolicyDenied,
  CollabSnapshot,
  Thread,
  ThreadId,
  WorkspaceAgent
} from "../shared/collab-rpc"

export class CollabApi extends Context.Tag("renderer/CollabApi")<
  CollabApi,
  {
    readonly snapshot: () => Effect.Effect<CollabSnapshot, CollabError | RpcClientError>
    readonly registerAgent: (input: {
      readonly displayName: string
      readonly description: string
      readonly providerName: string
      readonly declaredCapabilities: ReadonlyArray<string>
      readonly grantedCapabilities: ReadonlyArray<string>
    }) => Effect.Effect<WorkspaceAgent, CollabPolicyDenied | CollabError | RpcClientError>
    readonly enableAgent: (input: {
      readonly channelId: ChannelId
      readonly agentId: AgentId
      readonly channelGrants: ReadonlyArray<string>
    }) => Effect.Effect<ChannelAgentEnablement, CollabNotFound | CollabPolicyDenied | CollabError | RpcClientError>
    readonly createChannelMessage: (input: {
      readonly channelId: ChannelId
      readonly body: string
      readonly parentMessageId?: ChannelMessageId | null
      readonly attachments?: ReadonlyArray<ChannelMessageAttachment>
    }) => Effect.Effect<ChannelMessage, CollabNotFound | CollabPolicyDenied | CollabError | RpcClientError>
    readonly deleteChannelMessage: (input: {
      readonly channelId: ChannelId
      readonly messageId: ChannelMessageId
    }) => Effect.Effect<ChannelMessage, CollabNotFound | CollabPolicyDenied | CollabError | RpcClientError>
    readonly createDraftThread: (input: {
      readonly channelId: ChannelId
      readonly agentId: AgentId
      readonly selectedMessageIds: ReadonlyArray<ChannelMessageId>
      readonly prompt: string
    }) => Effect.Effect<Thread, CollabNotFound | CollabPolicyDenied | CollabError | RpcClientError>
    readonly startRun: (threadId: ThreadId) => Effect.Effect<AgentRunStartResult, CollabNotFound | CollabPolicyDenied | CollabError | RpcClientError>
    readonly changes: () => Stream.Stream<CollabSnapshot, RpcClientError>
  }
>() {}
