import { FileSystem } from "@effect/platform"
import type { PlatformError } from "@effect/platform/Error"
import { NodeFileSystem } from "@effect/platform-node"
import { app } from "electron"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { Clock, Effect, Schema, Stream, SubscriptionRef } from "effect"
import type { ParseError } from "effect/ParseResult"
import {
  AgentRun,
  AgentRunStartResult,
  type AgentId,
  AuditEvent,
  type AuditEventId,
  Channel,
  ChannelAgentEnablement,
  type ChannelId,
  ChannelMessage,
  type ChannelMessageId,
  CollabError,
  CollabNotFound,
  CollabPolicyDenied,
  CollabSnapshot,
  HumanAccount,
  type HumanAccountId,
  MessageProvenance,
  Thread,
  type ThreadId,
  ThreadMessage,
  type ThreadMessageId,
  Workspace,
  WorkspaceAgent,
  type WorkspaceId
} from "../shared/collab-rpc"

const CollabFromJson = Schema.parseJson(CollabSnapshot)

const toCollabError = (writeReason: "ReadFailed" | "WriteFailed", error: PlatformError | ParseError): CollabError =>
  error._tag === "ParseError"
    ? new CollabError({ reason: "Corrupted", detail: "The stored collaboration file could not be parsed." })
    : new CollabError({ reason: writeReason, detail: `A filesystem error occurred (${error._tag}).` })

const currentUserId = "human-maya" as HumanAccountId
const workspaceId = "workspace-aether" as WorkspaceId
const channelId = "channel-origination" as ChannelId
const seededAt = 1_735_689_600_000

const seedSnapshot = (): CollabSnapshot =>
  new CollabSnapshot({
    currentUser: new HumanAccount({
      id: currentUserId,
      displayName: "Maya Patel",
      email: "maya@example.test",
      createdAt: seededAt
    }),
    workspace: new Workspace({
      id: workspaceId,
      name: "Aether Labs",
      createdAt: seededAt
    }),
    workspaceRole: "admin",
    channel: new Channel({
      id: channelId,
      workspaceId,
      name: "origination",
      visibility: "private",
      createdBy: currentUserId,
      createdAt: seededAt
    }),
    channelRole: "admin",
    channelMessages: [
      new ChannelMessage({
        id: "channel-message-1" as ChannelMessageId,
        channelId,
        authorType: "human",
        authorId: currentUserId,
        authorDisplayName: "Maya Patel",
        body: "The partner brief needs a concise risk summary before Thursday's review.",
        createdAt: seededAt + 1_000,
        deletedAt: null
      }),
      new ChannelMessage({
        id: "channel-message-2" as ChannelMessageId,
        channelId,
        authorType: "human",
        authorId: "human-lee",
        authorDisplayName: "Lee Chen",
        body: "I pulled the last three incidents into the notes. The repeated theme is unclear ownership during handoff.",
        createdAt: seededAt + 2_000,
        deletedAt: null
      }),
      new ChannelMessage({
        id: "channel-message-3" as ChannelMessageId,
        channelId,
        authorType: "human",
        authorId: "human-rina",
        authorDisplayName: "Rina Shah",
        body: "We should separate launch blockers from follow-up cleanup so the decision is easier to approve.",
        createdAt: seededAt + 3_000,
        deletedAt: null
      })
    ],
    workspaceAgents: [],
    channelAgentEnablements: [],
    threads: [],
    threadMessages: [],
    agentRuns: [],
    auditEvents: []
  })

const isWorkspaceAdmin = (role: CollabSnapshot["workspaceRole"]): boolean => role === "owner" || role === "admin"
const isChannelAdmin = (role: CollabSnapshot["channelRole"]): boolean => role === "admin"
const canPromptAgent = (role: CollabSnapshot["channelRole"]): boolean => role === "admin" || role === "member"
const canPostMessage = (role: CollabSnapshot["channelRole"]): boolean => role === "admin" || role === "member" || role === "guest"

