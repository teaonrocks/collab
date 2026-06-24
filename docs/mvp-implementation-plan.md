# Agent Collaboration MVP Implementation Plan

## Current App Fit

The existing app already had the right technical spine for this MVP:

- Shared schema-first RPC contracts in `src/shared/`.
- Main-process service/repo boundaries in `src/main/`.
- Renderer-facing API tags plus `effect-atom` state in `src/renderer/`.
- Tests colocated with contract, repo, handlers, atoms, and UI.

The first increment keeps that shape and makes the collaboration domain the active app surface.

## Data Slice

The MVP starts with one seeded workspace, one private channel, one current admin user, and three channel messages.

New persisted entities:

- `Workspace`, `HumanAccount`, `Channel`, and `ChannelMessage`
- `WorkspaceAgent` and `ChannelAgentEnablement`
- `Thread`, `ThreadMessage`, `AgentRun`, and `AuditEvent`
- `MessageProvenance` for agent-authored thread messages

First-pass policy is explicit and conservative:

- Workspace admins can register agents.
- Channel admins can enable agents.
- Channel members/admins can create private draft agent threads.
- Draft creation requires at least one selected channel message.
- Runs can only start from draft threads owned by the current user.

The fake provider is local and synchronous. It creates a completed run and an agent response with linked provenance.

## RPC Slice

`CollabRpcs` covers the first vertical path:

- `CollabGetSnapshot`
- `WorkspaceAgentRegister`
- `ChannelAgentEnable`
- `DraftThreadCreate`
- `AgentRunStart`
- `CollabWatch`

The renderer subscribes to `CollabWatch` for the current collaboration snapshot and calls mutation RPCs through the `CollabApi` service tag.

## UI Slice

The first screen is the working product surface, not a landing page:

- Channel message list with selectable context.
- Agent registration and channel enablement controls.
- Prompt form that creates a private draft thread.
- Thread panel that reviews selected context before `Start Run`.
- Agent response rendering with run/provider/approval provenance.
- Recent run and audit metadata.

## Next Vertical Increments

1. Add a real context review/edit step for draft threads.
2. Split the single snapshot into channel, thread, and audit read models once the domain grows.
3. Add role fixtures for guest/member/admin policy tests.
4. Add failure-path UI for typed RPC errors.
5. Replace the local fake provider with a provider interface while keeping run payload/audit shape stable.
