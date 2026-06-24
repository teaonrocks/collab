# Chat Realtime And Auth Slice

## Status

Active planning for the next dogfooding slice.

Scaffold started: package dependencies, `convex.json`, Convex schema/functions, renderer
AuthKit/Convex provider shell, and the agent UI flag are in place. The Convex functions are not yet
connected to the chat UI because `pnpm convex:dev` must provision the deployment and generate
`convex/_generated/` first.

The goal is to let a small group of friends use Aether as a real shared chat before agent
implementation. The first networked slice is Convex plus WorkOS AuthKit with:

- authenticated current user
- one shared workspace
- one shared channel
- realtime message send/read

Channel creation, membership management, message edits/deletes, and agent-specific objects stay
behind this slice.

See also `docs/adr-chat-realtime-auth-dogfood.md` for the accepted product and architecture
decisions behind this plan.

## Accepted Decisions

- Use Convex-managed WorkOS AuthKit for the dogfood phase.
- Use one hardcoded shared workspace and one shared channel.
- Gate access through a manually maintained email allowlist.
- Use the development renderer origin for initial AuthKit redirect/CORS setup.
- Prefer system-browser sign-in with a deep link back into packaged Electron later.
- Define success as replacing an existing group chat, not merely proving auth works.
- Start Convex fresh; do not migrate local JSON messages for the first dogfood.
- Hide agent UI behind a development flag.
- Keep the first Convex message surface send/read only.
- Display participant names only; use email for allowlist/auth matching, not channel display.
- Defer packaged Electron distribution and production auth hardening until the chat loop proves
  useful.

## Current Starting Point

Aether is currently an Electron + React app using `@effect/rpc` and `effect-atom` over an Electron
`MessagePort`.

- `src/shared/collab-rpc.ts` defines the current snapshot-shaped RPC contract.
- `src/main/collab-repo.ts` owns the local store and persists the whole `CollabSnapshot` to
  `app.getPath("userData")/aether-collab.json`.
- `src/main/collab-handlers.ts` exposes repo mutations and streams through `CollabRpcs`.
- `src/renderer/collab-api-live.ts` adapts the RPC client into the renderer-facing `CollabApi`.
- `src/renderer/collab-atoms.ts` subscribes to the snapshot stream and exposes mutation atoms.
- `src/renderer/App.tsx` renders the current chat-first UI.

The existing agent registration, enablement, draft thread, run, provenance, and audit objects are
parked implementation scaffolding. They are not part of the dogfooding slice.

## External Setup Notes

Primary references:

- Convex WorkOS AuthKit guide:
  https://docs.convex.dev/auth/authkit/
- Adding WorkOS AuthKit to an existing Convex app:
  https://docs.convex.dev/auth/authkit/add-to-app
- Convex Auth overview:
  https://docs.convex.dev/auth/overview
- WorkOS AuthKit React SDK:
  https://workos.com/docs/sdks/authkit-react
- Convex WorkOS AuthKit component:
  https://github.com/get-convex/workos-authkit

The current Convex docs describe AuthKit as a first-class Convex auth option. Convex can either use
a Convex-managed WorkOS team or a standard WorkOS team. For an existing app, the setup path includes
`convex.json`, AuthKit redirect/CORS configuration, `npx convex dev`, and client wiring with
`ConvexProviderWithAuthKit` or the lower-level WorkOS React SDK bridge.

Important constraints for this Electron app:

- `WORKOS_API_KEY`, webhook secrets, deploy keys, and cookie passwords must never be bundled into the
  renderer or committed.
- `WORKOS_CLIENT_ID` is safe for the client bundle, but still belongs in environment configuration.
- Development auth can likely use the Vite renderer origin, usually `http://localhost:5173`, but the
  exact electron-vite dev origin should be confirmed before configuring redirect and CORS entries.
- Packaged Electron auth needs a decision. A browser-based redirect flow can use a loopback callback,
  a custom protocol handler, or an external browser plus deep link back into Electron. This should be
  chosen before production AuthKit configuration.

Because the first setup requires team/project choices and generated Convex files, this document does
not add a partial scaffold yet.

## Architecture Decision

Use Convex as the networked chat source of truth for the dogfooding slice, while keeping the current
`CollabApi` boundary as a temporary compatibility adapter.

The renderer should continue to depend on `CollabApi` during the migration. A new Convex-backed
implementation can satisfy the same chat-shaped operations while the Electron main process keeps the
local JSON repo available as a fallback or migration source. Once the chat UI is fully Convex-backed,
the snapshot contract can be narrowed or replaced with direct Convex hooks.

Initial ownership:

- Auth state: WorkOS AuthKit.
- User identity in app data: synced or derived WorkOS AuthKit user identity.
- Workspace/channel/message state: Convex.
- Local JSON file: migration/export fallback only, then deprecated.
- Agent scaffolding: hidden from the first networked slice.

## Data Model Sketch

Convex tables for the first slice:

- `users`
  - `authUserId`: WorkOS/AuthKit user id or component user id
  - `displayName`
  - `email`
  - `avatarUrl?`
  - `createdAt`
  - indexes: `by_auth_user_id`
- `workspaces`
  - `name`
  - `slug`
  - `createdAt`
  - indexes: `by_slug`
- `workspaceMemberships`
  - `workspaceId`
  - `userId`
  - `role`: `owner | admin | member | guest`
  - `createdAt`
  - indexes: `by_workspace`, `by_user`, `by_workspace_user`
- `channels`
  - `workspaceId`
  - `name`
  - `visibility`: `public | private`
  - `createdBy`
  - `createdAt`
  - `archivedAt?`
  - indexes: `by_workspace`, `by_workspace_name`
