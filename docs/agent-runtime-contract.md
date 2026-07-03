# Agent Runtime Contract

## Status

Accepted architecture direction for COL-21. This document prepares the Convex-backed agent slice;
it does not implement agent persistence, provider execution, or agent UI.

## Decision

Agent state and behavior will be Convex-native. Do not migrate the snapshot-shaped `CollabRpcs`
contract or reconnect the local JSON repository to production.

An explicit `@agent` mention in an ordinary channel message is the initial invocation command. The
server validates the authenticated actor, workspace and channel membership, agent enablement, and
effective grants before it creates a run. Invocation does not require a client-created draft thread
followed by a separate start command. Human replies remain shallow `parentMessageId` links and are
not agent threads.

Convex owns persistence, authorization, indexes, state transitions, timestamps, subscriptions,
scheduling, provider orchestration, and audit records. The renderer consumes a small,
transport-neutral view and command interface through the active-chat seam. Convex documents and
snapshot-era Effect schema classes do not cross that seam.

The historical `@effect/rpc` implementation, MessagePort transport, local JSON repository, and
snapshot renderer were retired by COL-46. Their unique agent/thread/run evidence remains in this
inventory; executable transport fixtures did not protect the accepted Convex-native seam.

## Runtime Shape

The initial deep module should expose one invocation command rather than recreating the old
two-step draft/start interface:

1. A human sends an ordinary channel message containing an explicit enabled-agent mention.
2. A Convex mutation validates identity, membership, channel access, agent enablement, and policy,
   then atomically records the triggering message and a queued run.
3. The mutation schedules an internal action. The action assembles only server-authorized context
   and calls the configured provider.
4. Internal mutations record run transitions, agent-authored output, provenance, and audit events.
5. Convex queries update the active-chat renderer through its existing adapter seam.

Provider credentials, hidden prompts, and authorization material never become message fields or
client-visible run payloads. Provider retries and partial failure handling stay inside the Convex
implementation rather than expanding the renderer interface.

## Existing Contract Inventory And Disposition

Before COL-46 retired it, `src/shared/collab-rpc.ts` defined the following agent, thread, run, and
audit fields. This table is the retained reference material; the Agent Prep milestone owns it, and
its exit condition is implementation of each kept concept in a focused Convex contract or an ADR
that explicitly supersedes the concept.

| Existing object | Existing fields | Disposition |
| --- | --- | --- |
| `WorkspaceAgent` | `id`, `workspaceId`, `displayName`, `description`, `providerName`, `declaredCapabilities`, `grantedCapabilities`, `status`, `createdBy`, `createdAt` | Keep the concept. Store identity, profile, lifecycle, creator, and workspace ownership in Convex. Keep provider configuration and effective grants server-only; expose only renderer-safe summaries. Use Convex document IDs, not `AgentId` casts. |
| `ChannelAgentEnablement` | `channelId`, `agentId`, `enabledBy`, `enabledAt`, `channelGrants`, `status` | Keep as a Convex relationship with indexes for channel and agent lookups. Enforce workspace/channel membership and grant intersection in server functions. |
| `Thread` | `id`, `workspaceId`, `sourceChannelId`, `ownerId`, `agentId`, `prompt`, `selectedContextMessageIds`, `visibility`, `status`, `createdAt`, `startedAt`, `completedAt` | Do not migrate this shape. The initial trigger is an ordinary mentioned message. A later agent conversation container may be introduced only when its participation, visibility, and lifecycle semantics are specified. |
| `MessageProvenance` | `agentId`, `providerName`, `runId`, `ownerId`, `triggerType`, `approvalState` | Keep provenance as Convex-owned data linked to the output message and run. Expose the safe subset required by the UI. Replace the manual-only trigger literal when the first implemented trigger set is finalized. |
| `ThreadMessage` | `id`, `threadId`, `authorType`, `authorId`, `authorDisplayName`, `body`, `messageKind`, `provenance`, `createdAt`, `deletedAt` | Do not create a parallel snapshot-era message store. Agent output belongs in the canonical Convex message model, with agent authorship and provenance modeled explicitly. Human reply fields remain independent. |
| `AgentRun` | `id`, `workspaceId`, `threadId`, `sourceChannelId`, `agentId`, `activationType`, `triggeringActorId`, `ownerId`, `status`, `selectedContextMessageIds`, `capabilityGrantsSnapshot`, `providerName`, `startedAt`, `completedAt`, `failedAt` | Keep the run concept in Convex. Link the initial run to its triggering message and source channel; make a thread reference optional until agent conversations exist. Snapshot effective grants and authorized context server-side. Extend timestamps with queued/cancelled state only when behavior requires them. |
| `AuditEvent` | `id`, `workspaceId`, `actorType`, `actorId`, `eventType`, `targetType`, `targetId`, `sourceChannelId`, `threadId`, `runId`, `result`, `detail`, `createdAt` | Keep audit records in Convex. Use typed target references where practical, retain records independently of visible message deletion, and never put secrets in `detail`. |
| Status/value types | `AgentStatus`, `EnablementStatus`, `ThreadStatus`, `RunStatus`, `ThreadVisibility`, `MessageKind`, `ApprovalState` | Recreate only values required by implemented Convex state machines. Do not copy unused draft/thread literals merely for compatibility. Validate every stored and returned value. |
| RPC errors | `CollabNotFound`, `CollabPolicyDenied`, `CollabError` | Do not reuse Effect error classes at the Convex seam. Preserve their useful semantics with the serializable result contract below. |

