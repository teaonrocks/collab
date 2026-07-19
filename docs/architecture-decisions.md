# Architecture Decisions

This document consolidates Aether's retained architecture decision records. It distinguishes
implemented runtime decisions from parked product direction so historical choices remain available
without being mistaken for the current implementation plan.

## ADR 001: Agent-First Collaboration Model

### Status

Parked product policy with an accepted runtime seam. These decisions remain vocabulary and policy
background for future agent work, but they are not implemented by the current chat runtime. COL-21
accepted a Convex-native agent contract and explicitly declined to migrate the old snapshot RPC.
See `docs/agent-runtime-contract.md` for the field-by-field disposition and implementation seam.

### Context

Aether is intended to support AI agents such as Hermes or OpenClaw as first-class collaboration
participants. Like a bot platform, it provides the interface through which agents connect, while
adding governance around runs, selected context, memory, scheduling, visibility, permissions, and
auditability.

### Agent Identity And Enablement

- A human may belong to multiple workspaces, but a registered agent belongs to exactly one
  workspace. Its memory, jobs, permissions, audit history, and configuration are workspace-scoped.
- There is no marketplace or shared agent-template layer in the initial model. Each workspace
  registers its own agents, and stable identity is `workspace + workspaceAgentId`, not display name.
- Only workspace admins register agents. Agents declare capabilities; admins grant a permitted
  subset, and the platform enforces that boundary.
- Agent presence should communicate operational state—availability, channel enablement, active
  runs/jobs, approvals, degradation, and provider outages—not imitate human social presence.
- Registration does not enable an agent everywhere. An agent must be enabled per channel before
  members can invoke it there.
- Channels are conversation spaces, permission boundaries, integration scopes, and agent-enablement
  scopes. They remain flat in the initial model; nested channels are deferred.
- Users explicitly mention or choose the agent to invoke. The platform does not automatically route
  a prompt among enabled agents.

### Roles And Layered Policy

Channels use `guest`, `member`, and `admin` roles:

- Guests may participate in permitted human conversation but cannot prompt agents or fork runs by
  default.
- Members may prompt enabled agents and use admin-granted capabilities.
- Admins control agent availability, actions, memory, schedules, visibility, and participation
  policy.

Policy composes across workspace, channel, agent, job, thread, and run scopes. Conservative initial
defaults are:

- members can prompt enabled agents, create private agent threads, fork visible agent runs, and
  create private scheduled jobs for themselves;
- only channel admins can create jobs that post to a channel or expose scheduled run threads to
  channel members; and
- guests cannot prompt agents or fork runs.

### Runs And Context

- Agents receive an explicit run payload only after a user prompt, scheduled job, approved workflow,
  or another explicit platform trigger. They do not receive ambient channel events by default.
- The payload contains only authorized context and run-scoped grants. Agents do not speak
  unsolicited in a normal channel.
- An explicit `@agent` mention in an ordinary channel message is the initial manual trigger. Convex
  validates policy and creates the run server-side; the snapshot-era `DraftThreadCreate` then
  `AgentRunStart` flow is not migrated.
- Human replies remain shallow parent-message links and are not agent threads. A future agent
  conversation container needs its own visibility and participation decision before implementation.
- During execution, an agent may request more context only within its pre-granted scope. Live actor
  permissions, workspace/channel policy, agent grants, and context limits continue to apply.
- Every follow-up that asks an agent to do more work is a new `AgentRun`, even if it appears in the
  same thread. A thread may therefore contain zero, one, or many runs.
- Each run retains its own context snapshot, capability grants, integration authority, provider
  payload, trigger/owner, status, and audit history.

### Agent Threads

- Every agent interaction lives in a thread with an owner, visibility, participation policy, source
  channel, and audit trail.
- The source channel determines enabled agents, policy, default integration authority, escalation,
  and role checks. It is immutable in the initial model.
- Personal work occurs in private channels rather than workspace-floating threads. Standalone agent
  DMs and human DMs were outside this initial agent model.
- Same-channel forks are allowed for non-guest channel members when thread visibility permits, and
  include only context visible to the person forking. Cross-channel forks are deferred.
- Multiple agents may participate in one thread, but each invocation is a separate run. Adding an
  agent prepares a user-reviewable context package based on visible thread history.
- Agents cannot invoke other agents directly in the initial model. They may suggest involvement,
  but a human approves and starts the additional run.
- Manual runs reply within their thread and may propose channel posts. A human with suitable channel
  permission must approve publication. Scheduled jobs may publish under their predefined contract.

### Guests And Visibility

