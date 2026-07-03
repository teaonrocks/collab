import { useCallback, useEffect, useRef, useState } from "react"
import { isAcceptedAttachmentContentType, MESSAGE_ATTACHMENT_POLICY } from "../shared/attachment-policy"
import type {
  ChatChannelId,
  ChatMessageAttachment,
  ChatOperationErrorMessage,
  UploadChatMessageAttachment
} from "./chat-data"

const ATTACHMENT_REGISTRATION_ATTEMPTS = 3
const attachmentPolicyError =
  "Attachments must be PNG, JPEG, GIF, WebP, PDF, or plain text and no larger than 25 MB."

type AttachmentDraftOptions = {
  readonly channelId: ChatChannelId
  readonly upload?: UploadChatMessageAttachment
  readonly discard?: (attachment: ChatMessageAttachment) => Promise<unknown>
  readonly operationErrorMessage?: ChatOperationErrorMessage
  readonly reportError: (message: string | null) => void
}

export type AttachmentDraft = {
  readonly attachments: ReadonlyArray<ChatMessageAttachment>
  readonly uploading: boolean
  readonly uploadAvailable: boolean
  readonly choose: (files: ReadonlyArray<File>) => void
  readonly remove: (attachmentId: string) => void
  readonly send: (
    operation: (attachments: ReadonlyArray<ChatMessageAttachment>) => Promise<unknown>
  ) => Promise<"success" | "failure" | "stale">
}

export const useAttachmentDraft = (options: AttachmentDraftOptions): AttachmentDraft => {
  const { channelId, upload, discard, operationErrorMessage, reportError } = options
  const [attachments, setAttachments] = useState<ReadonlyArray<ChatMessageAttachment>>([])
  const [uploading, setUploading] = useState(false)
  const scopeRef = useRef({ channelId, generation: 0 })
  if (scopeRef.current.channelId !== channelId) {
    scopeRef.current = { channelId, generation: scopeRef.current.generation + 1 }
  }
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const discardRef = useRef(discard)
  discardRef.current = discard

  const discardAll = useCallback((items: ReadonlyArray<ChatMessageAttachment>) => {
    for (const attachment of items) void discardRef.current?.(attachment).catch(() => {})
  }, [])

  useEffect(() => {
    discardAll(attachmentsRef.current)
    attachmentsRef.current = []
    setAttachments([])
    reportError(null)
    setUploading(false)
  }, [channelId, discardAll, reportError])

  useEffect(() => () => discardAll(attachmentsRef.current), [discardAll])

  const choose = useCallback((files: ReadonlyArray<File>) => {
    if (upload === undefined || files.length === 0) return
    const slots = MESSAGE_ATTACHMENT_POLICY.maxFiles - attachmentsRef.current.length
    const selectedFiles = files.slice(0, Math.max(0, slots))
    if (selectedFiles.length === 0 || selectedFiles.length < files.length) {
      reportError(`Messages can include at most ${MESSAGE_ATTACHMENT_POLICY.maxFiles} attachments.`)
      if (selectedFiles.length === 0) return
    } else {
      reportError(null)
    }
    if (selectedFiles.some((file) =>
      file.size > MESSAGE_ATTACHMENT_POLICY.maxSizeBytes || !isAcceptedAttachmentContentType(file.type)
    )) {
      reportError(attachmentPolicyError)
      return
    }

    const generation = scopeRef.current.generation
    setUploading(true)
    void Promise.allSettled(selectedFiles.map((file) => upload(file)))
      .then(async (results) => {
        const uploaded = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
        if (scopeRef.current.generation !== generation) {
          await Promise.allSettled(uploaded.map((attachment) => discardRef.current?.(attachment)))
          return
        }
        if (results.some((result) => result.status === "rejected")) {
          await Promise.allSettled(uploaded.map((attachment) => discardRef.current?.(attachment)))
          throw new Error("One or more attachment uploads failed")
        }
        const next = [...attachmentsRef.current, ...uploaded].slice(0, MESSAGE_ATTACHMENT_POLICY.maxFiles)
        attachmentsRef.current = next
        setAttachments(next)
        reportError(null)
      })
      .catch((cause: unknown) => {
        if (scopeRef.current.generation === generation) {
          reportError(operationErrorMessage?.("attach", cause) ??
            "Could not upload attachment. Check your connection and try again.")
        }
      })
      .finally(() => {
        if (scopeRef.current.generation === generation) setUploading(false)
      })
  }, [operationErrorMessage, reportError, upload])

  const remove = useCallback((attachmentId: string) => {
    const removed = attachmentsRef.current.find((attachment) => attachment.id === attachmentId)
    if (removed === undefined) return
    const next = attachmentsRef.current.filter((attachment) => attachment.id !== attachmentId)
    attachmentsRef.current = next
    setAttachments(next)
    void discardRef.current?.(removed).catch(() => {})
  }, [])

  const send = useCallback(async (
    operation: (items: ReadonlyArray<ChatMessageAttachment>) => Promise<unknown>
  ): Promise<"success" | "failure" | "stale"> => {
    const generation = scopeRef.current.generation
    const items = attachmentsRef.current
    reportError(null)
    try {
      await operation(items)
      if (scopeRef.current.generation !== generation) return "stale"
      attachmentsRef.current = []
      setAttachments([])
      return "success"
    } catch (cause) {
      if (scopeRef.current.generation !== generation) return "stale"
      reportError(operationErrorMessage?.("send", cause) ?? null)
      return "failure"
    }
  }, [operationErrorMessage, reportError])

  return {
    attachments,
    uploading,
    uploadAvailable: upload !== undefined,
    choose,
    remove,
    send
  }
}

