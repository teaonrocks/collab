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

The pending Add account flow opens the same hosted AuthKit URL through macOS Authentication
Services. Aether's small native helper starts an `ASWebAuthenticationSession` with an ephemeral
browser session, so WorkOS and upstream identity-provider cookies are not silently reused and no
Incognito window or browser-specific command-line flags are needed. The helper returns only the
native callback to the Electron process that started it. Normal sign-in continues to use the
default browser session.

The authentication UI is owned by macOS. Safari honors the ephemeral request; another selected
browser may decide how to present the system web-authentication session. The authorization URL is
sent to the helper over stdin rather than command-line arguments, and Electron accepts only a
strict `aether://auth/callback` response.

## Packaged App Behavior

Packaged builds use the unique bundle identifier `com.aether.chat`, declare `aether` in the app's
`Info.plist`, and register it as the app protocol. When the OS opens
`aether://auth/callback?code=...`, the Electron main process:

- rejects anything that is not the strict native callback shape;
- queues the callback if the renderer window does not exist yet;
- reads the opaque Aether window/account identifiers echoed through OAuth state;
- returns the callback to the exact window and account partition that initiated sign-in;
- focuses that window when possible;
- loads the renderer entrypoint with the callback query parameters.

Development runs on macOS intentionally do not register the protocol. The generic `Electron.app`
bundle has no durable app entrypoint when Launch Services opens it, so allowing `pnpm dev` to claim
the scheme can produce Electron's default "no app was supplied" screen. Use the packaged app for
callback smoke testing.

`pnpm build` compiles the helper as a universal macOS app for Apple Silicon and Intel. Packaging
copies it into `Aether.app/Contents/Resources/native` and includes it in the app's signing pass.

AuthKit's browser client only handles a redirect when the current page pathname matches its
configured `redirectUri` pathname. In packaged Electron, the page is the built renderer file, not
`/callback`, so the renderer temporarily gives AuthKit the current file URL while it is landing on a
native callback. Normal sign-in URL generation continues to use `VITE_WORKOS_REDIRECT_URI`, which
should remain `aether://auth/callback`.

Each saved account uses a separate persistent Electron session partition. The initial account keeps
the historical default partition so an existing installation does not lose its current sign-in.
The display-only account registry lives under Electron's `userData` directory and never contains
access or refresh tokens. Switching accounts replaces only the initiating window with one bound to
the selected partition; other windows remain untouched.

Removing an account first asks AuthKit to end the current session without navigation, then clears
that account partition and moves every window using it to another saved account. Sign out all clears
every saved partition and returns all open windows to a fresh signed-out default account.

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
6. From the bottom-left profile avatar, choose Add account. Confirm macOS presents a fresh,
   system-managed web authentication session, then complete sign-in with a second account. A
   non-Safari default browser may label this ephemeral system session as private or Incognito.
7. Open a second window with `Cmd+N`; confirm it inherits the focused window's account.
8. Switch only the second window to the other saved account and confirm the first window is unchanged.
9. Quit and reopen Aether; confirm both accounts remain available without signing in again.
10. Sign out the active account and confirm every window using it moves to another saved account.
11. Choose Sign out all accounts and confirm every open window returns to the signed-out state.

Do not share raw callback URLs from a real sign-in because they contain short-lived auth material.
