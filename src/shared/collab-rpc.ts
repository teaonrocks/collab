import { Rpc, RpcGroup } from "@effect/rpc"
import { Schema } from "effect"

export const WorkspaceId = Schema.String.pipe(Schema.brand("WorkspaceId"))
export type WorkspaceId = typeof WorkspaceId.Type

export const HumanAccountId = Schema.String.pipe(Schema.brand("HumanAccountId"))
export type HumanAccountId = typeof HumanAccountId.Type

export const ChannelId = Schema.String.pipe(Schema.brand("ChannelId"))
export type ChannelId = typeof ChannelId.Type

export const AgentId = Schema.String.pipe(Schema.brand("AgentId"))
export type AgentId = typeof AgentId.Type

export const ThreadId = Schema.String.pipe(Schema.brand("ThreadId"))
export type ThreadId = typeof ThreadId.Type

export const ChannelMessageId = Schema.String.pipe(Schema.brand("ChannelMessageId"))
export type ChannelMessageId = typeof ChannelMessageId.Type

export const ThreadMessageId = Schema.String.pipe(Schema.brand("ThreadMessageId"))
export type ThreadMessageId = typeof ThreadMessageId.Type

export const AgentRunId = Schema.String.pipe(Schema.brand("AgentRunId"))
export type AgentRunId = typeof AgentRunId.Type

export const AuditEventId = Schema.String.pipe(Schema.brand("AuditEventId"))
export type AuditEventId = typeof AuditEventId.Type

export const ActorType = Schema.Literal("human", "agent", "system")
export type ActorType = typeof ActorType.Type

export const WorkspaceRole = Schema.Literal("owner", "admin", "member", "guest")
export type WorkspaceRole = typeof WorkspaceRole.Type

export const ChannelRole = Schema.Literal("admin", "member", "guest")
export type ChannelRole = typeof ChannelRole.Type

export const AgentStatus = Schema.Literal("active", "disabled")
export type AgentStatus = typeof AgentStatus.Type

export const EnablementStatus = Schema.Literal("enabled", "disabled")
export type EnablementStatus = typeof EnablementStatus.Type

export const ThreadStatus = Schema.Literal("draft", "running", "completed", "failed")
export type ThreadStatus = typeof ThreadStatus.Type

export const RunStatus = Schema.Literal("draft", "queued", "running", "completed", "failed", "cancelled")
export type RunStatus = typeof RunStatus.Type

export const ThreadVisibility = Schema.Literal("private", "channel_members_read_only", "channel_members_interactive")
export type ThreadVisibility = typeof ThreadVisibility.Type

export const MessageKind = Schema.Literal("normal", "selected_context", "agent_output", "system_event")
export type MessageKind = typeof MessageKind.Type

export const ApprovalState = Schema.Literal("not_required", "pending", "approved")
export type ApprovalState = typeof ApprovalState.Type

export const NonEmptyText = Schema.NonEmptyTrimmedString
export type NonEmptyText = typeof NonEmptyText.Type

export class HumanAccount extends Schema.Class<HumanAccount>("HumanAccount")({
  id: HumanAccountId,
  displayName: NonEmptyText,
  email: Schema.String,
  createdAt: Schema.Number
}) {}

export class Workspace extends Schema.Class<Workspace>("Workspace")({
  id: WorkspaceId,
  name: NonEmptyText,
  createdAt: Schema.Number
}) {}

export class Channel extends Schema.Class<Channel>("Channel")({
  id: ChannelId,
  workspaceId: WorkspaceId,
  name: NonEmptyText,
  visibility: Schema.Literal("public", "private"),
  createdBy: HumanAccountId,
  createdAt: Schema.Number
}) {}

export class ChannelMessageReaction extends Schema.Class<ChannelMessageReaction>("ChannelMessageReaction")({
  emoji: NonEmptyText,
  count: Schema.Number,
  reactedByCurrentUser: Schema.Boolean
}) {}

