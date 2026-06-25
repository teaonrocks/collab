# Dogfood Smoke Test

Use this checklist for the Convex/AuthKit dogfood chat path. Keep secrets out of screenshots and notes.

## Setup

- Start the app with `pnpm dev`.
- Confirm the Convex deployment and WorkOS/AuthKit configuration are already set in the local environment.
- Use two allowlisted accounts in separate app/browser sessions.

## Checklist

- Signed-out users see the Aether Dogfood sign-in screen.
- Sign-in opens AuthKit in the system browser and returns to the app.
- A non-allowlisted account sees a compact access error and can sign out.
- An allowlisted account joins the shared `#general` channel.
- The first empty channel state invites the user to start the conversation.
- Messages sent from one account appear in realtime for the other account.
- Send failures show a compact retryable error near the composer.
- Only the author sees edit and delete actions for their message.
- Enter saves an edit; Shift+Enter inserts a newline.
- Edited messages show an `edited` marker after realtime sync.
- Delete asks for confirmation, then hard-deletes the message for both users.
- Edit and delete failures show compact retryable errors without raw internal details.
- Signing out from the profile menu returns to the sign-in state.

## Common Failure States

- `Waiting for your AuthKit session to reach Convex...`: AuthKit is signed in, but Convex has not received a valid auth token yet. Wait briefly, then retry sign-in if it does not recover.
- `Could Not Join`: the viewer setup action failed. Check allowlist membership and local Convex/AuthKit environment configuration.
- `Could not send message`: the mutation failed or the client lost connectivity. Keep the draft, reconnect, and send again.
- `Could not save edit`: the edit did not persist. The editor stays open so the user can retry.
- `Could not delete message`: the delete did not persist. The confirmation dialog stays open so the user can retry or cancel.
