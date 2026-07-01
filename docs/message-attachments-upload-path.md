# Message Attachments Upload Path

## Decision

Dogfood chat attachments use Convex file storage for bytes and store only bounded metadata on the
message document.

The renderer asks `chat.generateAttachmentUploadUrl` for a short-lived Convex upload URL, uploads
the selected `File` directly to that URL, registers the returned storage id to the authenticated
uploader, then calls `chat.sendMessage` with the returned
`storageId` and display filename. The mutation validates the storage id against Convex's `_storage`
system table, derives content type, size, and `file`/`image` kind server-side, and persists that
metadata on the message.

Each file is limited to 25 MB. Allowed types are PNG, JPEG, GIF, WebP, PDF, and plain text. The UI
preflights the same policy, while Convex enforces it from the stored size and registered type.
Registered uploads may be claimed exactly once and only by their uploader.

Timeline reads hydrate each stored attachment with `ctx.storage.getUrl(storageId)`. Those signed
URLs are treated as display-only values; the renderer never stores them back into message state.
They are bearer URLs: private-channel membership is checked when reading the timeline, but a URL
that has already been issued is not membership-checked on each use. It remains usable by anyone
who has it until the underlying storage object is deleted.

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
- Upload authorization uses the dogfood allowlist; claiming an upload additionally requires channel
  membership and uploader ownership.
- Removing a composer attachment, switching channels, unmounting the composer, or a partial batch
  failure deletes unclaimed uploads. A scheduled 24-hour cleanup covers abandoned sessions.
- Deleting a message deletes its stored objects and invalidates their previously issued URLs.
- Storage ids are single-use, preventing shared references from making cleanup ambiguous.
- The UI supports image thumbnails and file links, but does not yet support drag-and-drop,
  progress percentages or previews for non-image formats.
