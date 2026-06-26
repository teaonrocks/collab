# Aether

Aether is an experiment in building a calmer work chat: fast human collaboration first, with
agent-native workflows added only after the core chat product feels real.

The current repository is an Electron + React app using Convex and WorkOS AuthKit for the active
dogfood chat path. Snapshot-era `@effect/rpc` and `effect-atom` modules remain in the tree as legacy
fixtures, but they are no longer wired into runtime startup.

The active dogfood path is realtime chat with Convex and WorkOS AuthKit. The earlier agent
collaboration docs remain in `docs/` as historical planning material. They should not drive the
first product milestone until the chat surface itself is solid.

## Product Direction

Aether is intended to optimize for comprehension and follow-through instead of message volume.

- Fast by default: sending, search, navigation, and thread switching should feel instant.
- Quiet by default: notifications should be explainable, tunable, and oriented around relevance.
- Readable by default: messages, threads, code, media, and long-form posts should be pleasant to scan.
- Recoverable by default: absence should be handled through summaries, decisions, tasks, mentions,
  changed files, and pinned artifacts instead of scrollback archaeology.
- Portable by default: useful outcomes should become shareable objects with stable URLs and export
  paths.

## Chat-First MVP Scope

The first product slice is deliberately narrow:

- One seeded workspace and channel.
- Real channel message posting through the app transport.
- Live renderer updates from the main-process store.
- Message selection, copy, and delete affordances.
- Basic workspace/channel/member navigation scaffolding.
- A channel details panel for current membership and activity.

There are no multi-workspace controls, real channel creation, DMs, voice/video, file uploads,
notifications, search, agent invocation, marketplace, cron/job system, durable memory, forks, or
external integrations in this first chat milestone.

## Next Dogfood Slice

The next slice moves the chat source of truth from the local Electron JSON file to Convex and gates
it with WorkOS AuthKit:

- Authenticated current user.
- One shared workspace and one shared channel.
- Realtime message send/read across multiple users.
- Local JSON persistence removed from runtime startup and retained only as legacy test fixtures.

See [`docs/chat-realtime-auth-plan.md`](docs/chat-realtime-auth-plan.md) for the architecture
decision, data model sketch, Electron auth concerns, migration plan, risks, and acceptance criteria.
The accepted decision record is [`docs/adr-chat-realtime-auth-dogfood.md`](docs/adr-chat-realtime-auth-dogfood.md).
The local fallback retirement choice is recorded in
[`docs/local-json-fallback-retirement.md`](docs/local-json-fallback-retirement.md).

## Current Implementation

- `convex/chat.ts` owns the dogfood chat queries, mutations, and actions.
- `src/renderer/dogfood-chat.tsx` adapts Convex data into the shared chat UI model.
- `src/renderer/convex-auth.tsx` wires WorkOS AuthKit to Convex.
- `src/renderer/main.tsx` starts the Convex/AuthKit dogfood app when all required env values exist
  and otherwise shows a configuration-required state.
- `CollabRpcs`, `CollabRepo`, `CollabHandlersLive`, `collab-atoms.ts`, and `App.tsx` are preserved
  as snapshot-era legacy fixtures with colocated tests. They are not wired into runtime startup.

## Architecture

```text
Electron renderer (DOM)
  main.tsx
    dogfood env configured?
      yes -> DogfoodAuthProvider
               ConvexDogfoodApp
                 Convex AuthKit session
                 Convex realtime queries and mutations
      no  -> configuration-required state
```

The old Electron RPC transport is no longer part of the runtime architecture. Its modules remain
covered by tests so the snapshot-era behavior is available as reference while dogfood work continues
on Convex.

## Project Structure

```text
src/
  shared/
    collab-rpc.ts          # legacy snapshot-era RPC contract and wire-level errors
    rpc-client.ts          # legacy renderer RpcClient.Protocol over MessagePort
  main/
    ipc-server.ts          # legacy main RpcServer.Protocol and port handoff
    collab-repo.ts         # legacy filesystem collaboration store and change stream
    collab-handlers.ts     # legacy RPC handlers wired to the collaboration repo
    index.ts               # Electron bootstrap and AuthKit callback handling
  preload/
    index.ts               # exposes shell helpers to the renderer
  renderer/
    collab-api.ts          # legacy renderer-facing collaboration API tag
    collab-api-live.ts     # legacy RPC-backed collaboration API layer
    collab-atoms.ts        # legacy collaboration effect-atom state and mutation atoms
    App.tsx                # legacy snapshot-era channel UI
    convex-auth.tsx        # Convex AuthKit provider
    dogfood-chat.tsx       # active Convex dogfood chat UI adapter
    main.tsx               # React bootstrap
```

