# Message Replies Decision

## Status

Accepted for the Collaboration Depth milestone.

This note settles COL-19 and defines the implementation target for COL-33. It covers human chat
message replies only. Agent run threads, draft agent threads, run context review, and agent follow-up
conversation remain out of scope for this decision.

## Context

Aether is moving toward a real dogfood chat loop with Convex-backed realtime messages. The product
also has older agent collaboration scaffolding that uses the word `Thread` for agent runs and draft
run contexts. Reusing that agent-thread model for human replies would overcouple two different
behaviors:

- Human replies help a channel conversation keep local context without leaving the main timeline.
- Agent run threads are execution containers with source channels, visibility policies, selected
  context, runs, provenance, and audit history.

For the chat dogfood milestone, Aether needs lightweight message replies before it needs full
Slack-style side threads or agent run threads.

## Decision

Implement replies as a shallow message relationship, not as a separate thread container.

A reply is a normal channel message with an optional parent channel message. Replies appear in the
same channel timeline as regular messages. The UI should show a compact quote/reference to the
parent message above the reply body, including the parent author and a short body preview.

This intentionally chooses "reply to message" over "open a thread." The product language should use
`reply`, `parent message`, and `reply preview` for this human-chat feature. Reserve `thread` for the
agent/run domain until Aether deliberately introduces a richer human thread container later.

## Desired Behavior

- A user can choose Reply from a message action menu.
- The composer enters reply mode with the selected parent message preview visible near the composer.
- Sending while in reply mode creates a new channel message linked to the parent.
- Canceling reply mode returns the composer to normal message mode without changing draft text.
- A reply renders inline in the channel timeline with a small parent preview above the reply body.
- The parent preview includes parent author display name and a trimmed single-line body preview.
- Clicking or keyboard-activating the parent preview should eventually focus or scroll to the parent
  message when it is present in the current timeline window.
- If the parent message is deleted, missing, or not visible to the viewer, the reply remains visible
  and shows an unavailable/deleted parent state instead of leaking hidden body text.
- Reply counts can be derived later for parent messages, but they are not required for the first
  reply implementation.
- Replies do not create separate read states, notification channels, membership, retention policies,
  or permission surfaces.

## Data Model Impact

Add an optional parent pointer to channel messages.

Convex `messages` should gain:

- `parentMessageId?: Id<"messages">`
- index `by_parent_message`, with fields `["parentMessageId"]`, if reply counts or parent-specific
  lookups are implemented

The send mutation should accept an optional `parentMessageId`, validate that the parent message:

- exists
- belongs to the same workspace and channel as the reply
- is visible to the current channel member

The returned message view should include enough parent summary data for the timeline to render
without a client-side N+1 query. A compact view is enough:

- `parentMessage?: { id, authorDisplayName, bodyPreview, deleted }`

The local RPC fallback model can mirror this with an optional `parentMessageId` on `ChannelMessage`
and a derived parent summary in the renderer if needed. Do not reuse the existing `Thread` or
`ThreadMessage` types for human replies.

## API And UI Impact

Renderer chat APIs should extend message creation with an optional `parentMessageId`:

```ts
createChannelMessage({
  channelId,
  body,
  parentMessageId
})
```

The chat UI needs three small states:

- selected reply parent
- composer reply preview/cancel affordance
- per-message parent preview rendering

Message grouping should treat a reply like any other channel message for author grouping, with the
parent preview inside the message body area. Reactions, edit, delete, selection, search, and copy
continue to operate on the reply message itself.

## Out Of Scope

- Side-panel thread views
- Nested replies beyond one parent pointer
- Moving messages into or out of a thread
- Separate thread membership or subscription state
- Separate thread unread state
- Agent run threads, draft agent threads, or agent follow-up prompts
- Attachments inside replies beyond whatever the base message attachment model later supports

## Prototype Decision

Do not prototype in COL-19.

The decision is clear enough to implement directly in COL-33, and a partial prototype would require
touching the Convex schema, send mutation, local RPC fallback, renderer chat API, and timeline UI.
Those changes belong together in the implementation ticket so tests can cover the end-to-end reply
behavior rather than a disposable spike.
