# Agent Collaboration Domain Model

## Scope

Historical planning note. The active product milestone is chat-first dogfooding with Convex and
WorkOS AuthKit; see `docs/chat-realtime-auth-plan.md`. This domain model remains useful background
for later agent work, but it is broader than the next implementation slice.

This document describes the MVP domain model for a chat collaboration platform where workspaces bring their own AI agents. It should be read with:

- `docs/adr-agent-collaboration.md`
- `docs/agent-collab-glossary.md`

## Core Principles

- Humans can belong to multiple workspaces.
- Agents are workspace-local and never operate across workspaces.
- There is no marketplace or shared agent template layer for MVP.
- Every thread has a source channel.
- Every agent invocation is an Agent Run linked to a Thread.
- External tool access is platform-mediated whenever possible.
- Runtime secrets are never copied into messages, forks, or provider-visible history.

## Identity And Tenancy

### HumanAccount

Represents one person across the platform.

Key fields:

- `id`
- `display_name`
- `email`
- `created_at`
- `status`

Relationships:

- Has many `WorkspaceMembership`.
- Has many `ChannelMembership` through workspace membership.
- May own threads, scheduled jobs, and approval actions.

Rules:

- A human account can belong to multiple workspaces.
- A human may be an admin/member in one workspace and a guest in another.

### Workspace

Top-level collaboration, administration, and tenancy boundary.

Key fields:

- `id`
- `name`
- `created_at`
- `retention_policy_id`
- `workspace_policy_id`

Relationships:

- Has many `WorkspaceMembership`.
- Has many `Channel`.
- Has many `WorkspaceAgent`.
- Has many workspace-level `IntegrationBinding`.
- Has many `AuditEvent`.

Rules:

- Agents, agent memory, scheduled jobs, permissions, and audit history are scoped to one workspace.
- Agent display names only need to be unique within a workspace if the product requires that for UX. Two workspaces may register agents with the same display name.

### WorkspaceMembership

Connects a human account to a workspace.

Key fields:

- `workspace_id`
- `human_account_id`
- `role`
- `status`
- `created_at`

Typical roles:

- `owner`
- `admin`
- `member`
- `guest`

Rules:

- Workspace admins can register workspace agents and configure workspace-level integrations and policy.
- Guest access is in scope for MVP because DMs are out of scope.

## Channels

### Channel

A collaboration context. A channel is not just a message bucket; it is also a permission boundary, agent enablement scope, and integration binding point.

Key fields:

- `id`
- `workspace_id`
- `name`
- `visibility`
- `channel_policy_id`
- `created_by`
- `created_at`
- `archived_at`

Visibility:

- `public`
- `private`

Relationships:

- Belongs to one `Workspace`.
- Has many `ChannelMembership`.
- Has many `ChannelAgentEnablement`.
- Has many channel-scoped `IntegrationBinding`.
- Has many `Thread`.

Rules:

- Channels are flat within a workspace for MVP.
- Nested channels are out of scope for MVP.
- Channel-scoped service accounts are only usable from their bound channel context.

### ChannelMembership

Connects a human account to a channel with a channel-specific role.

Key fields:

- `channel_id`
- `human_account_id`
- `role`
- `created_at`

Roles:

- `guest`
- `member`
- `admin`

Rules:

- Guests can participate in permitted channel conversation.
- Guests cannot prompt agents or fork agent runs by default.
- Members can prompt enabled agents within admin-granted permissions.
- Channel admins configure channel agent enablement, channel integration bindings, schedules, visibility, and participation policy.

## Agents

### WorkspaceAgent

A workspace-owned agent registered directly by a workspace admin.

Key fields:

- `id`
- `workspace_id`
- `display_name`
- `description`
- `provider_name`
- `endpoint`
- `auth_config_ref`
- `declared_capabilities`
- `granted_capabilities`
- `supported_activation_types`
- `status`
- `created_by`
- `created_at`

Relationships:

- Belongs to one `Workspace`.
- Has many `ChannelAgentEnablement`.
- Has many `AgentRun`.
- Has many `AgentJob`.
- Has many `MemoryEntry`.

Rules:

- There is no global shared agent identity across workspaces.
- Stable identity is `workspace_id + agent_id`.
- Display names may collide across workspaces.
- Agents do not receive ambient channel event streams for MVP.
- Agents may respond only when explicitly invoked, scheduled, or activated by an approved workflow trigger.
- Agents cannot directly invoke other agents for MVP; they may suggest another agent and wait for human approval.

### ChannelAgentEnablement

Enables a workspace agent in a specific channel.

Key fields:

- `channel_id`
- `agent_id`
- `enabled_by`
- `enabled_at`
- `channel_grants`
- `status`

