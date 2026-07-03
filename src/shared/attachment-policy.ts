export const MESSAGE_ATTACHMENT_POLICY = {
  maxFiles: 4,
  maxNameLength: 180,
  maxSizeBytes: 25 * 1024 * 1024,
  acceptedContentTypes: [
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "text/plain"
  ]
} as const

export const isAcceptedAttachmentContentType = (contentType: string): boolean =>
  MESSAGE_ATTACHMENT_POLICY.acceptedContentTypes.some((accepted) => accepted === contentType.toLowerCase())
