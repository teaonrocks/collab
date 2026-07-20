import { describe, expect, it } from "vitest"
import { MESSAGE_ATTACHMENT_POLICY, validateAttachmentMetadata } from "./attachment-policy"

describe("attachment metadata policy", () => {
  it("normalizes accepted content types and rejects unsupported or oversized files", () => {
    expect(validateAttachmentMetadata({ size: 5 }, "IMAGE/PNG")).toBe("image/png")
    expect(() => validateAttachmentMetadata({ size: 5 }, "application/zip")).toThrow(
      "Attachments must be a PNG, JPEG, GIF, WebP, PDF, or plain-text file"
    )
    expect(() => validateAttachmentMetadata({ size: MESSAGE_ATTACHMENT_POLICY.maxSizeBytes + 1 }, "image/png")).toThrow(
      "Attachments can be at most 25 MB"
    )
  })
})
