export const MESSAGE_ATTACHMENT_POLICY = {
  maxFiles: 4,
  maxNameLength: 180,
  maxSizeBytes: 25 * 1024 * 1024,
  acceptedContentTypes: ["image/gif", "image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"]
} as const

export const isAcceptedAttachmentContentType = (contentType: string): boolean =>
  MESSAGE_ATTACHMENT_POLICY.acceptedContentTypes.some((accepted) => accepted === contentType.toLowerCase())

export const validateAttachmentMetadata = (
  metadata: { readonly size: number },
  declaredContentType?: string
): string => {
  if (metadata.size > MESSAGE_ATTACHMENT_POLICY.maxSizeBytes) {
    throw new Error("Attachments can be at most 25 MB")
  }
  const contentType = declaredContentType?.toLowerCase()
  if (contentType === undefined || !isAcceptedAttachmentContentType(contentType)) {
    throw new Error("Attachments must be a PNG, JPEG, GIF, WebP, PDF, or plain-text file")
  }
  return contentType
}
