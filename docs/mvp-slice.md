# MVP Slice

## Goal

Prove the core agent-first collaboration loop with the smallest useful end-to-end path.

## Demo Scenario

A member in a channel can mention a registered workspace agent, select channel messages as context, create a private draft thread, review context, start an agent run, receive an agent response, and see provenance/audit metadata.

## In Scope

### Workspace And Channel

- One workspace.
- Flat channels.
- Channel membership with `guest`, `member`, and `admin` roles.
- Every thread has a source channel.
- No DMs.

### Agent Registration And Enablement

- Workspace admin registers a workspace-local agent.
- Workspace admin grants requested capabilities.
- Channel admin enables the agent in a channel.
- Agent names are workspace-local.
- No marketplace or shared template layer.

### Manual Agent Run

- Member explicitly mentions or chooses an enabled agent.
- Member selects channel messages as context.
- Platform creates a private draft thread immediately.
- Member reviews selected context before starting.
- Platform sends an explicit run payload only after the start action.
- Agent responds inside the thread.
- Run status is visible.

### Provenance And Audit

- Agent-authored messages show agent identity, provider, linked run, owner or trigger, and approval state.
- Agent run audit events are created for draft creation, context review/start, run start, response, and failures.
- Deleting a visible message does not erase run audit history.

## Stubbed Or Minimal

- Agent provider can be a local fake agent for the first implementation.
- Policy can start as explicit role checks plus simple config.
- Capability grants can be represented as coarse string permissions.
- Integration bindings can be absent or mocked for the first manual-message-context demo.
- Memory can be omitted from the first demo unless needed for UI shape.

## Out Of Scope

- Scheduled agent jobs.
- External tool actions.
- Durable agent memory.
- Guest-authored context confirmation.
- Same-channel forks.
- Cross-channel forks.
- Nested channels.
- Human DMs.
- Agent DMs.
- Personal connected accounts.
- Marketplace or agent template layer.
- Ambient channel event streams.
- Direct agent-to-agent invocation.
- Automatic routing across agents.

## Acceptance Criteria

- A workspace agent can be registered and enabled in a channel.
- A channel member can invoke that agent from the channel.
- The user can select existing channel messages as context.
- A draft thread is created before the run starts.
- The user can review selected context in the draft thread.
- Starting the run creates an Agent Run record and sends a run payload.
- The agent response appears in the thread.
- The thread and response show provenance metadata.
- Audit events show the major lifecycle steps.
