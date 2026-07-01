# Packaged AuthKit Callback Flow

## Decision

Aether uses system-browser AuthKit sign-in with a native deep link back to Electron:

```text
aether://auth/callback
```

The callback policy lives in `src/shared/auth-redirect-policy.ts` so the main process, preload bridge,
and renderer fallback all use the same URL allowlist. AuthKit authorize URLs are allowed only when
they use the expected authorize path, `provider=authkit`, `response_type=code`, a `client_` id, and a
redirect URI that is either the native Aether callback or a local development callback. Other
external URLs stay blocked before they reach `shell.openExternal`.

## Packaged App Behavior

Packaged builds use the unique bundle identifier `com.aether.chat`, declare `aether` in the app's
`Info.plist`, and register it as the app protocol. When the OS opens
`aether://auth/callback?code=...`, the Electron main process:

- rejects anything that is not the strict native callback shape;
- queues the callback if the renderer window does not exist yet;
- focuses the existing window when possible;
- loads the renderer entrypoint with the callback query parameters.

AuthKit's browser client only handles a redirect when the current page pathname matches its
configured `redirectUri` pathname. In packaged Electron, the page is the built renderer file, not
`/callback`, so the renderer temporarily gives AuthKit the current file URL while it is landing on a
native callback. Normal sign-in URL generation continues to use `VITE_WORKOS_REDIRECT_URI`, which
should remain `aether://auth/callback`.

Sign-out passes the current app page without callback query parameters as AuthKit's `returnTo` value
so a packaged window can return to the local renderer after logout instead of staying on a hosted
logout page.

## Manual Smoke Check

Use this after `pnpm package:mac` and `pnpm start:mac` when the dogfood environment values are
present. `pnpm dev` uses Electron's generic macOS bundle identity and is not a valid native callback
smoke test when more than one Electron checkout is registered with Launch Services.

1. Confirm the WorkOS/AuthKit configuration includes `aether://auth/callback` as an allowed redirect
   URI.
2. Start the built app and click Sign in.
3. Confirm AuthKit opens in the system browser.
4. Complete sign-in and confirm the OS deep link returns to Aether.
5. Quit Aether, open a fresh `aether://auth/callback?code=fake` URL, then confirm the app opens or
   focuses without navigating to an arbitrary external URL.
6. Sign out from the profile menu and confirm the app returns to the signed-out state.

Do not share raw callback URLs from a real sign-in because they contain short-lived auth material.
