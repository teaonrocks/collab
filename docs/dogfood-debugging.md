# Dogfood Debugging Guide

Use this guide when the Convex/AuthKit dogfood chat fails during sign-in, channel join, direct-message
startup, or message actions.

## What to collect

- The visible error text and diagnostic code, such as `VIEWER-ABC123` or `MUTATION-ABC123`.
- The local time of the failure.
- The action that failed: sign-in, join, direct-message start, send, edit, delete, reaction, read
  marker, search, or attachment upload.
- Whether retrying recovered the app.

Do not share `.env.local`, WorkOS secrets, Convex deploy keys, auth tokens, cookies, raw callback URLs, or screenshots that expose private email addresses.

## Recovery path

- For sign-in failures, try Sign in again. If AuthKit opens but Convex does not authenticate, sign out and start over.
- If a packaged or preview callback opens the app but leaves you signed out, confirm
  `VITE_WORKOS_REDIRECT_URI` and the WorkOS/AuthKit allowed redirect URI are both
  `aether://auth/callback`.
- For `Could Not Join`, use Try again after confirming the account is allowlisted and `.env.local`
  points to the shared Aether Friend Beta deployment.
- For send, edit, delete, reaction, or attachment failures, keep the draft, editor, or dialog open, reconnect, then retry the same action.
- For direct-message startup failures, retry from the global rail. Starting the same pair is
  idempotent; a retry should return the existing conversation rather than creating split history.
- If an older packaged build logs `Missing refresh token` and remains at
  `Waiting for your AuthKit session to reach Convex...`, rebuild and restart the packaged app. Sign
  in once more if that partition was already left without a refresh token. Updated packaged builds
  retain the rotating token in the account's persistent Electron partition and should recover from
  normal Convex reconnects and app restarts without another sign-in.

## Developer diagnostics

Renderer failures log `Dogfood chat diagnostic` in the dev console with:

- `context`: the failing UI path.
- `diagnostic.code`: the short code visible in the UI.
- `diagnostic.at`: an ISO timestamp.
- `message`: only the error kind plus an explicit `details redacted` marker.

Convex function failures log `Dogfood Convex function failed` with:

- `operation`: the Convex function that failed.
- `context`: safe IDs, counts, or lengths such as `channelId`, `messageId`, `bodyLength`, and `attachmentCount`.
- `error`: only the error kind plus an explicit redaction and support guidance.

These friend-shareable logs intentionally avoid URLs, emails, token identifiers, raw auth claims,
API keys, environment values, backend messages, and synthetic secret text. Render-boundary failures
show a compact generic message, diagnostic code, and Reload chat recovery action. Treat any new
diagnostic field as public-support-safe before adding it.
