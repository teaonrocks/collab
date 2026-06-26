# Dogfood Smoke Test

Use this checklist for the Convex/AuthKit dogfood chat path. Keep secrets out of screenshots and notes.
For failure capture and recovery, see [`docs/dogfood-debugging.md`](dogfood-debugging.md).

## Setup

- Start the app with `pnpm dev`.
- Confirm the Convex deployment and WorkOS/AuthKit configuration are already set in the local environment.
- Use two allowlisted accounts in separate app/browser sessions.

## Checklist

- Signed-out users see the Aether Dogfood sign-in screen.
- Sign-in opens AuthKit in the system browser and returns to the app.
- In preview or packaged-style builds, the `aether://auth/callback` deep link focuses Aether and
  completes the AuthKit callback without opening unsupported external URLs.
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

## UI Migration Checks

- The app shell uses the migrated quiet UI surfaces: rail, channel sidebar, chat pane, and member panel have consistent borders, muted surfaces, and no legacy gradient/card chrome.
- Icon-only controls expose useful labels: add channel, member panel toggle, send message, attachment, message actions, and profile menu.
- Channel creation opens a centered dialog, keeps the create button disabled until the name is non-empty after trimming, and clears the draft after canceling.
- Message action menus stay aligned to the selected row, expose select/copy/edit/delete actions, and do not show edit/delete for another user's message.
- Inline edit focuses the textarea, Enter saves, Shift+Enter keeps a newline in the editor, and Escape returns to the original message without saving.
- Delete confirmation uses the migrated dialog styling, keeps focus in the dialog, and leaves the dialog open on a failed delete.
- Loading skeletons animate in the chat timeline and member panel without shifting the composer or sidebars.

## Viewport Checks

- At 1280 px or wider, verify rail, sidebar, chat, and member panel are all visible and the composer stays pinned to the bottom.
- At 920 px or narrower, verify the channel sidebar and member panel collapse while the rail, header, chat timeline, and composer remain usable.
- At a short viewport height, verify message scrolling is contained to the timeline and dialogs remain centered without clipping their actions.
- Toggle light and dark theme attributes if testing them manually; color tokens should keep readable foreground, border, destructive, unread, and mention states.

## Residual Visual Risks

- Happy DOM coverage verifies semantics and class wiring, but it does not catch pixel-level spacing, z-index, or responsive overflow regressions.
- Manual smoke passes should include at least one dense message channel and one empty/loading channel because those states stress the migrated layout differently.

## Common Failure States

- `Waiting for your AuthKit session to reach Convex...`: AuthKit is signed in, but Convex has not received a valid auth token yet. Wait briefly, then retry sign-in if it does not recover.
- `Could Not Join`: the viewer setup action failed. Record the diagnostic code, then check allowlist membership and local Convex/AuthKit environment configuration.
- `Could not send message`: the mutation failed or the client lost connectivity. Record the diagnostic code, keep the draft, reconnect, and send again.
- `Could not save edit`: the edit did not persist. Record the diagnostic code; the editor stays open so the user can retry.
- `Could not delete message`: the delete did not persist. Record the diagnostic code; the confirmation dialog stays open so the user can retry or cancel.