export const uploadAttachment = async <IntentId, StorageId>(input: {
  readonly file: File
  readonly generateUploadUrl: () => Promise<{ readonly uploadUrl: string; readonly intentId: IntentId }>
  readonly register: (registration: {
    readonly intentId: IntentId
    readonly storageId: StorageId
    readonly contentType: string
  }) => Promise<{ readonly status: "registered" } | { readonly status: "rejected"; readonly reason: string }>
  readonly deleteUpload: (upload: { readonly intentId: IntentId; readonly storageId: StorageId }) => Promise<unknown>
  readonly storageIdFromResponse: (body: unknown) => StorageId
  readonly rememberStorageId: (storageId: StorageId) => void
  readonly storageIdToString: (storageId: StorageId) => string
}): Promise<ChatMessageAttachment> => {
  const { uploadUrl, intentId } = await input.generateUploadUrl()
  const contentType = input.file.type.length === 0 ? "application/octet-stream" : input.file.type
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: input.file
  })
  if (!response.ok) throw new Error(`Attachment upload failed (${response.status})`)

  const storageId = input.storageIdFromResponse(await response.json())
  input.rememberStorageId(storageId)
  let registration: Awaited<ReturnType<typeof input.register>> | undefined
  let registrationFailure: unknown
  for (let attempt = 0; attempt < ATTACHMENT_REGISTRATION_ATTEMPTS && registration === undefined; attempt += 1) {
    try {
      registration = await input.register({ intentId, storageId, contentType })
    } catch (cause) {
      registrationFailure = cause
    }
  }
  if (registration === undefined || registration.status === "rejected") {
    await input.deleteUpload({ intentId, storageId }).catch(() => {})
    if (registration?.status === "rejected") throw new Error(registration.reason)
    throw registrationFailure instanceof Error ? registrationFailure : new Error("Attachment registration failed")
  }

  const stringStorageId = input.storageIdToString(storageId)
  return {
    id: stringStorageId,
    storageId: stringStorageId,
    name: input.file.name.trim().length === 0 ? "attachment" : input.file.name,
    contentType,
    size: input.file.size,
    kind: contentType.toLowerCase().startsWith("image/") ? "image" : "file",
    url: null
  }
}
