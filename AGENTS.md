# Agent Instructions

## Package Manager
- Use **pnpm**: `pnpm install`

## Commands
| Task | Command |
|------|---------|
| Dev app | `pnpm dev` |
| Test file | `pnpm vitest run src/path/to/file.test.ts` |
| Test suite | `pnpm test` |
| Typecheck | `pnpm typecheck` |
| Build | `pnpm build` |
| Preview build | `pnpm start` |

## External References
| Need | File |
|------|------|
| Architecture, transport details, and test map | `README.md` |
| Package scripts and pinned Effect/Electron deps | `package.json` |
| Electron/Vite entrypoints | `electron.vite.config.ts` |
| Vitest setup | `vitest.config.ts` |

## Project Layout
- `src/shared/`: RPC contract and shared client transport types.
- `src/main/`: Electron main process, RPC server transport, collaboration repo, and handlers.
- `src/preload/`: isolated preload bridge for the transferred `MessagePort`.
- `src/renderer/`: React UI, effect-atom atoms, and renderer RPC API adapter.
- Tests live next to covered code as `*.test.ts` or `*.test.tsx`.

## Key Conventions
- Treat `src/shared/collab-rpc.ts` as the wire contract source of truth for payloads, successes, streams, and typed errors.
- Keep renderer code depending on `CollabApi`; production wiring belongs in `src/renderer/collab-api-live.ts`.
- Keep main-side business logic behind `CollabRepo` and expose it through `CollabHandlersLive`.
- Preserve the MessagePort handoff pattern described in `README.md` when touching IPC transport code.
- Keep typed RPC errors serializable across MsgPack; avoid non-enumerable `Error` fields in schema error payloads.
- Do not edit generated build output under `out/`; regenerate it with `pnpm build`.
- Add or update colocated tests for changed RPC contracts, transport behavior, repo persistence, atoms, or UI behavior.

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: (the agent's name and attribution byline)
```
