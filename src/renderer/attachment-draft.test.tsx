// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MESSAGE_ATTACHMENT_POLICY } from "../shared/attachment-policy"
import type { ChatMessageAttachment } from "./chat-data"
import { uploadAttachment, useAttachmentDraft } from "./attachment-draft"

afterEach(() => vi.unstubAllGlobals())

const attachment = (id: string): ChatMessageAttachment => ({
  id,
  storageId: id,
  name: `${id}.png`,
  contentType: "image/png",
  size: 5,
  kind: "image",
  url: null
})

const imageFile = (name: string): File => new File([name], name, { type: "image/png" })

describe("attachment draft lifecycle", () => {
  it("preflights the shared count, size, and content-type policy", async () => {
    const upload = vi.fn((file: File) => Promise.resolve(attachment(file.name)))
    const reportError = vi.fn()
    const { result } = renderHook(() => useAttachmentDraft({ channelId: "general", upload, reportError }))

    act(() => result.current.choose([new File(["zip"], "archive.zip", { type: "application/zip" })]))
    expect(upload).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenLastCalledWith(expect.stringMatching(/must be PNG/))

    const oversized = new File(["x"], "large.png", { type: "image/png" })
    Object.defineProperty(oversized, "size", { value: MESSAGE_ATTACHMENT_POLICY.maxSizeBytes + 1 })
    act(() => result.current.choose([oversized]))
    expect(upload).not.toHaveBeenCalled()

    act(() => result.current.choose(Array.from(
      { length: MESSAGE_ATTACHMENT_POLICY.maxFiles + 1 },
      (_, index) => imageFile(`${index}.png`)
    )))
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(MESSAGE_ATTACHMENT_POLICY.maxFiles))
    await waitFor(() => expect(result.current.attachments).toHaveLength(MESSAGE_ATTACHMENT_POLICY.maxFiles))
  })

  it("adds a successful upload batch", async () => {
    const reportError = vi.fn()
    const upload = vi.fn()
      .mockResolvedValueOnce(attachment("one"))
      .mockResolvedValueOnce(attachment("two"))
    const { result } = renderHook(() => useAttachmentDraft({ channelId: "general", upload, reportError }))

    act(() => result.current.choose([imageFile("one.png"), imageFile("two.png")]))

    await waitFor(() => expect(result.current.attachments.map(({ id }) => id)).toEqual(["one", "two"]))
    expect(reportError).toHaveBeenLastCalledWith(null)
  })

  it("cleans successful uploads when a batch partially fails", async () => {
    const uploaded = attachment("one")
    const upload = vi.fn()
      .mockResolvedValueOnce(uploaded)
      .mockRejectedValueOnce(new Error("upload failed"))
    const discard = vi.fn(() => Promise.resolve())
    const reportError = vi.fn()
    const { result } = renderHook(() => useAttachmentDraft({ channelId: "general", upload, discard, reportError }))

    act(() => result.current.choose([imageFile("one.png"), imageFile("two.png")]))

    await waitFor(() => expect(discard).toHaveBeenCalledWith(uploaded))
    expect(result.current.attachments).toEqual([])
    expect(reportError).toHaveBeenLastCalledWith(expect.stringMatching(/Could not upload attachment/))
  })

  it("discards an upload that completes after a channel switch", async () => {
    let finishUpload!: (value: ChatMessageAttachment) => void
    const upload = vi.fn(() => new Promise<ChatMessageAttachment>((resolve) => { finishUpload = resolve }))
    const discard = vi.fn(() => Promise.resolve())
    const reportError = vi.fn()
    const { result, rerender } = renderHook(
      ({ channelId }) => useAttachmentDraft({ channelId, upload, discard, reportError }),
      { initialProps: { channelId: "general" } }
    )
    act(() => result.current.choose([imageFile("late.png")]))

    rerender({ channelId: "design" })
    await act(async () => finishUpload(attachment("late")))

    await waitFor(() => expect(discard).toHaveBeenCalledWith(attachment("late")))
    expect(result.current.attachments).toEqual([])
  })

  it("deletes an explicitly removed upload and all remaining uploads on unmount", async () => {
    const first = attachment("one")
    const second = attachment("two")
    const upload = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const discard = vi.fn(() => Promise.resolve())
    const reportError = vi.fn()
    const { result, unmount } = renderHook(() => useAttachmentDraft({ channelId: "general", upload, discard, reportError }))
    act(() => result.current.choose([imageFile("one.png"), imageFile("two.png")]))
    await waitFor(() => expect(result.current.attachments).toHaveLength(2))

    act(() => result.current.remove("one"))
    expect(discard).toHaveBeenCalledWith(first)
    unmount()
    expect(discard).toHaveBeenCalledWith(second)
  })

  it("clears attachments after send success and retains them after send failure", async () => {
    const uploaded = attachment("one")
    const upload = vi.fn().mockResolvedValue(uploaded)
    const errorMessage = vi.fn(() => "Could not send message.")
    const reportError = vi.fn()
    const { result } = renderHook(() => useAttachmentDraft({
      channelId: "general",
      upload,
      operationErrorMessage: errorMessage,
      reportError
    }))
    act(() => result.current.choose([imageFile("one.png")]))
    await waitFor(() => expect(result.current.attachments).toEqual([uploaded]))

    await act(async () => {
      expect(await result.current.send(() => Promise.reject(new Error("offline")))).toBe("failure")
    })
    expect(result.current.attachments).toEqual([uploaded])
    expect(reportError).toHaveBeenLastCalledWith("Could not send message.")

    await act(async () => {
      expect(await result.current.send((items) => Promise.resolve(items))).toBe("success")
    })
    expect(result.current.attachments).toEqual([])
    expect(reportError).toHaveBeenLastCalledWith(null)
  })

  it("retries registration and deletes the unshared object after terminal failure", async () => {
    const register = vi.fn().mockRejectedValue(new Error("registration unavailable"))
    const deleteUpload = vi.fn(() => Promise.resolve())
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ storageId: "storage-1" })
    }))

    await expect(uploadAttachment({
      file: imageFile("brief.png"),
      generateUploadUrl: () => Promise.resolve({ uploadUrl: "https://upload.example", intentId: "intent-1" }),
      register,
      deleteUpload,
      storageIdFromResponse: (body) => (body as { storageId: string }).storageId,
      storageIdToString: String
    })).rejects.toThrow("registration unavailable")

    expect(register).toHaveBeenCalledTimes(3)
    expect(deleteUpload).toHaveBeenCalledWith({ intentId: "intent-1", storageId: "storage-1" })
  })
})
