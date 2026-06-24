# ADR: Agent-First Collaboration Model

## Status

Draft

## Context

The product is a chat and collaboration platform like Slack, Discord, or Teams, but AI agents such as Hermes or OpenClaw are first-class citizens. The platform provides the interface agents connect to, similar to how Discord provides an interface for bots, while adding stronger governance around runs, context, memory, scheduling, visibility, and permissions.

## Decisions

### Agents Are Workspace-Local

Human users may belong to multiple workspaces, but each workspace agent belongs to exactly one workspace. Agent memory, scheduled jobs, permissions, audit history, and configuration are scoped to that workspace.

There is no marketplace or shared template layer for MVP. Each workspace brings and registers its own agents directly.

Agent identity is workspace-local. Two workspaces may register agents with the same display name, such as "Hermes"; the stable identity is the workspace plus the workspace agent id.

### Workspace Admins Register Agents

Only workspace admins can register agents in a workspace. Registering an agent creates a workspace-local agent identity and configuration.

Registered agents declare capabilities. Workspace admins decide which capabilities are granted. The platform enforces the boundary.

Agents should expose operational presence rather than human-like social presence. Presence can show availability, whether the agent is enabled in the current channel, active runs or jobs, pending approvals, degraded status, and provider outages.

### Agents Are Enabled Per Channel

Registering an agent in a workspace does not make it available everywhere. Registered workspace agents must be enabled per channel before members can prompt them in that channel.

Channels are collaboration contexts, not just message buckets. A channel acts as a conversation space, permission boundary, integration binding point, and agent enablement scope.

For MVP, channels are flat within a workspace. Nested channels, including potentially deep or infinite nesting, are out of scope and should be revisited when modeling scale and organizational hierarchy.

For MVP, users must explicitly mention or choose the agent they want to invoke. The platform does not automatically route prompts across multiple enabled agents.

### Channel Roles Gate Agent Interaction

Channels support guest, member, and admin roles.

Guests can participate in channel conversation, but cannot prompt agents or fork agent runs by default.

Members can prompt enabled agents and use capabilities that admins have granted.

Admins configure which agents are available, what actions they may perform, and what memory, schedules, visibility, and participation policies are allowed.

### Permissions Use Configurable Layered Policy

The MVP defaults are conservative, but permission behavior should be configurable for different use cases.

Policy composes across workspace, channel, agent, job, thread, and run scopes.

Default MVP policy:

- Members can prompt enabled agents.
- Members can create private agent threads.
- Members can fork visible agent runs.
- Members can create private scheduled jobs for themselves.
- Only channel admins can create scheduled jobs that post to a channel.
- Only channel admins can make scheduled run threads visible to channel members.
- Guests cannot prompt agents or fork agent runs.

### Agents Receive Explicit Run Payloads

Agents do not receive ambient channel event streams by default.

The platform sends an explicit run payload only when an agent is activated by a user prompt, scheduled job, approved workflow, or other explicit platform trigger.

The run payload includes only authorized context and run-scoped capability grants.

For MVP, agents do not speak unsolicited in normal channel conversation. They may respond only when explicitly invoked, scheduled, or activated by an approved workflow trigger.

### Agent Context Is User-Selected And Policy-Expandable

Before starting a manual agent thread, users may select messages or artifacts to include with the prompt. The thread is created immediately in a draft state so the prompt and selected context have a stable home before any run payload is sent to an agent provider.

Users can review and edit the selected context while the thread is still a draft. The run starts only after the user explicitly starts it.

Draft threads may remain indefinitely like normal threads, subject to the workspace's general retention policy. A draft thread does not have to become an agent run.

During a run, an agent may request more context only within the run's pre-granted scope. The platform enforces the triggering actor's live permissions, channel policy, workspace policy, agent grants, and context limits.

### Every Agent Interaction Happens In A Thread

Every manual agent interaction creates a draft agent run thread immediately.

Draft threads become active runs only after an explicit start action.

Every thread has an owner, visibility, participation policy, and audit trail.

Every follow-up that asks the agent to do more work is a new run, even when it appears inside the same thread.

Threads are the underlying conversation object. Agent runs are linked execution records. A thread may have zero, one, or many agent runs.

Every thread has a source channel. A private thread may be visible only to its owner or invited participants, but its source channel determines enabled agents, channel policy, default integration authority, admin escalation path, and role checks.

Personal-style work should happen in private channels for MVP, rather than workspace-floating private threads.

Standalone agent DMs are out of scope for MVP. A private interaction with an agent is a private thread under a source channel.

Human-to-human DMs are also out of scope for MVP. Private channels and private threads provide the private conversation model.

Because DMs are out of scope, guest access remains in scope for MVP as the mechanism for external or cross-workspace collaboration. Guests can participate in permitted channels, but cannot prompt agents or fork agent runs by default.

Guest access uses the same global human account model. A person has one human account with memberships in multiple workspaces and channel-specific roles such as guest, member, or admin.

Guests can see human participants in channels they are invited to. Guests can see visible agent messages in those channels. Guests can see that an agent exists only if it has posted or channel policy exposes enabled agents to guests.

Guests cannot see agent configuration, schedules, memory, run internals, or integration bindings by default.

Guests may reply to normal channel threads when the channel and thread participation policy allows it. Guests cannot reply to agent run threads by default. If an agent run thread is explicitly shared with guests, it may still be read-only unless the owner or an admin enables guest participation.

A member may include guest-authored messages as selected context for an agent run when the messages are visible to the member and channel policy allows agent use on guest-authored content. The context review UI should clearly show when selected content was authored by a guest before it is sent to an agent provider.