The agent-related RPC operations have these dispositions:

| Existing RPC | Disposition |
| --- | --- |
| `WorkspaceAgentRegister` | Replace with an authenticated Convex mutation restricted to workspace admins. |
| `ChannelAgentEnable` | Replace with an authenticated Convex mutation restricted by channel/workspace policy. |
| `DraftThreadCreate` | Retire; the initial invocation flow has no client-created draft thread. |
| `AgentRunStart` | Replace with server-side run creation triggered by the explicit mentioned message. |
| `CollabGetSnapshot` / `CollabWatch` | Do not extend for agents. Use focused Convex queries and subscriptions instead of one aggregate snapshot. |

## Shared Interface

The shared renderer interface should contain only what callers need:

- renderer-safe agent summaries and enablement state;
- renderer-safe run status and provenance linked to canonical messages;
- the explicit invocation outcome needed for optimistic or failure UI; and
- stable error codes for expected command rejection.

Convex-generated function types are authoritative at the backend call seam. The active-chat adapter
maps those results into plain renderer-owned types, following the same pattern as current chat data.
Do not duplicate Convex document shapes in `src/shared`, expose provider payloads, or force the
renderer to understand run orchestration.

## Serializable Expected Errors

Expected command rejection returns a Convex-validated discriminated result:

```ts
type AgentCommandResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | {
      readonly ok: false
      readonly error: {
        readonly code: "not_found" | "policy_denied" | "conflict" | "invalid_input"
        readonly message: string
        readonly retryable: boolean
      }
    }
```

These values must be plain Convex objects: no `Error` instances, prototypes, stacks, causes, or
non-enumerable fields. Argument validators reject structurally invalid input. Unexpected internal
faults may throw after server-side logging, but their details must not be exposed to clients.

Provider failure after a run is accepted is a run-state transition, not a command rejection. The UI
observes the sanitized failure state through its query rather than receiving provider internals.

## Implementation Follow-Ups

The first implementation ticket should add the Convex tables, indexes, validators, authenticated
functions, provider action seam, and `convex-test` coverage together. A schema change must use the
repository's migration process and run `pnpm convex:codegen`.

COL-46 retired the snapshot-era RPC fixture island after confirming it was unreachable from both
production entrypoints. Any future Electron-main responsibility must be introduced by a new
architecture decision and a concrete second adapter; the current production agent path does not
need one.