const audit = (
  state: CollabSnapshot,
  options: {
    readonly actorType: "human" | "agent" | "system"
    readonly actorId: string
    readonly eventType: string
    readonly targetType: string
    readonly targetId: string
    readonly sourceChannelId?: ChannelId | null
    readonly threadId?: ThreadId | null
    readonly runId?: AgentRun["id"] | null
    readonly result: "allowed" | "denied" | "succeeded" | "failed"
    readonly detail?: string
    readonly createdAt: number
  }
): AuditEvent =>
  new AuditEvent({
    id: randomUUID() as AuditEventId,
    workspaceId: state.workspace.id,
    actorType: options.actorType,
    actorId: options.actorId,
    eventType: options.eventType,
    targetType: options.targetType,
    targetId: options.targetId,
    sourceChannelId: options.sourceChannelId ?? null,
    threadId: options.threadId ?? null,
    runId: options.runId ?? null,
    result: options.result,
    detail: options.detail ?? "",
    createdAt: options.createdAt
  })

const upsertEnablement = (
  enablements: ReadonlyArray<ChannelAgentEnablement>,
  next: ChannelAgentEnablement
): ReadonlyArray<ChannelAgentEnablement> =>
  enablements.some((enablement) => enablement.channelId === next.channelId && enablement.agentId === next.agentId)
    ? enablements.map((enablement) => enablement.channelId === next.channelId && enablement.agentId === next.agentId ? next : enablement)
    : [...enablements, next]

const fakeAgentResponse = (
  channel: Channel,
  agent: WorkspaceAgent,
  thread: Thread,
  selectedMessages: ReadonlyArray<ChannelMessage>
): string => {
  const names = [...new Set(selectedMessages.map((message) => message.authorDisplayName))].join(", ")
  const contextLine = selectedMessages[0]?.body ?? "No context was selected."
  return `${agent.displayName} reviewed ${selectedMessages.length} message(s) from #${channel.name} by ${names}. Draft response: ${thread.prompt} Priority read: ${contextLine}`
}

