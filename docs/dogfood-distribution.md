# Dogfood Distribution Path

## Shared Deployment Decision

The friend beta uses the Aether project's production deployment as one shared backend:

- deployment: `polished-bison-174` (Aether Friend Beta)
- public client URL: `https://polished-bison-174.convex.cloud`
- data boundary: one shared workspace, channel/message store, and dogfood allowlist

Every tester checkout uses that same URL. Testers do not run `pnpm convex:dev`, create a Convex
deployment, join the Convex team, or receive a deploy key. A production deployment is intentional:
Convex redacts unexpected server errors to a generic `Server Error` for clients while retaining full
details in operator-only deployment logs.

Aether remains checkout-based for this beta. The repository does not contain signing, installer, or
updater infrastructure; `pnpm build` and `pnpm start` verify the production bundle but do not create
a distributable app.

## Tester Startup

Use exactly Node.js 22.23.1 and pnpm 11.7.0. Node is pinned in `.nvmrc`, and pnpm is pinned by the
`packageManager` field in `package.json`.

```sh
corepack enable
corepack install
node --version # v22.23.1
pnpm --version # 11.7.0
pnpm install
cp .env.example .env.local
pnpm dev
```

The checked-in `.env.example` contains only the public renderer configuration for Aether Friend
Beta. It is ready to copy without editing. In particular, it contains no `CONVEX_DEPLOYMENT`,
`CONVEX_DEPLOY_KEY`, WorkOS API key, operator key, or allowlist contents.

If any required `VITE_` value is missing, the app shows a configuration-required state instead of
opening chat. The old local Electron RPC implementation remains test-only and is not a runtime
fallback.

To update a tester checkout:

```sh
git pull
pnpm install
pnpm dev
```

Tester startup and update never require the Convex CLI to contact or modify a deployment.

## Deployment Operator Runbook

Only a Convex team operator performs this section. Start from a clean checkout at the revision being
released and keep production credentials out of the repository, shell history, screenshots, Linear,
and tester instructions.

### First deployment

1. Verify the release locally:

   ```sh
   pnpm install
   pnpm dogfood:verify
   pnpm convex:codegen
   ```

2. Configure the production deployment's server-side environment. Use interactive input or another
   approved secret store; never put values in a committed file:

   ```sh
   pnpm convex env set --prod WORKOS_API_KEY
   pnpm convex env set --prod WORKOS_CLIENT_ID
   pnpm convex env set --prod WORKOS_ENVIRONMENT_ID
   pnpm convex env set --prod AETHER_ALLOWLIST_OPERATOR_KEY
   # Optional emergency bootstrap only:
   pnpm convex env set --prod AETHER_ALLOWED_EMAILS
   pnpm convex env list --prod --names-only
   ```

3. Deploy functions, schema, and auth configuration once to the shared production deployment:

   ```sh
   pnpm convex deploy --message "Aether Friend Beta initial deployment"
   ```

4. Manage friend access against production using
   [`docs/dogfood-allowlist.md`](dogfood-allowlist.md), then execute the two-account gate in
   [`docs/dogfood-smoke-test.md`](dogfood-smoke-test.md).

### Updates

Deploy backend-compatible changes before asking testers to pull a client that depends on them:

```sh
git pull
pnpm install
pnpm dogfood:verify
pnpm convex:codegen
pnpm convex deploy --message "Aether Friend Beta update <revision>"
```

Record the deployed Git revision and smoke-test evidence. Do not give testers the operator checkout,
Convex dashboard access, or deployment credentials.

### Rollback

Use a separate clean operator checkout at the recorded last-known-good revision. Confirm its schema
accepts the current production data, run `pnpm dogfood:verify`, then run `pnpm convex deploy` from
that revision with a rollback message. Convex code deploys do not rewind data. Any schema/data
rollback must be designed as a forward-compatible migration; restore or transform data separately
rather than deleting the shared deployment.

After rollback, repeat the two-account smoke gate before reopening the beta. If the last-known-good
schema cannot accept current data, stop traffic and prepare a compatible forward fix instead of
forcing the old schema.

## Reproducible Release Check

Before every handoff or deployment, run:

```sh
pnpm dogfood:verify
```

The script runs `pnpm typecheck`, `pnpm test`, and `pnpm build`. `pnpm build` regenerates output under
`out/`; that directory remains generated build output and must not be edited by hand.

## Secret Boundary

Public tester values are limited to `VITE_CONVEX_URL`, `VITE_WORKOS_CLIENT_ID`,
`VITE_WORKOS_REDIRECT_URI`, and optional UI flags. Never commit or distribute `.env.local`,
`CONVEX_DEPLOYMENT`, `CONVEX_DEPLOY_KEY`, WorkOS secrets, operator keys, webhook secrets, cookies,
or auth/session tokens.

## Exit Criteria For Packaging

A packaging follow-up should decide signing, notarization, update behavior, artifact hosting, and
production Convex/AuthKit ownership together.
