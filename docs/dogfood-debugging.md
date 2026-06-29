# Dogfood Debugging Guide

Use this guide when the Convex/AuthKit dogfood chat fails during sign-in, channel join, or message actions.

## What to collect

- The visible error text and diagnostic code, such as `VIEWER-ABC123` or `MUTATION-ABC123`.
- The local time of the failure.
- The action that failed: sign-in, join, send, edit, delete, reaction, or attachment upload.
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
- If the app shows `Waiting for your AuthKit session to reach Convex...` for more than a few seconds, retry sign-in.

## Developer diagnostics

Renderer failures log `Dogfood chat diagnostic` in the dev console with:

- `context`: the failing UI path.
- `diagnostic.code`: the short code visible in the UI.
- `diagnostic.at`: an ISO timestamp.
- `message`: the sanitized client error message.

Convex function failures log `Dogfood Convex function failed` with:

- `operation`: the Convex function that failed.
- `context`: safe IDs, counts, or lengths such as `channelId`, `messageId`, `bodyLength`, and `attachmentCount`.
- `error`: the thrown error message.

These logs intentionally avoid emails, token identifiers, raw auth claims, API keys, and environment values. Treat any new diagnostic field as public-support-safe before adding it.