Rules:

- A registered workspace agent is not available in a channel until enabled there.
- Users must explicitly mention or choose the agent they want to invoke.
- The platform does not auto-route prompts across enabled agents for MVP.

## Threads And Messages

### Thread

Conversation container. A thread may be a normal human thread, a draft agent thread, or a thread with one or more agent runs.

Key fields:

- `id`
- `workspace_id`
- `source_channel_id`
- `owner_id`
- `visibility`
- `participation_policy`
- `status`
- `created_at`
- `archived_at`

Relationships:

- Belongs to one `Workspace`.
- Belongs to one source `Channel`.
- Has many `ThreadMessage`.
- Has many `AgentRun`.
- May have many `ThreadParticipant`.
- May be forked from another `Thread`.

Rules:

- Every thread has a source channel.
- Source channel is immutable for MVP.
- Standalone human DMs and agent DMs are out of scope for MVP.
- Private interaction happens in private threads under a source channel.
- Draft threads may remain indefinitely like normal threads, subject to workspace retention policy.
- Cross-channel forks are out of scope for MVP.
- Same-channel forks are allowed when policy permits and the fork includes only context visible to the forking user.

Visibility examples:

- `private`
- `channel_members_read_only`
- `channel_members_interactive`
- `shared_with_guests`

### ThreadParticipant

Optional participant record for private or restricted threads.

Key fields:

- `thread_id`
- `participant_type`
- `participant_id`
- `role`
- `added_by`
- `added_at`

Participant types:

- `human`
- `agent`

Rules:

- Thread ownership remains with a human.
- Agent participation is represented through linked `AgentRun` records.

### ThreadMessage

A message inside a thread.

Key fields:

- `id`
- `thread_id`
- `author_type`
- `author_id`
- `body`
- `message_kind`
- `provenance`
- `created_at`
- `deleted_at`

Author types:

- `human`
- `agent`
- `system`

Message kinds:

- `normal`
- `selected_context`
- `agent_output`
- `agent_draft`
- `approval_request`
- `tool_summary`
- `system_event`

Rules:

- Agent-authored messages must expose provenance: agent identity, provider, linked run, owner or trigger, visibility, and human approval state.
- If a human edits an agent draft before channel publication, the final channel message is human-published and links back to the originating agent run.
- Deleting a visible message does not delete the linked Agent Run audit history.
- Guest-authored content can be selected as agent context only when visible to the member and channel policy permits it.
- For MVP, including guest-authored content in an agent run requires explicit confirmation.

## Agent Runs

### AgentRun

A single execution record for an agent invocation inside a thread.

Key fields:

- `id`
- `workspace_id`
- `thread_id`
- `source_channel_id`
- `agent_id`
- `activation_type`
- `triggering_actor_id`
- `owner_id`
- `status`
- `context_snapshot_ref`
- `capability_grants_snapshot`
- `integration_authority_snapshot`
- `output_contract`
- `started_at`
- `completed_at`
- `failed_at`

Activation types:

- `manual_prompt`
- `scheduled_job`
- `approved_workflow_trigger`

Statuses:

- `draft`
- `queued`
- `running`
- `waiting_for_approval`
- `completed`
- `failed`
- `cancelled`

Rules:

- Manual agent interactions create a draft thread before any run payload is sent.
- The run starts only after explicit human start.
- Each agent invocation has its own permissions, context snapshot, capability grants, provider payload, and audit trail.
- Multiple agents may participate in the same thread through separate Agent Runs.
- Additional agent invocations use a user-reviewed context package that defaults to visible thread history.

### ContextSnapshot

Immutable record of the context assembled for a run.

Key fields:

- `id`
- `run_id`
- `selected_message_ids`
- `selected_artifact_refs`
- `included_memory_entry_ids`
- `guest_content_confirmation`
- `created_at`

Rules:

- Context is reviewed before the run starts.
- Forks copy permitted context as a snapshot, not as a live mirror.
- Runtime secrets are not part of context snapshots.

## Scheduled Work

### AgentJob

Recurring or one-off scheduled activation for an agent.

Key fields:

- `id`
- `workspace_id`
- `source_channel_id`
- `agent_id`
- `owner_id`
- `schedule`
- `goal`
- `context_scope`
- `allowed_actions`
- `output_destination`
- `approval_policy`
- `failure_policy`
- `run_thread_visibility`
- `status`
- `created_at`

Rules:

- Every scheduled job has exactly one human owner.
- Scheduled jobs use live owner permission inheritance for MVP.
- Effective permissions are owner permissions at run time intersected with job scope, allowed actions, and agent capability policy.
- Scheduled run visibility is configured by the job creator, subject to policy.
- Scheduled run threads are private by default.
- Channel-visible scheduled run threads may be read-only to channel members.
- Members may fork visible scheduled runs into private same-channel threads if policy allows.

