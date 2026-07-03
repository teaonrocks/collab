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
| Architecture, runtime details, and test map | `README.md` |
| Package scripts and pinned dependencies | `package.json` |
| Electron/Vite entrypoints | `electron.vite.config.ts` |
| Vitest setup | `vitest.config.ts` |

## Project Layout
- `src/shared/`: transport-neutral policy shared across Electron boundaries.
- `src/main/`: Electron startup, authentication callback coordination, and security policy.
- `src/preload/`: isolated bridge for approved native shell operations.
- `src/renderer/`: React UI, AuthKit/Convex integration, and the plain active-chat adapter.
- Tests live next to covered code as `*.test.ts` or `*.test.tsx`.

## Key Conventions
- Treat Convex validators and generated function types as the backend contract source of truth.
- Keep shared UI code depending on the plain types in `src/renderer/chat-data.ts`; production mapping belongs in `src/renderer/dogfood-chat-adapter.ts`.
- Keep local JSON and the retired Effect RPC transport out of production and tests; future agent work is Convex-native per `docs/agent-runtime-contract.md`.
- Keep expected command errors as serializable plain data rather than `Error` instances.
- Do not edit generated build output under `out/`; regenerate it with `pnpm build`.
- Add or update colocated tests for changed Convex contracts, Electron boundaries, adapters, or UI behavior.



<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
