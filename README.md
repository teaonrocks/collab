# Aether

Aether is an Electron chat app focused on calm, readable collaboration. The active runtime uses
React in the renderer, Convex for shared realtime data, and WorkOS AuthKit for authentication.

## Current Product

The dogfood app currently supports:

- one shared workspace with public and private channels;
- channel creation, membership-backed access, and member lists;
- realtime messages, editing, deletion, search, and unread/mention indicators;
- shallow message replies with inline parent previews;
- message reactions;
- image and file attachments stored in Convex; and
- system-browser sign-in with an `aether://auth/callback` deep link back to Electron.

Direct-message navigation is present in the shared UI model, but Convex-backed direct-message
conversations are not implemented. Agent workflows, notifications, installers, and automatic
updates are also outside the current runtime.

## Runtime Architecture

```text
Electron main process
  native window and aether:// callback handling
                |
                v
React renderer -> WorkOS AuthKit -> Convex
       |                              |
       +-- shared WorkspaceChat UI <--+
```

- `src/main/index.ts` owns Electron startup, native protocol registration, and external URL policy.
- `src/shared/auth-redirect-policy.ts` validates AuthKit URLs and native callback URLs.
- `src/renderer/main.tsx` selects the configured dogfood app or a configuration-required screen.
- `src/renderer/convex-auth.tsx` connects AuthKit to Convex.
- `src/renderer/dogfood-chat.tsx` adapts Convex queries and mutations to the shared chat UI model.
- `src/renderer/App.tsx` contains the active shared `WorkspaceChat` surface.
- `convex/schema.ts` and `convex/chat.ts` own the current data model and server behavior.

The repository still contains the earlier snapshot-shaped `@effect/rpc`, `effect-atom`, and local
JSON implementation under `src/shared`, `src/main`, and `src/renderer`. Those modules are retained
as tested fixtures and are not started by the production entrypoints. Do not reconnect the local
JSON store as a runtime fallback without a new architecture decision.

## Project Layout

```text
convex/                 # schema, authenticated chat functions, and backend tests
src/main/               # Electron startup and native AuthKit callback coordination
src/preload/            # context-isolated bridge for approved external URLs
src/renderer/           # React chat UI, Convex adapter, AuthKit provider, and UI primitives
src/shared/             # shared auth policy plus preserved snapshot-era RPC types
docs/                   # current operations and focused implementation decisions
```

## Local Setup

Requirements: Node.js, pnpm, a Convex deployment, and Convex-managed WorkOS AuthKit.

```sh
pnpm install
cp .env.example .env.local
pnpm convex:dev
```

Use the Convex-generated values for `VITE_CONVEX_URL` and `VITE_WORKOS_CLIENT_ID`. Keep
`VITE_WORKOS_REDIRECT_URI` set to `aether://auth/callback` unless the AuthKit configuration changes
deliberately.

Configure the server-side operator key and add at least one dogfood user as described in
[`docs/dogfood-allowlist.md`](docs/dogfood-allowlist.md). Then start Electron:

```sh
pnpm dev
```

If any required `VITE_` value is missing, the renderer intentionally shows a configuration-required
screen. It does not fall back to the local JSON chat.

## Commands

| Task | Command |
| --- | --- |
| Run the development app | `pnpm dev` |
| Run Convex development/code sync | `pnpm convex:dev` |
| Regenerate Convex types | `pnpm convex:codegen` |
| Run one test file | `pnpm vitest run path/to/file.test.ts` |
| Run all tests | `pnpm test` |
| Typecheck | `pnpm typecheck` |
| Build Electron/Vite output | `pnpm build` |
| Preview the build | `pnpm start` |
| Run the dogfood verification gate | `pnpm dogfood:verify` |

Run `pnpm convex:codegen` after changing the Convex schema or public functions. Generated build
output under `out/` should never be edited by hand.

## Tests

Tests are colocated with their source. The main coverage groups are:

- `convex/chat.test.ts`: auth/allowlist behavior, channels, membership, unread state, messages,
  replies, reactions, and attachments;
- `src/renderer/App.test.tsx`: shared chat behavior and interaction states;
- `src/renderer/dogfood-chat.test.tsx`: Convex-to-UI adaptation and authenticated app states;
- `src/main/auth-callback.test.ts` and the auth-policy tests: native callback handling and URL
  restrictions; and
- snapshot-era RPC, repo, transport, and atom tests: retained legacy fixture behavior.

`pnpm dogfood:verify` runs typecheck, the full test suite, and the production build.

## Documentation

- [`docs/architecture-decisions.md`](docs/architecture-decisions.md): consolidated implemented and
  parked architecture decisions, including the retained agent-collaboration model.
- [`docs/dogfood-distribution.md`](docs/dogfood-distribution.md): current checkout-based dogfood
  setup and update path.
- [`docs/dogfood-allowlist.md`](docs/dogfood-allowlist.md): audited server-side access management.
- [`docs/dogfood-smoke-test.md`](docs/dogfood-smoke-test.md): manual end-to-end verification.
- [`docs/dogfood-debugging.md`](docs/dogfood-debugging.md): safe diagnostics and recovery steps.
- [`docs/packaged-authkit-callback.md`](docs/packaged-authkit-callback.md): native Electron auth
  callback behavior.
- [`docs/message-replies-decision.md`](docs/message-replies-decision.md): shallow human-message reply
  semantics.
- [`docs/message-attachments-upload-path.md`](docs/message-attachments-upload-path.md): Convex storage
  upload and metadata flow.
- [`docs/ui-foundation.md`](docs/ui-foundation.md): app-owned UI primitives and design tokens.

Package scripts and dependency versions in [`package.json`](package.json) are authoritative.