- Guest access uses the same global human account model with workspace memberships and channel
  roles. Guests can see permitted people and visible agent messages, but not agent configuration,
  schedules, memory, run internals, or integrations by default.
- Guests may participate in ordinary channel conversations when policy allows. Agent run threads
  shared with guests are read-only unless participation is explicitly enabled.
- A member may select visible guest-authored content for an agent run only when channel policy
  permits it. The context review must identify guest authorship, and initial policy requires explicit
  confirmation before sending that content to a provider.

### Provenance, Publication, And Retention

- Agent-authored output exposes agent identity, provider, linked run, owner/trigger, visibility, and
  human approval state.
- If a human edits an agent draft before publishing it, the result is human-published, linked back to
  the source run, and the human owns the final wording.
- Deleting a visible agent-related channel message does not erase its run audit record. Run history
  follows workspace retention and legal policy.

### Scheduled Jobs

- An `AgentJob` is an explicit contract, not merely a timer. It defines the agent, schedule, human
  owner, goal, context scope, allowed actions, output destination, approval/failure policy,
  visibility, and audit settings.
- Every job has exactly one accountable human owner. Failures, approvals, and escalations route to
  that owner.
- Effective permissions at run time are the intersection of the owner's live permissions, job
  context scope, configured actions, and agent capability policy. Losing access also removes it from
  future runs, which may fail, pause, or produce reduced output.
- Scheduled run threads are private by default. The creator may request channel-member visibility
  when policy permits, but visibility does not imply participation.
- Members may fork a visible scheduled run into a private agent thread. The fork includes the full
  member-visible context from initial prompt through published summary, but never secrets or hidden
  control prompts. Guests cannot fork.

### Memory And External Tools

- Durable agent memory is explicit, workspace-local, inspectable, editable, and deletable by
  authorized humans. Runtime context does not become durable memory without an explicit save or
  approved workflow.
- External tool access is platform-mediated when possible. The platform evaluates policy,
  permissions, run grants, and actor authority, then performs or brokers the action and returns a
  sanitized result.
- Credentials and authorization material are runtime secrets and never enter messages, forked
  context, or provider-visible history.
- Integrations may be workspace-level or channel-scoped service accounts. Personal connected
  accounts were deferred in the initial model.
- Admins configure workspace integrations and hard limits; channel admins bind permitted
  integrations and service accounts; members choose among allowed authorities when policy permits.
- Authority precedence is channel-scoped, then workspace-level, then a request for an authorized
  person to configure access. A channel-scoped authority cannot be used from another channel.
- Every tool action and run exposes which authority source it used.

### Consequences

The future domain model must treat agents, runs, threads, schedules, permissions, memory, selected
context, provenance, and authority as first-class concepts. The permission system must explain why
an action is allowed or denied, and the UI must make registration, enablement, context review, jobs,
run history, forks, publication approval, and memory management understandable.

Ambient monitoring, cross-workspace agents, nested channels, cross-channel forks, personal connected
accounts, and invisible automatic memory remain deferred unless a later ADR replaces these limits.

The runtime consequences are recorded in `docs/agent-runtime-contract.md`: Convex owns agent state,
policy, orchestration, and audit; the renderer receives transport-neutral views through the active
chat seam. COL-46 retired the historical Effect RPC implementation while preserving its deliberate
agent/run/audit inventory in that document.

## ADR 002: Convex And AuthKit Dogfood Chat

### Status

Accepted and implemented. The original narrow send/read cutline has since expanded to multiple
channels, direct conversations, edits, deletion, search, replies, reactions, attachments, unread
state, mentions, and desktop notifications. The decisions below record the foundation of the active
runtime and call out where later work superseded the initial scope.

### Context

Aether needed to become useful as a real shared chat before agent implementation resumed. The
snapshot-era Electron app stored one local JSON `CollabSnapshot`; it could not provide authenticated,
multi-user realtime chat. The dogfood slice deliberately avoided premature organization mapping,
packaging, and agent complexity.

### Decisions And Current Outcomes

#### Use Convex-Managed WorkOS AuthKit

Use Convex-managed WorkOS AuthKit for dogfood authentication. This remains the active approach. A
standard WorkOS team may be reconsidered when branding, custom domains, production administration,
or long-term ownership requires it.

#### Keep One Aether Workspace

The dogfood deployment uses one seeded Aether workspace. It originally exposed one seeded
`#general` channel; channel creation and public/private membership were added later. WorkOS
organizations still do not map to Aether workspaces, and workspace creation/switching remains
deferred.

#### Gate Access With A Server-Side Email Allowlist