- `channelMemberships`
  - `channelId`
  - `userId`
  - `role`: `admin | member | guest`
  - `createdAt`
  - indexes: `by_channel`, `by_user`, `by_channel_user`
- `messages`
  - `workspaceId`
  - `channelId`
  - `authorUserId`
  - `body`
  - `createdAt`
  - `editedAt?`
  - `deletedAt?`
  - indexes: `by_channel_created_at`, `by_workspace_created_at`

For the first dogfood pass, seed or ensure exactly one workspace and one channel. Friend access is
controlled by a manual email allowlist. WorkOS organizations do not map to Aether workspaces yet.

## Convex Functions

Queries:

- `viewer`: return the authenticated app user and basic membership state.
- `defaultWorkspace`: return the shared workspace/channel shell for the authenticated user.
- `channelMessages`: return non-deleted messages for the default channel, ordered by creation time.

Mutations:

- `ensureViewer`: create/update the app `users` record for the authenticated WorkOS user.
- `ensureDefaultWorkspace`: create or verify the hardcoded workspace, channel, and allowlisted
  membership.
- `sendMessage`: check channel membership and insert a message.

Later mutations:

- `createChannel`
- `joinOrInviteMember`
- `editMessage`
- `deleteMessage`
- `backfillLocalSnapshot`

Convex queries are reactive, so `channelMessages` should replace the current `CollabWatch` stream for
the chat timeline once the renderer is wired to Convex.

## Renderer And Electron Auth Approach

Development path:

1. Run `pnpm install` after adding Convex/AuthKit dependencies.
2. Run `pnpm convex dev` or the chosen package script after adding one.
3. Configure AuthKit redirect and CORS for the electron-vite renderer origin.
4. Wrap the React root with the Convex/AuthKit provider.
5. Gate the chat UI behind authenticated state.
6. Check the signed-in user's email against the manual allowlist before returning workspace/channel
   data.
7. Bridge Convex query/mutation hooks into the existing chat UI either through `CollabApi` or a
   thin renderer adapter.

Production path to decide before shipping:

- Preferred callback mechanism for Electron packaged builds.
- Use system-browser sign-in with a deep link back into Electron unless dogfood findings overturn
  this.
- How to store session material safely and how sign-out clears it.
- Whether WorkOS organizations map to Aether workspaces later.

## Implementation Phases

### Phase 0: Product Cutline

- Hide or de-emphasize agent controls in the dogfood build.
- Put agent controls behind a development flag rather than showing disabled controls to dogfood
  users.
- Keep one shared workspace/channel.
- Keep message create/read only.
- Make the local JSON file explicitly non-authoritative for dogfood.

### Phase 1: Secrets-Free Scaffold

- Add Convex and AuthKit dependencies. Done.
- Add package scripts for Convex dev/codegen. Done.
- Add `convex.json` for Convex-managed WorkOS with the electron-vite renderer origin. Done with
  `http://localhost:5173`.
- Add `convex/schema.ts` and minimal query/mutation files. Done.
- Add `.env.example` placeholders only. Done.
- Run `pnpm convex:dev` to provision the deployment and generate `convex/_generated/`. Pending user
  setup.

Do this after confirming the Electron dev origin. The WorkOS setup mode is Convex-managed.

### Phase 2: Authenticated Realtime Chat

- Wire the React root to AuthKit and Convex.
- Add authenticated loading, signed-out, and signed-in states.
- Implement `viewer`, `defaultWorkspace`, `channelMessages`, and `sendMessage`.
- Implement allowlist rejection for signed-in users whose email is not approved.
- Use Convex realtime queries for the channel timeline.
- Keep existing message selection/copy affordances where they do not depend on local-only ids.

### Phase 3: Migration From Local JSON

- Do not import existing local messages for the first dogfood.
- Keep `aether-collab.json` as a future one-time import source only.
- If import is later requested, map the seeded workspace/channel to the shared Convex
  workspace/channel.
- Preserve original local ids in optional metadata if useful for debugging.
- Stop writing chat messages to JSON after Convex chat is active.

### Phase 4: Expand Collaboration

- Add channel creation and membership.
- Add message edit/delete.
- Revisit the shared RPC contract and remove parked agent fields from the active chat snapshot.
- Later, reintroduce agent objects on top of the Convex workspace/channel/membership model.

## Risks

- Electron redirect handling can be the longest pole if it is postponed until packaging.
- The current `CollabSnapshot` mixes active chat state with parked agent state; mirroring it in
  Convex would over-model the dogfood slice.
- WorkOS organization mapping would create unnecessary complexity before the single shared workspace
  is useful.
- Manual allowlists are operationally simple but require someone to update config/data when friends
  join.
- Replacing an existing group chat raises the bar for reliability even while the feature set remains
  intentionally narrow.
- Partial Convex scaffolds can break typecheck if generated files are referenced before
  `convex dev` or codegen runs.
- Local JSON import can duplicate messages unless it is explicit and idempotent.

## Acceptance Criteria

- A signed-out user sees an auth entry state and cannot read or send messages.
- A signed-in user is associated with an Aether user record.
- A signed-in allowlisted user can see the shared workspace and channel.
- A signed-in non-allowlisted user cannot see or post to the shared channel.
- Messages sent by one signed-in user appear for another signed-in user without manual refresh.
- Message send rejects unauthenticated users and users without channel membership.
- Channel participant display uses names, not emails.
- Agent UI is hidden unless a development flag enables it.
- No WorkOS secrets, deploy keys, webhook secrets, or cookie passwords are committed or bundled.
- The local JSON store is not the source of truth for the dogfood chat timeline.
- Existing local-only tests continue passing until code migration begins.