export class ChannelMessage extends Schema.Class<ChannelMessage>("ChannelMessage")({
  id: ChannelMessageId,
  channelId: ChannelId,
  authorType: ActorType,
  authorId: Schema.String,
  authorDisplayName: NonEmptyText,
  body: NonEmptyText,
  createdAt: Schema.Number,
  editedAt: Schema.optionalWith(Schema.NullOr(Schema.Number), { default: () => null }),
  deletedAt: Schema.NullOr(Schema.Number),
  reactions: Schema.optionalWith(Schema.Array(ChannelMessageReaction), { default: () => [] })
}) {}

export class WorkspaceAgent extends Schema.Class<WorkspaceAgent>("WorkspaceAgent")({
  id: AgentId,
  workspaceId: WorkspaceId,
  displayName: NonEmptyText,
  description: Schema.String,
  providerName: NonEmptyText,
  declaredCapabilities: Schema.Array(NonEmptyText),
  grantedCapabilities: Schema.Array(NonEmptyText),
  status: AgentStatus,
  createdBy: HumanAccountId,
  createdAt: Schema.Number
}) {}

export class ChannelAgentEnablement extends Schema.Class<ChannelAgentEnablement>("ChannelAgentEnablement")({
  channelId: ChannelId,
  agentId: AgentId,
  enabledBy: HumanAccountId,
  enabledAt: Schema.Number,
  channelGrants: Schema.Array(NonEmptyText),
  status: EnablementStatus
}) {}

export class Thread extends Schema.Class<Thread>("Thread")({
  id: ThreadId,
  workspaceId: WorkspaceId,
  sourceChannelId: ChannelId,
  ownerId: HumanAccountId,
  agentId: AgentId,
  prompt: NonEmptyText,
  selectedContextMessageIds: Schema.Array(ChannelMessageId),
  visibility: ThreadVisibility,
  status: ThreadStatus,
  createdAt: Schema.Number,
  startedAt: Schema.NullOr(Schema.Number),
  completedAt: Schema.NullOr(Schema.Number)
}) {}

export class MessageProvenance extends Schema.Class<MessageProvenance>("MessageProvenance")({
  agentId: AgentId,
  providerName: NonEmptyText,
  runId: AgentRunId,
  ownerId: HumanAccountId,
  triggerType: Schema.Literal("manual_prompt"),
  approvalState: ApprovalState
}) {}

export class ThreadMessage extends Schema.Class<ThreadMessage>("ThreadMessage")({
  id: ThreadMessageId,
  threadId: ThreadId,
  authorType: ActorType,
  authorId: Schema.String,
  authorDisplayName: NonEmptyText,
  body: NonEmptyText,
  messageKind: MessageKind,
  provenance: Schema.NullOr(MessageProvenance),
  createdAt: Schema.Number,
  deletedAt: Schema.NullOr(Schema.Number)
}) {}

export class AgentRun extends Schema.Class<AgentRun>("AgentRun")({
  id: AgentRunId,
  workspaceId: WorkspaceId,
  threadId: ThreadId,
  sourceChannelId: ChannelId,
  agentId: AgentId,
  activationType: Schema.Literal("manual_prompt"),
  triggeringActorId: HumanAccountId,
  ownerId: HumanAccountId,
  status: RunStatus,
  selectedContextMessageIds: Schema.Array(ChannelMessageId),
  capabilityGrantsSnapshot: Schema.Array(NonEmptyText),
  providerName: NonEmptyText,
  startedAt: Schema.NullOr(Schema.Number),
  completedAt: Schema.NullOr(Schema.Number),
  failedAt: Schema.NullOr(Schema.Number)
}) {}

export class AuditEvent extends Schema.Class<AuditEvent>("AuditEvent")({
  id: AuditEventId,
  workspaceId: WorkspaceId,
  actorType: ActorType,
  actorId: Schema.String,
  eventType: NonEmptyText,
  targetType: NonEmptyText,
  targetId: Schema.String,
  sourceChannelId: Schema.NullOr(ChannelId),
  threadId: Schema.NullOr(ThreadId),
  runId: Schema.NullOr(AgentRunId),
  result: Schema.Literal("allowed", "denied", "succeeded", "failed"),
  detail: Schema.String,
  createdAt: Schema.Number
}) {}