## Running

```sh
pnpm install
pnpm dev
pnpm convex:dev
pnpm build
pnpm typecheck
pnpm test
```

## Convex And AuthKit Dogfood Setup

The scaffold for the next dogfood slice is present but not yet the active chat source of truth.

1. Run `pnpm convex:dev` and choose the Convex-managed WorkOS AuthKit path when prompted.
2. Set the dogfood allowlist in Convex:

   ```sh
   pnpm convex env set AETHER_ALLOWED_EMAILS "you@example.com,friend@example.com"
   ```

3. Use the generated `.env.local` values for `VITE_CONVEX_URL` and `VITE_WORKOS_CLIENT_ID`.
   `VITE_WORKOS_REDIRECT_URI` should be `aether://auth/callback` so AuthKit opens in the user's
   default browser and returns to Electron.

Until those values exist, the renderer shows a configuration-required state. The old local Electron
RPC chat no longer runs as a fallback. Seeing `Aether Labs` or `#origination` should only happen in
tests or deliberately imported legacy modules. The first Convex backend functions live in
`convex/chat.ts`.

## Tests

Tests live next to the code they cover.

| File | What it covers |
| --- | --- |
| `src/shared/collab-rpc.test.ts` | Collaboration RPC inventory and `CollabSnapshot` MsgPack round-trip |
| `src/main/transport.test.ts` | MessagePort RPC transport unary calls, typed errors, streams, port-swap interruption, defect isolation, malformed-frame resilience |
| `src/main/collab-repo.test.ts` | Seed data, agent registration/enablement, draft thread creation, fake run response, provenance, audit, persistence |
| `src/main/collab-handlers.test.ts` | Collaboration handler chain through `RpcTest` |
| `src/renderer/collab-atoms.test.ts` | Collaboration snapshot streaming and mutation functions through a mock `CollabApi` |
| `src/renderer/App.test.tsx` | Chat UI rendering, message send/select/delete, details panel behavior |
| `src/renderer/App.rejection.test.tsx` | Failed chat mutations do not leak unhandled rejections |

Convex codegen/typecheck requires a configured deployment. Run `pnpm convex:dev` before expecting
`convex/_generated/` to exist.

The transport, repo, and handler tests do not need an Electron runtime. The renderer port is modelled
with a Node `MessageChannel`, and the file store uses a real temporary directory.

## Versions

Pinned to a known-good Effect set: `effect` 3.21.3, `@effect/rpc` 0.75.1,
`@effect/platform` 0.96.1, `@effect/platform-node` 0.107.0, `@effect-atom/atom` 0.5.3,
and `@effect-atom/atom-react` 0.5.0. Built with Electron 41 and electron-vite 2.

## References

- [`docs/chat-realtime-auth-plan.md`](docs/chat-realtime-auth-plan.md) is the active plan for the
  Convex + WorkOS chat dogfooding slice.
- [`docs/adr-chat-realtime-auth-dogfood.md`](docs/adr-chat-realtime-auth-dogfood.md) records the
  accepted decisions for that slice.
- [`docs/dogfood-distribution.md`](docs/dogfood-distribution.md) records the current dev-only
  dogfood install/update path and reproducible build check.
- [`docs/dogfood-debugging.md`](docs/dogfood-debugging.md) explains diagnostic codes, recovery, and
  safe failure reports for dogfood users.
- [`docs/local-json-fallback-retirement.md`](docs/local-json-fallback-retirement.md) records the
  removal of the local JSON runtime fallback and the preserved legacy fixtures.
- [`docs/message-replies-decision.md`](docs/message-replies-decision.md) records the human-chat
  reply behavior and data model impact for the Collaboration Depth milestone.
- [`docs/message-attachments-upload-path.md`](docs/message-attachments-upload-path.md) records the
  Convex storage upload path for dogfood chat file and image attachments.
- [`docs/mvp-slice.md`](docs/mvp-slice.md), [`docs/agent-collab-domain-model.md`](docs/agent-collab-domain-model.md), and
  [`docs/adr-agent-collaboration.md`](docs/adr-agent-collaboration.md) are historical agent-collaboration planning notes.
- [`package.json`](package.json) contains the pinned runtime dependencies and scripts.
- [`electron.vite.config.ts`](electron.vite.config.ts) defines the Electron/Vite entrypoints.
- [`vitest.config.ts`](vitest.config.ts) configures the colocated test suite.