export class CollabRepo extends Effect.Service<CollabRepo>()("main/CollabRepo", {
  dependencies: [NodeFileSystem.layer],
  effect: Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const directory = app.getPath("userData")
    const filePath = join(directory, "aether-collab.json")

    const decodeSnapshot = Schema.decode(CollabFromJson)
    const encodeSnapshot = Schema.encode(CollabFromJson)

    const initial = yield* fs.readFileString(filePath).pipe(
      Effect.flatMap(decodeSnapshot),
      Effect.catchIf(
        (error) => error._tag === "SystemError" && error.reason === "NotFound",
        () => Effect.succeed(seedSnapshot())
      ),
      Effect.mapError((error) => toCollabError("ReadFailed", error)),
      Effect.withSpan("CollabRepo.load")
    )

    const ref = yield* SubscriptionRef.make(initial)

    const persist = (snapshot: CollabSnapshot) =>
      Effect.gen(function*() {
        const json = yield* encodeSnapshot(snapshot)
        yield* fs.makeDirectory(directory, { recursive: true })
        yield* fs.writeFileString(filePath, json)
      }).pipe(
        Effect.mapError((error) => toCollabError("WriteFailed", error)),
        Effect.withSpan("CollabRepo.persist")
      )

    const createChannelMessage = Effect.fn("CollabRepo.createChannelMessage")(
      (input: { readonly channelId: ChannelId; readonly body: string }) =>
        SubscriptionRef.modifyEffect(ref, (state) =>
          Effect.gen(function*() {
            if (state.channel.id !== input.channelId) {
              return yield* Effect.fail(new CollabNotFound({ entity: "channel", id: input.channelId }))
            }
            if (!canPostMessage(state.channelRole)) {
              return yield* Effect.fail(new CollabPolicyDenied({
                action: "channel_message.create",
                detail: "This channel role cannot post messages."
              }))
            }

            const createdAt = yield* Clock.currentTimeMillis
            const message = new ChannelMessage({
              id: randomUUID() as ChannelMessageId,
              channelId: input.channelId,
              authorType: "human",
              authorId: state.currentUser.id,
              authorDisplayName: state.currentUser.displayName,
              body: input.body,
              createdAt,
              deletedAt: null
            })
            const next = new CollabSnapshot({
              ...state,
              channelMessages: [...state.channelMessages, message],
              auditEvents: [
                ...state.auditEvents,
                audit(state, {
                  actorType: "human",
                  actorId: state.currentUser.id,
                  eventType: "channel_message.created",
                  targetType: "channel_message",
                  targetId: message.id,
                  sourceChannelId: input.channelId,
                  result: "succeeded",
                  detail: `Message posted in #${state.channel.name}.`,
                  createdAt
                })
              ]
            })
            yield* persist(next)
            return [message, next] as const
          }))
    )

    const deleteChannelMessage = Effect.fn("CollabRepo.deleteChannelMessage")(
      (input: { readonly channelId: ChannelId; readonly messageId: ChannelMessageId }) =>
        SubscriptionRef.modifyEffect(ref, (state) =>
          Effect.gen(function*() {
            if (state.channel.id !== input.channelId) {
              return yield* Effect.fail(new CollabNotFound({ entity: "channel", id: input.channelId }))
            }
            const message = state.channelMessages.find((item) => item.id === input.messageId && item.channelId === input.channelId)
            if (message === undefined || message.deletedAt !== null) {
              return yield* Effect.fail(new CollabNotFound({ entity: "channel_message", id: input.messageId }))
            }
            if (message.authorId !== state.currentUser.id && !isChannelAdmin(state.channelRole)) {
              return yield* Effect.fail(new CollabPolicyDenied({
                action: "channel_message.delete",
                detail: "Only the message author or channel admins can delete this message."
              }))
            }

            const deletedAt = yield* Clock.currentTimeMillis
            const deletedMessage = new ChannelMessage({ ...message, deletedAt })
            const next = new CollabSnapshot({
              ...state,
              channelMessages: state.channelMessages.map((item) => item.id === input.messageId ? deletedMessage : item),
              auditEvents: [
                ...state.auditEvents,
                audit(state, {
                  actorType: "human",
                  actorId: state.currentUser.id,
                  eventType: "channel_message.deleted",
                  targetType: "channel_message",
                  targetId: message.id,
                  sourceChannelId: input.channelId,
                  result: "succeeded",
                  detail: `Message deleted in #${state.channel.name}.`,
                  createdAt: deletedAt
                })
              ]
            })
            yield* persist(next)
            return [deletedMessage, next] as const
          }))
    )

    const registerAgent = Effect.fn("CollabRepo.registerAgent")(
      (input: {
        readonly displayName: string
        readonly description: string
        readonly providerName: string
        readonly declaredCapabilities: ReadonlyArray<string>
        readonly grantedCapabilities: ReadonlyArray<string>
      }) =>
        SubscriptionRef.modifyEffect(ref, (state) =>
          Effect.gen(function*() {
            if (!isWorkspaceAdmin(state.workspaceRole)) {
              return yield* Effect.fail(new CollabPolicyDenied({
                action: "workspace_agent.register",
                detail: "Only workspace admins can register agents."
              }))
            }

            const createdAt = yield* Clock.currentTimeMillis
            const agent = new WorkspaceAgent({
              id: randomUUID() as AgentId,
              workspaceId: state.workspace.id,
              displayName: input.displayName,
              description: input.description,
              providerName: input.providerName,
              declaredCapabilities: input.declaredCapabilities,
              grantedCapabilities: input.grantedCapabilities,
              status: "active",
              createdBy: state.currentUser.id,
              createdAt
            })
            const next = new CollabSnapshot({
              ...state,
              workspaceAgents: [...state.workspaceAgents, agent],
              auditEvents: [
                ...state.auditEvents,
                audit(state, {
                  actorType: "human",
                  actorId: state.currentUser.id,
                  eventType: "workspace_agent.registered",
                  targetType: "workspace_agent",
                  targetId: agent.id,
                  result: "succeeded",
                  detail: `${agent.displayName} registered for ${agent.providerName}.`,
                  createdAt
                })
              ]
            })
            yield* persist(next)
            return [agent, next] as const
          }))
    )

    const enableAgent = Effect.fn("CollabRepo.enableAgent")(
      (input: { readonly channelId: ChannelId; readonly agentId: AgentId; readonly channelGrants: ReadonlyArray<string> }) =>
        SubscriptionRef.modifyEffect(ref, (state) =>
          Effect.gen(function*() {
            if (state.channel.id !== input.channelId) {
              return yield* Effect.fail(new CollabNotFound({ entity: "channel", id: input.channelId }))
            }
            const agent = state.workspaceAgents.find((item) => item.id === input.agentId && item.status === "active")
            if (agent === undefined) {
              return yield* Effect.fail(new CollabNotFound({ entity: "agent", id: input.agentId }))
            }
            if (!isChannelAdmin(state.channelRole)) {
              return yield* Effect.fail(new CollabPolicyDenied({
                action: "channel_agent.enable",
                detail: "Only channel admins can enable agents in a channel."
              }))
            }

            const enabledAt = yield* Clock.currentTimeMillis
            const enablement = new ChannelAgentEnablement({
              channelId: input.channelId,
              agentId: input.agentId,
              enabledBy: state.currentUser.id,
              enabledAt,
              channelGrants: input.channelGrants,
              status: "enabled"
            })
            const next = new CollabSnapshot({
              ...state,
              channelAgentEnablements: upsertEnablement(state.channelAgentEnablements, enablement),
              auditEvents: [
                ...state.auditEvents,
                audit(state, {
                  actorType: "human",
                  actorId: state.currentUser.id,
                  eventType: "channel_agent.enabled",
                  targetType: "channel_agent_enablement",
                  targetId: `${input.channelId}:${input.agentId}`,
                  sourceChannelId: input.channelId,
                  result: "succeeded",
                  detail: `${agent.displayName} enabled in #${state.channel.name}.`,
                  createdAt: enabledAt
                })
              ]
            })
            yield* persist(next)
            return [enablement, next] as const
          }))
    )

    const createDraftThread = Effect.fn("CollabRepo.createDraftThread")(
      (input: {
        readonly channelId: ChannelId
        readonly agentId: AgentId
        readonly selectedMessageIds: ReadonlyArray<ChannelMessageId>
        readonly prompt: string
      }) =>
        SubscriptionRef.modifyEffect(ref, (state) =>
          Effect.gen(function*() {
            if (state.channel.id !== input.channelId) {
              return yield* Effect.fail(new CollabNotFound({ entity: "channel", id: input.channelId }))
            }
            if (!canPromptAgent(state.channelRole)) {
              return yield* Effect.fail(new CollabPolicyDenied({
                action: "agent_run.create_draft",
                detail: "Guests cannot prompt agents in this MVP policy."
              }))
            }
            if (input.selectedMessageIds.length === 0) {
              return yield* Effect.fail(new CollabPolicyDenied({
                action: "context.select",
                detail: "At least one channel message must be selected as run context."
              }))
            }
            const agent = state.workspaceAgents.find((item) => item.id === input.agentId && item.status === "active")
            if (agent === undefined) {
              return yield* Effect.fail(new CollabNotFound({ entity: "agent", id: input.agentId }))
            }
            const enablement = state.channelAgentEnablements.find(
              (item) => item.channelId === input.channelId && item.agentId === input.agentId && item.status === "enabled"
            )
            if (enablement === undefined) {
              return yield* Effect.fail(new CollabPolicyDenied({
                action: "agent_run.create_draft",
                detail: "The selected agent is not enabled in this channel."
              }))
            }

            const selectedMessages = input.selectedMessageIds.map((id) =>
              state.channelMessages.find((message) => message.id === id && message.channelId === input.channelId && message.deletedAt === null)
            )
            const missingMessageId = selectedMessages.findIndex((message) => message === undefined)
            if (missingMessageId >= 0) {
              return yield* Effect.fail(new CollabNotFound({
                entity: "channel_message",
                id: input.selectedMessageIds[missingMessageId]!
              }))
            }

            const createdAt = yield* Clock.currentTimeMillis
            const threadId = randomUUID() as ThreadId
            const thread = new Thread({
              id: threadId,
              workspaceId: state.workspace.id,
              sourceChannelId: input.channelId,
              ownerId: state.currentUser.id,
              agentId: input.agentId,
              prompt: input.prompt,
              selectedContextMessageIds: input.selectedMessageIds,
              visibility: "private",
              status: "draft",
              createdAt,
              startedAt: null,
              completedAt: null
            })
            const contextMessages = (selectedMessages as ReadonlyArray<ChannelMessage>).map((message, index) =>
              new ThreadMessage({
                id: randomUUID() as ThreadMessageId,
                threadId,
                authorType: message.authorType,
                authorId: message.authorId,
                authorDisplayName: message.authorDisplayName,
                body: message.body,
                messageKind: "selected_context",
                provenance: null,
                createdAt: createdAt + index,
                deletedAt: null
              })
            )
            const promptMessage = new ThreadMessage({
              id: randomUUID() as ThreadMessageId,
              threadId,
              authorType: "human",
              authorId: state.currentUser.id,
              authorDisplayName: state.currentUser.displayName,
              body: input.prompt,
              messageKind: "normal",
              provenance: null,
              createdAt: createdAt + selectedMessages.length,
              deletedAt: null
            })
            const next = new CollabSnapshot({
              ...state,
              threads: [...state.threads, thread],
              threadMessages: [...state.threadMessages, ...contextMessages, promptMessage],
              auditEvents: [
                ...state.auditEvents,
                audit(state, {
                  actorType: "human",
                  actorId: state.currentUser.id,
                  eventType: "draft_thread.created",
                  targetType: "thread",
                  targetId: thread.id,
                  sourceChannelId: input.channelId,
                  threadId: thread.id,
                  result: "succeeded",
                  detail: `${input.selectedMessageIds.length} message(s) selected for ${agent.displayName}.`,
                  createdAt
                }),
                audit(state, {
                  actorType: "human",
                  actorId: state.currentUser.id,
                  eventType: "context.selected",
                  targetType: "thread",
                  targetId: thread.id,
                  sourceChannelId: input.channelId,
                  threadId: thread.id,
                  result: "succeeded",
                  detail: "Selected context captured in the draft thread before review.",
                  createdAt: createdAt + 1
                })
              ]
            })
            yield* persist(next)
            return [thread, next] as const
          }))
    )

    const startRun = Effect.fn("CollabRepo.startRun")((threadId: ThreadId) =>
      SubscriptionRef.modifyEffect(ref, (state) =>
        Effect.gen(function*() {
          const thread = state.threads.find((item) => item.id === threadId)
          if (thread === undefined) {
            return yield* Effect.fail(new CollabNotFound({ entity: "thread", id: threadId }))
          }
          if (thread.ownerId !== state.currentUser.id) {
            return yield* Effect.fail(new CollabPolicyDenied({
              action: "agent_run.start",
              detail: "Only the draft owner can start this run."
            }))
          }
          if (thread.status !== "draft") {
            return yield* Effect.fail(new CollabPolicyDenied({
              action: "agent_run.start",
              detail: "Only draft threads can be started."
            }))
          }
          const agent = state.workspaceAgents.find((item) => item.id === thread.agentId)
          if (agent === undefined) {
            return yield* Effect.fail(new CollabNotFound({ entity: "agent", id: thread.agentId }))
          }
          const enablement = state.channelAgentEnablements.find(
            (item) => item.channelId === thread.sourceChannelId && item.agentId === thread.agentId && item.status === "enabled"
          )
          if (enablement === undefined) {
            return yield* Effect.fail(new CollabPolicyDenied({
              action: "agent_run.start",
              detail: "The selected agent is no longer enabled in this channel."
            }))
          }

          const selectedMessages = thread.selectedContextMessageIds.flatMap((id) =>
            state.channelMessages.find((message) => message.id === id && message.deletedAt === null) ?? []
          )
          const startedAt = yield* Clock.currentTimeMillis
          const completedAt = startedAt + 1
          const runId = randomUUID() as AgentRun["id"]
          const run = new AgentRun({
            id: runId,
            workspaceId: state.workspace.id,
            threadId: thread.id,
            sourceChannelId: thread.sourceChannelId,
            agentId: agent.id,
            activationType: "manual_prompt",
            triggeringActorId: state.currentUser.id,
            ownerId: state.currentUser.id,
            status: "completed",
            selectedContextMessageIds: thread.selectedContextMessageIds,
            capabilityGrantsSnapshot: enablement.channelGrants,
            providerName: agent.providerName,
            startedAt,
            completedAt,
            failedAt: null
          })
          const completedThread = new Thread({
            ...thread,
            status: "completed",
            startedAt,
            completedAt
          })
          const responseMessage = new ThreadMessage({
            id: randomUUID() as ThreadMessageId,
            threadId: thread.id,
            authorType: "agent",
            authorId: agent.id,
            authorDisplayName: agent.displayName,
            body: fakeAgentResponse(state.channel, agent, thread, selectedMessages),
            messageKind: "agent_output",
            provenance: new MessageProvenance({
              agentId: agent.id,
              providerName: agent.providerName,
              runId: run.id,
              ownerId: state.currentUser.id,
              triggerType: "manual_prompt",
              approvalState: "not_required"
            }),
            createdAt: completedAt,
            deletedAt: null
          })
          const next = new CollabSnapshot({
            ...state,
            threads: state.threads.map((item) => item.id === thread.id ? completedThread : item),
            threadMessages: [...state.threadMessages, responseMessage],
            agentRuns: [...state.agentRuns, run],
            auditEvents: [
              ...state.auditEvents,
              audit(state, {
                actorType: "human",
                actorId: state.currentUser.id,
                eventType: "context.reviewed",
                targetType: "thread",
                targetId: thread.id,
                sourceChannelId: thread.sourceChannelId,
                threadId: thread.id,
                runId: run.id,
                result: "succeeded",
                detail: "Selected context reviewed before run start.",
                createdAt: startedAt
              }),
              audit(state, {
                actorType: "human",
                actorId: state.currentUser.id,
                eventType: "agent_run.started",
                targetType: "agent_run",
                targetId: run.id,
                sourceChannelId: thread.sourceChannelId,
                threadId: thread.id,
                runId: run.id,
                result: "succeeded",
                detail: `Run payload sent to ${agent.providerName}.`,
                createdAt: startedAt
              }),
              audit(state, {
                actorType: "agent",
                actorId: agent.id,
                eventType: "agent_response.created",
                targetType: "thread_message",
                targetId: responseMessage.id,
                sourceChannelId: thread.sourceChannelId,
                threadId: thread.id,
                runId: run.id,
                result: "succeeded",
                detail: "Local fake provider returned an agent response.",
                createdAt: completedAt
              }),
              audit(state, {
                actorType: "system",
                actorId: "platform",
                eventType: "agent_run.completed",
                targetType: "agent_run",
                targetId: run.id,
                sourceChannelId: thread.sourceChannelId,
                threadId: thread.id,
                runId: run.id,
                result: "succeeded",
                detail: "Run marked completed.",
                createdAt: completedAt + 1
              })
            ]
          })
          yield* persist(next)
          return [new AgentRunStartResult({ thread: completedThread, run, responseMessage }), next] as const
        })))

    return {
      snapshot: SubscriptionRef.get(ref),
      changes: ref.changes.pipe(Stream.drop(0)),
      createChannelMessage,
      deleteChannelMessage,
      registerAgent,
      enableAgent,
      createDraftThread,
      startRun
    } as const
  })
}) {}
