# Agent Collaboration Glossary

## Status

Historical planning note. The active product milestone is chat-first dogfooding with Convex and
WorkOS AuthKit; see `docs/chat-realtime-auth-plan.md`. Keep these terms as later agent-work
background, not as the current MVP checklist.

## Core Collaboration

Workspace: A bounded collaboration environment containing human users, workspace agents, channels, messages, policies, integrations, schedules, memories, and artifacts.

Human User: A person account that may belong to multiple workspaces.

Channel: A shared conversation space inside a workspace with membership, history, permissions, enabled agents, and policy.

Participant: A human user or AI agent that can appear in conversation and perform allowed actions.

Artifact: A persistent output created or modified through collaboration, such as a document, decision, issue, pull request, plan, or design.

## Agents

Agent Provider: The external or internal service that implements an agent.

Agent Interface: The platform API and event contract agents use to receive run payloads, request context, respond, report run state, and request permitted actions.

Agent Registration: A workspace-owned agent configuration, including identity, endpoints, supported activation types, requested capabilities, and supported actions.

Workspace Agent: A workspace-local agent registered by a workspace admin. It has its own identity, channel enablement, policy, memory, schedules, and audit history.

Agent Presence: Operational status for an agent, such as available, disabled in this channel, running jobs, waiting for approval, degraded, or provider offline.

Capability Declaration: A manifest-like description of what an agent wants to read, write, subscribe to, or invoke.

Capability Grant: The workspace-approved subset of declared capabilities that the platform actually permits.

## Roles And Policy

Workspace Admin: A human user allowed to register agents in a workspace and configure workspace-level policy.

Channel Admin: A human user allowed to configure channel-level agent enablement, permissions, schedules, visibility, and role policy.

Channel Member: A human user allowed to participate in a channel and prompt enabled agents within the permissions granted by admins.

Channel Guest: A human user allowed to participate in channel conversation, but not prompt agents or fork agent runs by default.

Policy: A rule set controlling agent visibility, permissions, tool access, memory, scheduling, participation, and action boundaries.

Context Scope: The bounded set of messages, artifacts, channels, tools, and memories available to an agent during a run.

## Agent Runs And Threads

Activation: A specific event that causes an agent to run, such as a prompt, scheduled job, approved workflow, or explicit platform trigger.

Run: A single execution instance of an agent caused by an activation.

Run Payload: The explicit payload sent to an agent provider for a run, including identity, trigger, prompt, authorized context snapshot, grants, output contract, and callback endpoints.

Thread: A conversation container with an owner, source channel, visibility, participation policy, and messages.

Source Channel: The channel that anchors a thread for policy, enabled agents, integration authority, role checks, provenance, and admin escalation.

Agent Run: A linked execution record for an agent invocation inside a thread. A thread may have zero, one, or many agent runs.

Agent Run Thread: A thread used for an agent interaction. It contains the prompt, selected context, run status, output, errors, follow-up discussion, and audit trail through messages and linked agent run records.

Multi-Agent Thread: A thread containing runs from more than one agent. Each agent invocation is represented by its own Agent Run.

Draft Agent Thread: A thread that has been created for context review before an agent run starts. It may remain as a normal private thread even if no agent run is ever started.

Thread Owner: The human who initiated an agent run thread. For scheduled jobs, the thread owner is the job owner.

Thread Visibility: The audience allowed to view a thread.

Participation Policy: The rules controlling who may add messages or trigger follow-up runs in a thread.

Thread Fork: A new private agent thread created from an existing agent output or run thread, carrying permitted context forward under the forking user's permissions.

## Scheduled Work

Agent Job: A configured recurring or one-off schedule that activates an agent with a goal, context scope, permissions, output destination, and visibility policy.

Scheduled Activation: A time-based or recurring trigger that wakes an agent to perform work.

Job Owner: The human user who created and remains accountable for an Agent Job.

Output Contract: The configured destination and allowed output behavior for an agent job or run.

## Memory

Memory: Durable workspace-local information an agent may retain beyond a single run.

Memory Entry: A single durable remembered item with provenance, visibility, edit, and delete controls.

Runtime Context: Authorized context available during a run that is not necessarily saved as durable memory.

Runtime Secret: Non-displayable execution material such as API keys, OAuth tokens, database connection strings, webhook secrets, private keys, session cookies, or raw authorization headers.

Platform-Mediated Tool Access: A tool access model where the agent requests an action from the platform, the platform checks policy and permissions, performs or brokers the action, records audit data, and returns sanitized results to the agent.

Integration Authority: The account or installation whose permissions power a platform-mediated tool action, such as a workspace-level integration or a channel-scoped service account.

Channel-Scoped Integration: An integration configured for a specific channel or team context, such as an `origination_agent` GitHub profile or email account used by the origination squad's channel.

Workspace-Level Integration: An integration configured as the default authority for a workspace, often useful for personal workspaces or smaller teams where all channels can share the same integration bindings.