For MVP, including guest-authored content in an agent run requires explicit confirmation. Channel policy may later support stricter or looser modes, such as allowed, admin approval required, or prohibited.

For MVP, a thread's source channel is immutable. To continue work under a different channel context, a user must fork the thread into a new thread with the desired source channel, subject to permissions and policy.

Cross-channel thread forks are out of scope for MVP and should be revisited later.

Same-channel forks are allowed when the viewer is a channel member or admin, the source thread's visibility policy allows forks, the fork remains under the same source channel, and the fork includes only context visible to the forking user. Guests cannot fork.

Multiple agents may participate in the same thread. Each agent invocation is a separate Agent Run with its own permissions, context snapshot, capability grants, provider payload, and audit trail.

When invoking an additional agent in an existing thread, the platform prepares a user-reviewed context package that defaults to the visible thread history. The user may remove or adjust context before starting the run.

For MVP, agents cannot directly invoke other agents. An agent may suggest that another agent be involved, but a human must approve and start the additional run.

For MVP manual runs, agents reply inside the thread and may propose channel posts, but a human must approve before the platform publishes to a channel. Scheduled jobs may post according to their preconfigured output contract.

A thread owner may approve a proposed channel post when they can post in the target channel and channel policy allows member-approved agent posts. Otherwise, approval escalates to a channel admin.

Agent-authored messages must have visible provenance affordances. The UI should expose the agent identity, provider, linked run, owner or trigger, visibility, and whether a human approved the message before channel publication.

If a human edits an agent draft before publishing it to a channel, the final channel message is human-published and based on an agent draft. The message should link back to the originating agent run, but the human owns the final wording.

Agent-related channel messages may be deleted according to normal channel policy, but deleting a visible message does not erase the linked Agent Run audit record. Agent run history remains subject to workspace retention and legal policy.

### Scheduled Jobs Are Explicit Contracts

Scheduled agent activations are created from explicit Agent Job configurations. A job defines the agent, schedule, owner, goal, context scope, allowed actions, output destination, approval policy, failure policy, visibility, and audit settings.

The job is not just a timer. It is an agent contract.

### Scheduled Jobs Have Human Owners

Every scheduled Agent Job has exactly one human owner: the user who created it.

The owner is accountable for the job. Failures, approvals, and escalation notices go to the owner. Audit trails show both the agent identity and the owning human.

### Scheduled Jobs Use Live Owner Permission Inheritance

Scheduled jobs use live permission inheritance for MVP.

Effective permissions are the intersection of:

- owner permissions at run time
- job context scope
- configured allowed actions
- agent capability policy

If the owner loses access, future job runs lose access too. The job may fail, pause, or produce reduced output depending on policy.

### Scheduled Run Visibility Is Configured By The Job Creator

Scheduled agent run threads are private by default.

At job creation time, the creator chooses whether future run threads are private to the owner or visible to channel members, subject to policy. Member visibility is not implied by channel membership alone.

### Agent Run Threads Separate Visibility From Participation

A scheduled run thread may be visible read-only to channel members. Members who want to ask follow-up questions can fork the visible run context into their own private agent thread.

Visibility and participation are separate controls.

### Member Forks Include Full Visible Run Context

When a member forks a channel-visible scheduled run, the fork includes the full member-visible run context from the cron starting prompt through the published summary.

Guests cannot fork.

Runtime-only secrets and hidden system control prompts are never copied into forked threads.

### MVP Agent Memory Is Explicit And Inspectable

Durable agent memory is explicit, workspace-local, inspectable, editable, and deletable by authorized humans.

Agents may use permitted runtime context during a run, but long-lived memory is only created through explicit save actions or approved workflows.

### External Tool Access Is Platform-Mediated

For MVP, external tool access should be platform-mediated whenever possible. Agents request tool actions from the platform. The platform checks policy, permissions, run grants, and actor authority, then performs or brokers the action and returns sanitized results.

Raw credentials, tokens, session cookies, private keys, and authorization headers are runtime secrets. They are never copied into messages, forked contexts, or provider-visible history.

Integration authority is configurable. For MVP, a tool action may be powered by a workspace-level integration or a channel-scoped service account. Personal connected accounts are out of scope for MVP. For example, an origination squad channel may use its own `origination_agent` GitHub profile and email account, while a personal workspace may configure one workspace-level integration used by every channel.

Every tool action and agent run must expose the authority source used for external access.

Workspace admins configure workspace-level integrations, global defaults, and hard limits.

Channel admins bind allowed integrations to their channel and choose channel-scoped service accounts when workspace policy permits.

Members may choose from allowed workspace-level or channel-scoped authorities for private or manual runs when policy permits.

For personal-style usage in MVP, a user can create a private channel and bind the desired channel-scoped integrations there.

When a run starts from a channel and needs an integration, the default authority precedence is channel-scoped authority, then workspace-level authority, then ask an authorized user or admin to configure an authority.

For MVP, a run cannot use an integration authority bound to a different channel. Channel-scoped service accounts are only usable from their bound channel context.

## Consequences

The platform can support third-party agent providers while keeping access intentional and auditable.

The domain model must treat agents, runs, threads, schedules, permissions, memory, and context as first-class concepts.

The permission system must explain why an action is allowed or denied.

The product needs clear UX for registering agents, enabling agents per channel, selecting context, creating scheduled jobs, viewing run threads, forking agent outputs, and managing durable memory.

Some advanced use cases, such as ambient real-time monitoring, cross-workspace agents, and invisible automatic memory, are intentionally deferred or require explicit future policy.