## Integrations

### IntegrationBinding

Configures which external account or installation powers platform-mediated tool actions.

Key fields:

- `id`
- `workspace_id`
- `scope_type`
- `scope_id`
- `integration_type`
- `authority_ref`
- `configured_by`
- `created_at`
- `status`

Scope types:

- `workspace`
- `channel`

Examples:

- Workspace-level GitHub App installation.
- Channel-scoped `origination_agent` GitHub account.
- Channel-scoped `origination_agent` email account.

Rules:

- Personal connected accounts are out of scope for MVP.
- Default precedence is channel-scoped authority, then workspace-level authority, then ask an authorized user or admin to configure one.
- A run cannot use an integration authority bound to another channel.
- Every tool action and run must expose the authority source used for external access.

### ToolAction

Platform-mediated request to an external tool.

Key fields:

- `id`
- `run_id`
- `integration_binding_id`
- `requested_action`
- `requested_by_agent_id`
- `authority_snapshot`
- `status`
- `sanitized_result_ref`
- `created_at`
- `completed_at`

Rules:

- The platform checks policy, permissions, run grants, and actor authority before performing the action.
- Raw credentials, tokens, private keys, session cookies, and authorization headers are runtime secrets and are never copied into provider-visible history.

## Memory

### MemoryEntry

Durable workspace-local information an agent may retain beyond a single run.

Key fields:

- `id`
- `workspace_id`
- `agent_id`
- `scope_type`
- `scope_id`
- `content`
- `provenance`
- `visibility`
- `created_by`
- `created_at`
- `updated_at`
- `deleted_at`

Rules:

- MVP durable memory is explicit and inspectable.
- Authorized humans can view, edit, or delete memory entries.
- Agents may use runtime context during a run without turning it into durable memory.
- Long-lived memory is created only through explicit save actions or approved workflows.

## Policy And Audit

### Policy

Configurable rules controlling permissions, visibility, memory, scheduling, integrations, and participation.

Common scopes:

- `workspace`
- `channel`
- `agent`
- `job`
- `thread`
- `run`

Rules:

- MVP defaults are conservative.
- Policy should explain why an action is allowed or denied.
- Workspace policy can set broad defaults and hard limits.
- Channel policy adapts those rules for a collaboration context.

### AuditEvent

Durable record of important actions and decisions.

Key fields:

- `id`
- `workspace_id`
- `actor_type`
- `actor_id`
- `event_type`
- `target_type`
- `target_id`
- `source_channel_id`
- `thread_id`
- `run_id`
- `authority_snapshot`
- `policy_snapshot`
- `result`
- `created_at`

Examples:

- Workspace admin registered an agent.
- Channel admin enabled an agent in a channel.
- Member created a draft agent thread.
- Member confirmed guest-authored context.
- Agent run started.
- Agent requested additional context.
- Platform used a channel-scoped GitHub authority.
- Agent proposed a channel post.
- Human approved a channel post.
- Agent-related channel message was deleted.

Rules:

- Audit history survives visible-message deletion, subject to workspace retention and legal policy.
- Audit events should answer who did what, when, where, under which authority, using which policy, and with what result.

## Key MVP Flows

### Register And Enable Agent

1. Workspace admin registers a workspace agent.
2. The agent declares capabilities.
3. Workspace admin grants allowed capabilities.
4. Channel admin enables the agent in a channel.
5. Members can mention the agent in that channel if policy allows.

### Manual Agent Run

1. Member chooses a source channel.
2. Member selects an enabled agent.
3. Member selects messages or artifacts as context.
4. Platform creates a draft thread immediately.
5. Member reviews and edits context.
6. Member starts the run.
7. Platform sends an explicit run payload to the agent provider.
8. Agent responds inside the thread.
9. Agent may propose a channel post.
10. Human approval is required before channel publication.

### Scheduled Agent Job

1. Authorized human creates an Agent Job for a source channel.
2. Job configuration defines schedule, goal, context scope, actions, output destination, visibility, and failure policy.
3. At run time, platform evaluates live owner permissions.
4. Platform creates a run thread according to configured visibility.
5. Agent receives an explicit run payload.
6. Output is posted according to the job's output contract.
7. Members may fork visible run context into private same-channel threads if policy allows.

### Same-Channel Fork

1. Member views a forkable thread.
2. Member creates a private fork under the same source channel.
3. Fork receives a snapshot of context visible to that member.
4. Member may invoke one or more enabled agents in the fork.
5. Each invocation creates a separate Agent Run.