Only allowlisted, authenticated users may read or mutate chat data. The initial environment list is
now a bootstrap mechanism; regular changes use deployment-scoped internal Convex tooling and an attributable audit
table documented in `docs/dogfood-allowlist.md`. Invite links and WorkOS organization membership are
still deferred.

#### Use System-Browser Authentication

Authentication opens AuthKit in the system browser and returns through
`aether://auth/callback`. Strict URL validation, callback queuing/focusing, packaged renderer
translation, and exact callback-to-window routing are implemented even though signed distribution
is not. Development still uses the electron-vite renderer origin where required by AuthKit.

Each account is assigned a persistent Electron session partition because AuthKit browser sessions
are session-scoped and a BrowserWindow cannot change partitions after creation. A display-only
registry remembers available accounts, while credentials remain in Chromium-managed session
storage. A newly added account remains ephemeral until authentication supplies its profile, so a
canceled sign-in cannot leave a saved placeholder. Each window has one active account, switching
recreates only that window on the selected partition, and new windows inherit the focused window's
account. OAuth state carries opaque window and account identifiers so the PKCE callback returns to
the browsing context that owns its verifier.

#### Measure Dogfood Success As Real Use

The target is replacing an existing group chat for a real conversation or project, not merely
proving authentication. Reliability, identity clarity, fast realtime updates, and recoverable error
states therefore matter more than indiscriminate feature breadth.

#### Start Convex Fresh

Local JSON messages were not migrated. Convex is authoritative. COL-46 reopened the original
retained-fixture consequence after COL-21 chose a Convex-native agent seam and removed the
filesystem store, RPC transport, snapshot renderer, and their tests. Any future import must be
explicit and idempotent rather than an automatic fallback.

#### Keep Agent UI Behind A Development Flag

Agent-specific surfaces remain hidden from normal dogfood use and may be exposed locally with
`VITE_AETHER_SHOW_AGENT_UI=true`. This prevents unfinished agent concepts from appearing as product
capabilities.

#### Begin With Send/Read, Then Expand Deliberately

The first networked surface supported only realtime send/read. Later milestones deliberately added
channels and membership, edit/delete, local timeline search, mentions and unread indicators, shallow
replies, reactions, Convex-backed attachments, and local desktop notifications. Agent workflows
remain outside the active feature set.

#### Treat Private Channels As Explicit Membership Boundaries

Private channels are invitational. Creation atomically grants the creator the `admin` channel role
and may grant eligible, allowlisted workspace members the `member` role. Private-channel admins can
later add or remove members; public channels continue to use workspace-backed membership.

Channel membership gates discovery, unread/mention indicators, history and search, member data,
message and reaction mutations, read markers, and the attachment URLs hydrated into message views.
Adding a member is visible through Convex subscriptions without an application restart. The new
membership initializes `lastReadAt` to its grant time, so earlier history is readable but does not
arrive as unread or mentioned; later messages and mentions do.

Removing a membership immediately removes subsequent channel-scoped access while leaving messages,
reactions, and stored attachments intact for remaining members. Attachment URLs already issued by
Convex storage are bearer URLs and are not retroactively revoked by membership removal. A removed
member cannot obtain another URL through Aether, but sensitive operators should not treat a copied
or shared storage URL as revocable authorization.

#### Treat Direct Messages As User-Scoped Conversations

Direct messages reuse the channel-backed message machinery with `channels.kind = "direct"` and a
canonical `directPairKey`. The pair key is sorted from the two participant user IDs, so either
participant starting the conversation resolves to the same channel row and history. Direct messages
are not returned by channel discovery, are not eligible for public-channel auto-join, and cannot be
renamed, deleted, or administered through private-channel membership controls.

The only members of a direct message are the two participants. That membership gates discovery,
history pagination, search, reactions, edit/delete, read markers, member queries, and the fresh
attachment URLs hydrated into message views. Unread state is user-scoped like channels but is shown
in the global direct-message rail and survives channel switches. `@name` text in a direct message is
plain text for this release; it does not produce channel-style mention indicators.

#### Keep Notification Preferences Conversation-Scoped

Each channel or direct conversation has a per-user Convex preference. Workspace channels default to
`mentions` and offer all messages, mentions only, or muted. Direct conversations default to all
messages and offer all messages or muted; mention-only is intentionally invalid because direct
messages do not create mention records.

The normal send transaction creates recipient-scoped notification events only for other members
whose preference matches the new message. Direct database imports, historical backfills, edits, and
the sender's own messages do not create events. Removing a channel membership prevents any retained
event for that channel from being returned later.

