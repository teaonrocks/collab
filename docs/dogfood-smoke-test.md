# Dogfood Smoke Test

Use this checklist for the Convex/AuthKit dogfood chat path. Keep secrets out of screenshots and notes.
For failure capture and recovery, see [`docs/dogfood-debugging.md`](dogfood-debugging.md).

## Setup

- Use two clean tester checkouts with `.env.local` copied from the checked-in `.env.example`.
- Confirm both checkouts use `https://polished-bison-174.convex.cloud`; neither checkout may contain
  `CONVEX_DEPLOYMENT` or `CONVEX_DEPLOY_KEY`, and neither tester needs Convex team access.
- Start both apps with `pnpm dev` without running `pnpm convex:dev`.
- Use two different allowlisted accounts in separate app/browser sessions.

## Checklist

- Signed-out users see the Aether Dogfood sign-in screen.
- Sign-in opens AuthKit in the system browser and returns to the app.
- In preview or packaged-style builds, the `aether://auth/callback` deep link focuses Aether and
  completes the AuthKit callback without opening unsupported external URLs.
- A non-allowlisted account sees a compact access error and can sign out.
- An allowlisted account joins the shared `#general` channel.
- Public channel creation is visible to the other account; selecting it joins the viewer before
  messages load.
- Private channel creation requires at least the creator and may include eligible initial members;
  the creator becomes a channel admin and initial invitees see the channel without restarting.
- Private channels never appear in a non-member's channel list or unread/mention indicators.
- A private-channel admin can add an eligible workspace member later; the channel, member list,
  history, and subsequent realtime messages appear without restarting. Existing history is readable,
  but the new member begins with no unread or mention indicator for messages sent before the grant.
- Messages and attachments posted after a member is added appear in realtime and are accessible to
  that member. Record attachment access with a harmless test file, not a sensitive document.
- A private-channel admin can remove a member later. The removed account loses the channel from its
  list and indicators and cannot read/search messages, fetch members, send/edit/delete messages,
  react, mark the channel read, or obtain fresh attachment URLs. The channel history and stored
  attachments remain available to members who retain access.
- After removal, do not treat a previously copied attachment URL as proof of membership. Convex
  storage URLs are bearer URLs and may remain usable until the object is deleted; the security
  boundary prevents the removed account from obtaining a new URL through Aether.
- Direct messages are user-scoped conversations between exactly two allowlisted workspace members.
  Starting the same pair from either account opens the same conversation and never auto-joins a
  public channel.
- Direct messages support the same message actions as channels: send, pagination, edit, delete,
  shallow replies, reactions, search, attachments, realtime updates, and read markers.
- Direct-message unread indicators live in the global rail, survive channel switching and loading
  states, and clear only after that direct message is read.
- `@name` text inside a direct message stays plain message text for now. It does not create a
  channel-style mention indicator or notification.
- A non-participant cannot discover a direct message through channel lists, direct-message lists,
  unread indicators, search, member queries, diagnostics, guessed IDs, or fresh attachment URL
  hydration.
- The first empty channel state invites the user to start the conversation.
- Messages sent from one account appear in realtime for the other account.
- Inactive channels show unread state, and a matching `@name` mention takes priority over unread.
- Channel search filters the current timeline and keyboard navigation focuses matching messages.
- Reply mode preserves the draft, sends a shallow parent link, and renders a compact parent preview.
- Reactions update in realtime and show whether the current user reacted.
- Image and file attachments upload, render safely, and remain associated with the sent message.
- Send failures show a compact retryable error near the composer.
- Only the author sees edit and delete actions for their message.
- Enter saves an edit; Shift+Enter inserts a newline.
- Edited messages show an `edited` marker after realtime sync.
- Delete asks for confirmation, then hard-deletes the message for both users.
- Edit and delete failures show compact retryable errors without raw internal details.
- Signing out from the profile menu returns to the sign-in state.

## Shared-Deployment Acceptance Record

Record this evidence without email addresses, tokens, keys, or environment-file screenshots:

- Exact tested Git commit, immutable friend-beta tag, CI run URL, and UTC timestamp.
- Tester A and Tester B both reported deployment `polished-bison-174`.
- Tester A created or selected a channel that appeared for Tester B.
- A message from each account appeared in realtime in the other checkout without refresh.
- Tester A created a private channel with Tester B as an initial invitee; Tester B saw it without
  refresh while a non-member account, if available, could not discover it through lists or indicators.
- Tester A created a second private channel alone, then added Tester B later. Tester B saw the grant
  without restart, could read existing history with no historical unread/mention indicator, then saw
  a new mention and harmless attachment in realtime.
- Tester A removed Tester B. Tester B lost the channel without restart and could no longer open its
  history, search, member list, composer actions, reactions, read state, or a fresh attachment link;
  Tester A confirmed that the messages and attachment still existed.
- An allowlist add or removal made by the operator against `--prod` affected the intended account in
  both checkouts.
- Tester A and Tester B each started the same direct-message pair; both sides landed in one shared
  conversation with no split history.
- A direct-message send from each account appeared in realtime for the other account. Channel to DM
  to channel switching preserved the global direct-message rail, cleared target-scoped drafts,
  replies, search, and pending attachments, and never invoked public-channel auto-join.
- Direct-message unread state appeared only for the recipient, survived unrelated channel switches,
  cleared when that DM was read, and did not become a mention indicator for `@name` text.
- A harmless direct-message attachment was readable by both participants through Aether, while a
  non-participant could not obtain a fresh attachment URL or discover the conversation.
- Reload or reconnect preserved the same direct-message identity and history for the two
  participants.
- Neither tester ran a Convex command or had Convex team access.
- Unexpected server failures shown to testers contained only production-safe generic detail; the
  operator correlated the full detail in production logs.

Do not mark this record complete from automated tests alone. Record which two AuthKit accounts ran
the flow, the tested revision, UTC time, deployment, and any skipped step. Never record credentials,
tokens, email addresses, or copied attachment URLs.

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
- If manually setting `data-aether-theme` to `light` or `dark`, verify foreground, border,
  destructive, unread, and mention states remain readable. There is no user-facing theme switch yet.

## Residual Visual Risks

- Happy DOM coverage verifies semantics and class wiring, but it does not catch pixel-level spacing, z-index, or responsive overflow regressions.
- Manual smoke passes should include at least one dense message channel and one empty/loading channel because those states stress the migrated layout differently.

## Common Failure States

- `Waiting for your AuthKit session to reach Convex...`: AuthKit is signed in, but Convex has not received a valid auth token yet. Wait briefly, then retry sign-in if it does not recover.
- `Could Not Join`: the viewer setup action failed. Record the diagnostic code, then check allowlist membership and local Convex/AuthKit environment configuration.
- `Could not send message`: the mutation failed or the client lost connectivity. Record the diagnostic code, keep the draft, reconnect, and send again.
- `Could not save edit`: the edit did not persist. Record the diagnostic code; the editor stays open so the user can retry.
- `Could not delete message`: the delete did not persist. Record the diagnostic code; the confirmation dialog stays open so the user can retry or cancel.
