# Message Replies

## Status

Implemented. This decision covers human chat replies only; agent run threads remain a separate
domain.

## Decision

A reply is a normal channel message with an optional parent message, not a separate thread
container. Replies stay in the channel timeline and render a compact parent author/body preview
above their own content.

Use `reply`, `parent message`, and `reply preview` for this feature. Reserve `thread` for a future
conversation container or the agent/run domain.

## Behavior

- Reply from a message action puts the composer into reply mode.
- Canceling reply mode preserves the current draft.
- Sending creates a normal message with the selected `parentMessageId`.
- Activating a visible parent preview focuses the parent in the current timeline.
- A missing or deleted parent produces an unavailable preview without hiding the reply.
- Search, selection, copy, edit, delete, reactions, and attachments operate on the reply itself.
- Replies have no separate membership, unread state, notifications, or retention policy.

## Data And API Shape

`convex/schema.ts` stores `messages.parentMessageId?: Id<"messages">` and indexes it with
`by_parent_message`. `chat.sendMessage` validates that the parent exists in the same workspace and
channel before inserting the reply.

Message reads return a compact parent view with the parent id, author display name, body preview,
and deleted state. This avoids a renderer-side query per reply. The renderer sends the relationship
through the chat adapter:

```ts
createChannelMessage({
  channelId,
  body,
  parentMessageId
})
```

The preserved snapshot-era `ChannelMessage` type mirrors the optional parent id for shared UI test
coverage. It is not an active persistence model, and its `Thread`/`ThreadMessage` types must not be
used for human replies.

## Deliberate Limits

- one parent pointer only; no nested reply tree;
- no side-panel thread view or reply count;
- no separate subscriptions or thread unread state; and
- no coupling to agent run threads or draft run contexts.
