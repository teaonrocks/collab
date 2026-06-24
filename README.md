# Aether

Aether is an experiment in building a calmer work chat: fast human collaboration first, with
agent-native workflows added only after the core chat product feels real.

The current repository is an Electron + React app that wires `@effect/rpc` and `effect-atom` across
the main/renderer boundary over a `MessagePort`. The active app now prioritizes a working
Slack/Discord-style channel surface: workspace navigation, a channel timeline, message composer,
message selection, copy/delete actions, live snapshots, and a channel details panel.

The earlier agent collaboration docs remain in `docs/` as historical planning material. They should
not drive the first product milestone until the chat surface itself is solid.

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

## Current Implementation

- `CollabRpcs` is the schema-defined shared RPC contract for payloads, successes, streams, and typed
  errors.
- `CollabRepo` is the filesystem-backed main-process store. It seeds the workspace/channel/current
  user, stores channel messages, still contains parked agent collaboration operations for a later
  phase, and persists data to `app.getPath("userData")/aether-collab.json`.
- `CollabHandlersLive` exposes the repo through the RPC server.
- `layerIpcServer` and `layerIpcClient` provide the custom MsgPack RPC transport over Electron
  `MessagePort`.
- `CollabApiLive` adapts the RPC client into the renderer-facing `CollabApi` service tag.
- `collab-atoms.ts` builds renderer state and mutation functions with `effect-atom`.
- `App.tsx` renders the working chat-first channel flow.

## Architecture

```text
Electron main (Node)
  ManagedRuntime(Live)
    RpcServer.layer(CollabRpcs)
      CollabHandlersLive
        CollabRepo
          FileSystem + SubscriptionRef -> userData/aether-collab.json

    layerIpcServer
      RpcServer.Protocol over IpcServerPort
      RpcPortHandoff.bind, rebinds a fresh port per renderer load

                  MessagePortMain
               new MessageChannelMain
                       |
                       v

preload (isolated world)
  ipcRenderer.on("rpc-port") -> window.postMessage(port)

                       |
                       v

Electron renderer (DOM)
  window message "rpc-port" -> MessagePort
    CollabApiLive
      layerIpcClient
      RpcClient.make(CollabRpcs)
      adapter -> CollabApi Context.Tag

    collab-atoms.ts
      Atom.runtime(CollabApiLive)
      effect-atom
      React App
```

The renderer depends on the `CollabApi` tag rather than the transport. Production binds
`CollabApiLive` to the handed-off `MessagePort`; tests can replace it with a mock layer through the
atom runtime.

## Project Structure

```text
src/
  shared/
    collab-rpc.ts          # agent collaboration MVP RPC contract and wire-level errors
    rpc-client.ts          # renderer RpcClient.Protocol over MessagePort
  main/
    ipc-server.ts          # main RpcServer.Protocol and port handoff
    collab-repo.ts         # filesystem collaboration store and change stream
    collab-handlers.ts     # RPC handlers wired to the collaboration repo
    index.ts               # Electron bootstrap and active collaboration runtime composition
  preload/
    index.ts               # relays the transferred port to the renderer
  renderer/
    collab-api.ts          # renderer-facing collaboration API tag
    collab-api-live.ts     # production RPC-backed collaboration API layer
    collab-atoms.ts        # collaboration effect-atom state and mutation atoms
    App.tsx                # current chat-first channel UI
    main.tsx               # React bootstrap
```

## Running

```sh
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm test
```

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

The transport, repo, and handler tests do not need an Electron runtime. The renderer port is modelled
with a Node `MessageChannel`, and the file store uses a real temporary directory.

## Versions

Pinned to a known-good Effect set: `effect` 3.21.3, `@effect/rpc` 0.75.1,
`@effect/platform` 0.96.1, `@effect/platform-node` 0.107.0, `@effect-atom/atom` 0.5.3,
and `@effect-atom/atom-react` 0.5.0. Built with Electron 41 and electron-vite 2.

## References

- [`docs/mvp-slice.md`](docs/mvp-slice.md), [`docs/agent-collab-domain-model.md`](docs/agent-collab-domain-model.md), and
  [`docs/adr-agent-collaboration.md`](docs/adr-agent-collaboration.md) are historical agent-collaboration planning notes.
- [`package.json`](package.json) contains the pinned runtime dependencies and scripts.
- [`electron.vite.config.ts`](electron.vite.config.ts) defines the Electron/Vite entrypoints.
- [`vitest.config.ts`](vitest.config.ts) configures the colocated test suite.
