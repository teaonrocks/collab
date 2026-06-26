# Local JSON Chat Fallback Retirement

## Decision

Remove the local JSON chat fallback from the runtime app.

The Convex/AuthKit dogfood app is the only runtime chat surface. Aether starts dogfood mode only when
all required renderer environment values are configured:

- `VITE_CONVEX_URL`
- `VITE_WORKOS_CLIENT_ID`
- `VITE_WORKOS_REDIRECT_URI`

When any value is missing, the renderer shows a configuration-required state instead of mounting the
old local Electron RPC chat. The Electron main process also no longer starts the filesystem-backed
collaboration RPC server during app boot, so `app.getPath("userData")/aether-collab.json` is not a
runtime source of chat data.

## Preserved Fixtures

The local snapshot modules remain in the repository as legacy fixtures and test coverage:

- `src/main/collab-repo.ts` preserves the seeded `CollabSnapshot` store and repo behavior for
  colocated tests.
- `src/main/collab-handlers.ts`, `src/main/ipc-server.ts`, and `src/renderer/collab-api-live.ts`
  preserve the old RPC transport boundary for tests and future reference.
- `src/renderer/App.tsx` remains covered by renderer tests as the snapshot-era chat surface.

These modules should not be wired back into production startup without a new decision.

## Migration Choice

Do not migrate existing `aether-collab.json` messages into Convex for this dogfood milestone.
Convex starts fresh and remains authoritative for dogfood chat history.

If local import is later requested, it should be explicit and idempotent:

- Map the seeded local workspace/channel to the shared Convex workspace/channel deliberately.
- Preserve local ids only as optional metadata for debugging.
- Never auto-upload local messages during normal app startup.
- Keep the import command or UI separate from regular dogfood sign-in.

## Development Workflow

- Use `pnpm convex:dev`, `.env.local`, and `docs/dogfood-smoke-test.md` for Convex/AuthKit dogfood
  work.
- Use the preserved colocated tests for snapshot-era repo, transport, atom, and renderer coverage.
- Use `pnpm dogfood:verify` before handing a revision to dogfood users.

Seeing the configuration-required state means dogfood environment setup is incomplete. Seeing the
seeded `Aether Labs` workspace or `#origination` channel should only happen in tests or deliberately
importing legacy modules, not during normal app startup.
