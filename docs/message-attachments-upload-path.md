# Message Attachments Upload Path

## Decision

Dogfood chat attachments use Convex file storage for bytes and store only bounded metadata on the
message document.

The renderer asks `chat.generateAttachmentUploadUrl` for a short-lived Convex upload URL, uploads
the selected `File` directly to that URL, then calls `chat.sendMessage` with the returned
`storageId` and display filename. The mutation validates the storage id against Convex's `_storage`
system table, derives content type, size, and `file`/`image` kind server-side, and persists that
metadata on the message.

Timeline reads hydrate each stored attachment with `ctx.storage.getUrl(storageId)`. Those signed
URLs are treated as display-only values; the renderer never stores them back into message state.

## Rationale

- Chat mutations stay small and avoid carrying file bytes through Convex document writes.
- The server remains the source of truth for file metadata instead of trusting browser-supplied
  size or content type values.
- Attachment metadata is bounded to four files per message, which keeps message documents well below
  Convex document limits for this MVP.
- Missing or expired signed URLs degrade to file metadata in the timeline instead of breaking the
  message row.

## Current Limits

- Attachments are scoped to dogfood Convex chat.
- Upload authorization is the existing dogfood allowlist and channel membership flow.
- The UI supports image thumbnails and file links, but does not yet support drag-and-drop,
  progress percentages, attachment deletion from storage, or previews for non-image formats.
