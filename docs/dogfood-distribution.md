# Dogfood Distribution Path

## Decision

Aether's current dogfood distribution path is checkout-based. Dogfood users run the Electron/Vite
app locally against a shared Convex deployment with Convex-managed WorkOS AuthKit.

The repository does not contain signing, installer, or updater infrastructure. `pnpm build` and
`pnpm start` are useful for production-bundle checks, but they do not create a distributable app.

## Deployment Operator Setup

The deployment operator owns Convex code sync and server-side secrets:

```sh
pnpm install
pnpm convex:dev
pnpm convex env set AETHER_ALLOWLIST_OPERATOR_KEY "<shared-operator-key>"
```

Add users through the audited flow in [`docs/dogfood-allowlist.md`](dogfood-allowlist.md). Do not
share the operator key or Convex deployment credentials with ordinary dogfood users.

## Dogfood User Setup

Give each dogfood user access to the repository and ask them to install from the checkout:

```sh
pnpm install
cp .env.example .env.local
```

Fill `.env.local` with the Convex-managed values for:

- `VITE_CONVEX_URL`
- `VITE_WORKOS_CLIENT_ID`
- `VITE_WORKOS_REDIRECT_URI`

Keep `VITE_WORKOS_REDIRECT_URI` set to `aether://auth/callback` unless the AuthKit configuration is
changed deliberately.

Packaged and preview builds use the same native callback value. The tested deep-link behavior is
documented in [`docs/packaged-authkit-callback.md`](packaged-authkit-callback.md).

`AETHER_ALLOWED_EMAILS` is still supported as a bootstrap list, but regular add/remove operations
should use the audited Convex flow in [`docs/dogfood-allowlist.md`](dogfood-allowlist.md).

Use `docs/dogfood-smoke-test.md` after setup to confirm sign-in, allowlist behavior, realtime sends,
mutation failures, and sign-out.

If any of the required `VITE_` values are missing, `pnpm dev` shows a configuration-required state
instead of opening chat. The old local Electron RPC implementation remains test-only and is not a
runtime fallback.

## Running And Updating

Start the app from the checkout:

```sh
pnpm dev
```

To update an existing dogfood checkout:

```sh
git pull
pnpm install
pnpm dogfood:verify
pnpm dev
```

The deployment operator must sync Convex changes before users exercise new backend behavior. Run
`pnpm convex:codegen` after schema or public function changes and before `pnpm dogfood:verify`.

## Reproducible Build Check

Before handing a revision to dogfood users, run:

```sh
pnpm dogfood:verify
```

The script runs `pnpm typecheck`, `pnpm test`, and `pnpm build`. `pnpm build` regenerates the
Electron/Vite output under `out/`; that directory remains generated build output and should not be
edited by hand.

## Secret Handling

Never commit `.env.local`, WorkOS secrets, Convex deploy keys, webhook secrets, cookie passwords, or
raw auth/session tokens.

Only `VITE_` values needed by the renderer belong in `.env.local`, and server-side dogfood access
state belongs in Convex environment variables. If a setup step requires a secret, share it out of
band and keep it out of screenshots, docs comments, Linear comments, and Git history.

## Exit Criteria For Packaging

A packaging follow-up should decide signing, notarization, update behavior, artifact hosting, and
production Convex/AuthKit ownership together.
