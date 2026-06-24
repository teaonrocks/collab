# ADR: Chat Realtime Auth Dogfood Slice

## Status

Accepted for the next dogfood implementation slice.

## Context

Aether needs to become useful as a real shared chat with friends before agent implementation resumes.
The current app is local-first Electron chat backed by a JSON `CollabSnapshot`. The next slice should
prove authenticated, multi-user, realtime chat while avoiding premature workspace, packaging, and
agent complexity.

## Decisions

### Use Convex-Managed WorkOS

Use the Convex-managed WorkOS AuthKit setup for the dogfood phase.

This optimizes for getting authenticated realtime chat working quickly and keeps setup aligned with
the current Convex integration path. A standard/existing WorkOS team can be reconsidered when
branding, custom domains, production org administration, or long-term WorkOS ownership become
important.

### Use One Hardcoded Shared Workspace

The first dogfood build uses one hardcoded shared Aether workspace and one shared channel.

WorkOS organizations do not map to Aether workspaces yet. Workspace creation, switching, and
organization mapping are deferred until the chat loop proves useful in a real group.

### Gate Access With A Manual Email Allowlist

Friends enter the dogfood through a manually maintained email allowlist.

Signed-in users who are not allowlisted cannot read or send chat messages. Invite links and WorkOS
organization membership are deferred.

### Use External Browser Auth For Packaged Electron Later

In development, use the Vite/electron-vite renderer origin for AuthKit redirect and CORS setup.

For packaged Electron, prefer system-browser sign-in with a deep link back into the app. Do not solve
packaged auth in the first scaffold unless it becomes necessary for dogfooding.

### Define Dogfood Success As Replacing An Existing Group Chat

The dogfood target is not a technical demo. Success means the group can replace an existing group
chat with Aether for a real conversation or project.

This means reliability, identity clarity, and fast realtime send/read matter more than feature
breadth.

### Start Convex Fresh

Do not migrate existing local JSON messages for the first dogfood.

Keep the local JSON file as a fallback or future import source, but Convex starts with fresh chat
data.

### Hide Agent UI Behind A Flag

Agent-specific UI and flows should be hidden behind a development flag during dogfood.

The product should not present agent capabilities to friends until those capabilities are ready to be
implemented and tested.

### Keep The First Message Surface Send/Read Only

The first Convex chat surface supports message send and realtime read only.

Message edits, deletes, reactions, threads, attachments, and notifications are out of scope for this
slice.

### Display Name Only

Show participant names only in the dogfood UI.

Emails can be used for allowlist and auth matching, but should not be displayed in the shared channel
by default.

### Defer Packaged App Requirements

The first dogfood implementation can rely on the development app and Convex development deployment.

Packaged Electron distribution, signing, updater behavior, packaged deep-link auth, and production
deployment hardening are deferred until realtime chat is worth carrying forward.

## Consequences

- The Phase 1 scaffold can stay narrow: Convex/AuthKit setup, allowlist, one workspace/channel,
  viewer, messages query, and send mutation.
- The data model should include workspace/channel/membership concepts, but only one seeded/default
  instance needs to exist.
- The renderer should not expose agent controls unless a development flag is enabled.
- Local JSON persistence should be clearly de-emphasized once Convex chat is active.
- Production auth and packaged Electron decisions remain known follow-up work, not blockers for the
  first dogfood.

## Acceptance Criteria

- Convex-managed AuthKit is used for development setup.
- Only allowlisted signed-in emails can access the shared chat.
- All dogfood users land in the same Aether workspace and channel.
- Users see names, not emails, in the channel UI.
- Multiple users can send and read messages in realtime.
- Agent UI is absent from the normal dogfood UI.
- The dogfood can attempt to replace an existing group chat without requiring packaged app delivery.