The renderer opens its feed with a one-shot server-issued session cursor, then advances through
recipient-scoped event sequences in pages of 100. The sequence is assigned in the message transaction,
so equal message timestamps and renderer/server clock skew cannot skip or replay events. The renderer
remembers event IDs for reconnect replay while the Electron main process deduplicates message IDs across
windows for the same account. A focused, visible window showing the conversation suppresses the native
notification. Read markers use the same focused and visible rule, so a background subscription update
is not treated as viewed. Clicking an alert focuses an account window and selects the channel or direct
conversation.

This is local desktop delivery, not push delivery: Aether must be running and the operating system
must allow notifications. Reloading or starting a new app session establishes a new server cursor rather
than alerting for existing history. During a long-running session, a reconnect may deliver genuinely
new unseen events, but repeated subscription snapshots and reconnect replays of already-seen event IDs
are suppressed. Each read is bounded to the next 100 events and acknowledges its returned cursor before
reading another page, so consumed rows are not repeatedly hydrated. Events expire after seven days via
scheduled cleanup because this feed is transient local delivery, not durable push storage. The feature
currently has no per-device sound, preview-privacy, schedule, or rich-action settings.

#### Keep Renderer State Machines At Their Owning Seams

The plain `ChatDataView` contract is the renderer boundary. `WorkspaceChat` consumes that contract
directly instead of repeating its fields, and owns UI-only controllers for conversation search and
conversation notification preferences. The Convex adapter owns transport mapping, while focused
hooks in the dogfood root own window-account synchronization and the desktop notification feed.
There is no parallel viewer query or local candidate snapshot.

Unread and mention state comes from one `chat.conversationIndicators` subscription. It walks the
viewer's memberships for workspace channels and global direct conversations; direct conversations
can be unread but never mentioned. This avoids two subscriptions implementing the same read-marker
policy.

#### Retain Only Live Schema Compatibility

The schema closeout on 2026-07-19 checked the configured development deployment, the public
friend-beta deployment, and the default production target before narrowing validators. Usernames
and direct-message preferences were complete, the old membership workspace field was absent, and
the configured reaction tables were empty. Those validators were narrowed, the redundant reaction
workspace field was removed, and the one-time migration module was retired.

Three compatibility fields remain because the configured development deployment still contains
legacy rows: one of three users has `authSubject`, 13 of 15 channel memberships have
`mentionTrackingStartedAt`, and 17 of 21 messages do not have `reactionBatchReady === true`.
Existing messages also still carry the redundant workspace field. New code no longer writes
`authSubject`, `mentionTrackingStartedAt`, or message/reaction workspace duplication; new messages
are reaction-batch ready. Remove the remaining optional validators and reaction fallback only after
a deployment migration has removed or backfilled those rows and the same read-only checks return
zero legacy records.

#### Display Names, Not Emails

Email is used for identity resolution and allowlist matching but is not shown as the normal channel
identity. Shared chat displays participant names.

#### Defer Distribution Infrastructure

Dogfood remains checkout-based. The repository can build and preview Electron/Vite output and now
handles native auth callbacks, but it does not provide signed installers, notarization, artifact
hosting, automatic updates, or production deployment ownership.

### Consequences

- WorkOS AuthKit owns authentication; Convex owns users, workspace/channel membership and private
  invitation/revocation policy, messages, reactions, attachments, unread state, and allowlist state.
- The renderer mounts only when all required public `VITE_` configuration exists; it does not fall
  back to local JSON chat.
- Server secrets and allowlist administration stay out of the renderer.
- The old RPC/local-store implementation is retired. Its deliberate agent/run/audit concepts remain
  documented in `docs/agent-runtime-contract.md`, not as executable fallback code.
- Packaging, updater behavior, production Convex/AuthKit ownership, workspace switching, and WorkOS
  organization mapping require later decisions.

### Current Acceptance State

- Convex-managed AuthKit authenticates dogfood users.
- Only allowlisted identities can access chat.
- Users share one Aether workspace and see display names rather than emails.
- Multiple users can exchange realtime messages across membership-backed channels.
- Agent UI is absent unless explicitly enabled for development.
- Checkout-based dogfood works without signed application distribution.

### COL-46 Retirement Evidence

- Reachability from the electron-vite roots ends at `src/main/index.ts` for Electron startup and at
  `src/renderer/main.tsx` for AuthKit, Convex, and active chat. No retired module was in either graph.
- Removing the dormant island deleted 1,544 source lines and reduced tests by 1,135 net lines after
  replacing the snapshot-backed shared UI suite with plain active-chat fixtures.
- Seven production dependencies and one test-only dependency were removed; the lockfile resolved 27
  fewer packages.
- The production renderer output remained exactly 1,404,805 bytes before and after the change,
  confirming a zero-byte renderer bundle impact because the retired code was already unreachable.