export class CollabSnapshot extends Schema.Class<CollabSnapshot>("CollabSnapshot")({
  currentUser: HumanAccount,
  workspace: Workspace,
  workspaceRole: WorkspaceRole,
  channel: Channel,
  channelRole: ChannelRole,
  channelMessages: Schema.Array(ChannelMessage),
  workspaceAgents: Schema.Array(WorkspaceAgent),
  channelAgentEnablements: Schema.Array(ChannelAgentEnablement),
  threads: Schema.Array(Thread),
  threadMessages: Schema.Array(ThreadMessage),
  agentRuns: Schema.Array(AgentRun),
  auditEvents: Schema.Array(AuditEvent)
}) {}

export class AgentRunStartResult extends Schema.Class<AgentRunStartResult>("AgentRunStartResult")({
  thread: Thread,
  run: AgentRun,
  responseMessage: ThreadMessage
}) {}

export class CollabNotFound extends Schema.TaggedError<CollabNotFound>()("CollabNotFound", {
  entity: Schema.Literal("agent", "channel", "channel_message", "thread", "run"),
  id: Schema.String
}) {}

export class CollabPolicyDenied extends Schema.TaggedError<CollabPolicyDenied>()("CollabPolicyDenied", {
  action: NonEmptyText,
  detail: Schema.String
}) {}

export class CollabError extends Schema.TaggedError<CollabError>()("CollabError", {
  reason: Schema.Literal("ReadFailed", "WriteFailed", "Corrupted"),
  detail: Schema.String
}) {}

export class CollabRpcs extends RpcGroup.make(
  Rpc.make("CollabGetSnapshot", {
    success: CollabSnapshot,
    error: CollabError
  }),
  Rpc.make("WorkspaceAgentRegister", {
    payload: {
      displayName: NonEmptyText,
      description: Schema.String,
      providerName: NonEmptyText,
      declaredCapabilities: Schema.Array(NonEmptyText),
      grantedCapabilities: Schema.Array(NonEmptyText)
    },
    success: WorkspaceAgent,
    error: Schema.Union(CollabPolicyDenied, CollabError)
  }),
  Rpc.make("ChannelAgentEnable", {
    payload: {
      channelId: ChannelId,
      agentId: AgentId,
      channelGrants: Schema.Array(NonEmptyText)
    },
    success: ChannelAgentEnablement,
    error: Schema.Union(CollabNotFound, CollabPolicyDenied, CollabError)
  }),
  Rpc.make("ChannelMessageCreate", {
    payload: {
      channelId: ChannelId,
      body: NonEmptyText
    },
    success: ChannelMessage,
    error: Schema.Union(CollabNotFound, CollabPolicyDenied, CollabError)
  }),
  Rpc.make("ChannelMessageDelete", {
    payload: {
      channelId: ChannelId,
      messageId: ChannelMessageId
    },
    success: ChannelMessage,
    error: Schema.Union(CollabNotFound, CollabPolicyDenied, CollabError)
  }),
  Rpc.make("DraftThreadCreate", {
    payload: {
      channelId: ChannelId,
      agentId: AgentId,
      selectedMessageIds: Schema.Array(ChannelMessageId),
      prompt: NonEmptyText
    },
    success: Thread,
    error: Schema.Union(CollabNotFound, CollabPolicyDenied, CollabError)
  }),
  Rpc.make("AgentRunStart", {
    payload: {
      threadId: ThreadId
    },
    success: AgentRunStartResult,
    error: Schema.Union(CollabNotFound, CollabPolicyDenied, CollabError)
  }),
  Rpc.make("CollabWatch", {
    success: CollabSnapshot,
    stream: true
  })
) {}
