# Aether

Aether is an Electron chat app focused on calm, readable collaboration. The active runtime uses
React in the renderer, Convex for shared realtime data, and WorkOS AuthKit for authentication.

## Current Product

The dogfood app currently supports:

- one shared workspace with public and private channels;
- channel creation, membership-backed access, and member lists;
- realtime messages, editing, deletion, search, and unread/mention indicators;
- global direct conversations with username search and friendship/privacy controls;
- shallow message replies with inline parent previews;
- message reactions;
- image and file attachments stored in Convex;
- per-conversation notification preferences and native desktop notifications;
- system-browser sign-in with an `aether://auth/callback` deep link back to Electron; and
- persistent multi-account sessions with independently switchable app windows.

Agent workflows, installers, and automatic updates are outside the current runtime.

## Runtime Architecture

```text
Electron main process
  account registry, isolated window sessions, and aether:// callback routing
                |
                v
React renderer -> WorkOS AuthKit -> Convex
       |                              |
       +-- shared WorkspaceChat UI <--+
```

- `src/main/index.ts` owns Electron startup, native protocol registration, and external URL policy.
- `src/main/account-registry.ts` owns the display-only saved-account registry; AuthKit credentials
  stay inside persistent, account-specific Electron session partitions.
- `src/shared/account-session.ts` defines the account/session and callback-routing policy shared
  across Electron boundaries.
- `src/shared/auth-redirect-policy.ts` validates AuthKit URLs and native callback URLs.
- `src/renderer/main.tsx` selects the configured dogfood app or a configuration-required screen.
- `src/renderer/convex-auth.tsx` connects AuthKit to Convex.
- `src/renderer/dogfood-chat.tsx` owns AuthKit/Convex query orchestration; focused hooks own account
  synchronization and desktop-notification feed state.
- `src/renderer/dogfood-chat-adapter.ts` maps typed Convex results and mutations to the plain active-chat contract without snapshot-era schema objects.
- `src/renderer/chat-data.ts` defines the renderer-owned active-chat view model and operations.
- `src/renderer/workspace-chat.tsx` contains the shared `WorkspaceChat` surface and its focused
  conversation-search and preference controllers, with pure presentation-model helpers in
  `workspace-chat-model.ts`.
- `convex/schema.ts` and `convex/chat.ts` own the current data model and server behavior.

Production reachability is rooted in `src/main/index.ts` and `src/renderer/main.tsx`, matching the
electron-vite inputs. The main entrypoint owns only Electron/auth/security behavior; the renderer
entrypoint loads AuthKit, Convex, and the plain active-chat path. The snapshot-era Effect RPC,
MessagePort transport, local JSON repository, atoms, and renderer were retired after COL-21 accepted
a Convex-native agent contract. Do not restore local JSON/RPC as a production fallback.

## Project Layout

```text
convex/                 # schema, authenticated chat functions, and backend tests
src/main/               # Electron startup and native AuthKit callback coordination
src/preload/            # context-isolated bridge for approved external URLs
src/renderer/           # React chat UI, Convex adapter, AuthKit provider, and UI primitives
src/shared/             # transport-neutral policy shared across Electron boundaries
docs/                   # current operations and focused implementation decisions
```

## Local Setup

Requirements: Node.js 22.23.1, pnpm 11.7.0, a Convex deployment, and Convex-managed WorkOS
AuthKit. The exact toolchain is pinned in `.nvmrc` and `package.json#packageManager`.

```sh
pnpm install
cp .env.example .env.local
pnpm convex:dev
```

Use the Convex-generated values for `VITE_CONVEX_URL` and `VITE_WORKOS_CLIENT_ID`. Keep
`VITE_WORKOS_REDIRECT_URI` set to `aether://auth/callback` unless the AuthKit configuration changes
deliberately.

Configure the server-side operator key and add at least one dogfood user as described in
[`docs/dogfood-allowlist.md`](docs/dogfood-allowlist.md). For normal renderer development, start
Electron directly:

```sh
pnpm dev
```

On macOS, system-browser sign-in must run through Aether's packaged app identity. The generic
development Electron app is shared by every Electron checkout and cannot reliably own the
`aether://` callback. Build and launch the unsigned local app instead:

```sh
pnpm package:mac
pnpm start:mac
```

Open another Aether window with File → New Window or `Cmd/Ctrl+N`. A new window inherits the active
account of the focused window. Launching Aether again while it is already running also opens an
inheriting window. Use the bottom-left profile avatar to switch that window, add another account,
sign out the current account everywhere it is open, or sign out all saved accounts. Other windows
do not change when one window switches accounts.

If any required `VITE_` value is missing, the renderer intentionally shows a configuration-required
screen. It does not fall back to the local JSON chat.

Friend-beta testers use the ready-to-copy public values in `.env.example` and do not run
`pnpm convex:dev` or need Convex access. See
[`docs/dogfood-distribution.md`](docs/dogfood-distribution.md) for the separate tester and deployment
operator paths.

## Commands

| Task | Command |
| --- | --- |
| Run the development app | `pnpm dev` |
| Run Convex development/code sync | `pnpm convex:dev` |
| Regenerate Convex types | `pnpm convex:codegen` |
| Run one test file | `pnpm vitest run path/to/file.test.ts` |
| Run all tests | `pnpm test` |
| Typecheck the Electron/renderer project | `pnpm typecheck` |
| Typecheck Convex and validate generated bindings | `pnpm convex:check` |
| Run ESLint, Hooks checks, and unused production dependency analysis | `pnpm lint` |
| Build Electron/Vite output | `pnpm build` |
| Preview the build | `pnpm start` |
| Build an unsigned macOS app with the native callback | `pnpm package:mac` |
| Launch the locally packaged macOS app | `pnpm start:mac` |
| Run the dogfood verification gate | `pnpm dogfood:verify` |

Run `pnpm convex:codegen` with development-deployment access after adding or removing a Convex
function module. The release gate detects a stale committed module map without requiring CI or a
tester to hold Convex credentials. Generated build output under `out/` should never be edited by
hand.

## Tests

Tests are colocated with their source. The main coverage groups are:

- `convex/chat.test.ts`: auth/allowlist behavior, channels, membership, unread state, messages,
  replies, reactions, and attachments;
- `src/renderer/workspace-chat.test.tsx`: shared chat behavior using plain active-chat fixtures;
- `src/renderer/dogfood-chat.test.tsx`: plain Convex-to-active-chat adaptation and authenticated app states;
- `scripts/check-convex-bindings.test.ts`: offline stale Convex module-binding detection;
- `src/renderer/dogfood-distribution.test.ts`: structured checks for public friend-beta environment
  values and the packaged app identity;
- `src/main/auth-callback.test.ts` and the auth-policy tests: native callback handling and URL
  restrictions; and
- `src/renderer/message-interactions.test.ts`: selection, editing, deletion, and context-menu state
  using plain active-chat messages.

`pnpm dogfood:verify` is the complete automated friend-beta gate: root and Convex typechecks,
generated-binding validation, ESLint (including React Hooks), unused production dependency analysis,
the full test suite, and the production build. CI runs the same command after a frozen install on the
pinned Node and pnpm versions. The operator-only remote/tag and two-account checks remain documented
manual release steps because they require repository authority and two real AuthKit accounts.

## Documentation

- [`docs/architecture-decisions.md`](docs/architecture-decisions.md): consolidated implemented and
  parked architecture decisions, including the retained agent-collaboration model.
- [`docs/agent-runtime-contract.md`](docs/agent-runtime-contract.md): COL-21's Convex-native agent
  seam, legacy RPC inventory, field dispositions, and serializable error contract.
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
