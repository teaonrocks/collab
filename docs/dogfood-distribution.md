# Dogfood Distribution Path

## Decision

Aether's current dogfood distribution path is dev-only. Dogfood users run the Electron/Vite app from
the local checkout with the Convex development deployment and Convex-managed WorkOS AuthKit.

Do not produce signed installers, auto-updaters, or packaged artifacts for this milestone. The app
does not yet have packaging configuration, updater infrastructure, or packaged AuthKit hardening, and
the accepted dogfood ADR explicitly allows the first shared chat loop to prove itself without
packaged app delivery.

## Installer Setup

Give each dogfood user access to the repository and ask them to install from the checkout:

```sh
pnpm install
cp .env.example .env.local
pnpm convex:dev
```

Fill `.env.local` with the Convex-managed values for:

- `VITE_CONVEX_URL`
- `VITE_WORKOS_CLIENT_ID`
- `VITE_WORKOS_REDIRECT_URI`

Keep `VITE_WORKOS_REDIRECT_URI` set to `aether://auth/callback` unless the AuthKit configuration is
changed deliberately.

The dogfood allowlist stays in Convex environment state, not in the renderer bundle:

```sh
pnpm convex env set AETHER_ALLOWED_EMAILS "you@example.com,friend@example.com"
```

Use `docs/dogfood-smoke-test.md` after setup to confirm sign-in, allowlist behavior, realtime sends,
mutation failures, and sign-out.

If any of the required `VITE_` values are missing, `pnpm dev` shows a configuration-required state
instead of opening chat. The old local Electron RPC fallback has been removed from runtime startup;
see
[`docs/local-json-fallback-retirement.md`](local-json-fallback-retirement.md).

## Running And Updating

Start the app from the checkout:

```sh
pnpm dev
```

To update an existing dogfood install:

```sh
git pull
pnpm install
pnpm dogfood:verify
pnpm dev
```

If Convex schema or generated API files changed, run `pnpm convex:codegen` after `pnpm install` and
before `pnpm dogfood:verify`.

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

Revisit signed builds or packaged artifacts only after the dogfood chat loop is worth carrying
forward and the packaged AuthKit path is explicitly tested. That follow-up should decide signing,
notarization, update behavior, packaged deep-link auth, and production Convex/AuthKit ownership
together instead of adding a partial installer now.
