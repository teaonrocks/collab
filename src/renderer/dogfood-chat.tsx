import { useAuth } from "@workos-inc/authkit-react"
import { useAction, useConvex, useConvexAuth, useMutation, usePaginatedQuery, useQuery } from "convex/react"
import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { ChatMessageAttachment } from "./chat-data"
import { authKitSignOutReturnTo } from "./authkit-redirect"
import {
  dogfoodChatToChatData,
  type DogfoodChannelMemberView,
  type DogfoodChannelMessageView,
  type DogfoodChannelView,
  type DogfoodWorkspaceView
} from "./dogfood-chat-adapter"
import { openExternalUrl } from "./electron-shell"
import { WorkspaceChat } from "./workspace-chat"

export { dogfoodChatToChatData } from "./dogfood-chat-adapter"
export type {
  DogfoodChannelMemberView,
  DogfoodChannelMessageView,
  DogfoodChannelView,
  DogfoodMessageAttachmentView,
  DogfoodWorkspaceView
} from "./dogfood-chat-adapter"

type ConvexDogfoodError = {
  readonly message: string
  readonly diagnostic?: DogfoodDiagnostic
}

type DogfoodOperation = "send" | "edit" | "delete" | "react" | "attach"
type DogfoodMessageReactionEmoji = "👍" | "🎉" | "👀"
type DogfoodDiagnostic = {
  readonly code: string
  readonly at: string
  readonly source: "auth" | "viewer" | "channel" | "mutation" | "render"
  readonly retry: "sign-in" | "try-again" | "automatic" | "message-action"
}
const dogfoodShellClassName =
  "loadingShell grid min-h-screen w-full place-items-center overflow-hidden bg-surface-canvas p-6 font-sans text-foreground"
const dogfoodAuthPanelClassName =
  "dogfoodAuthPanel flex w-[min(420px,100%)] flex-col items-start gap-3.5 rounded-card border border-border bg-surface-canvas p-5 shadow-panel [&_div]:m-0 [&_div]:text-sm [&_div]:leading-[1.45] [&_div]:text-foreground-muted [&_h1]:m-0 [&_h1]:text-lg [&_h1]:leading-tight [&_h1]:text-foreground [&_p]:m-0 [&_p]:text-sm [&_p]:leading-[1.45] [&_p]:text-foreground-muted"
const dogfoodPlainStateClassName =
  "dogfoodPlainState flex w-[min(420px,100%)] flex-col items-center gap-4 text-center [&_div]:m-0 [&_div]:flex [&_div]:h-10 [&_div]:items-center [&_div]:justify-center [&_div]:text-sm [&_div]:leading-[1.45] [&_div]:text-foreground-muted [&_h1]:m-0 [&_h1]:text-lg [&_h1]:leading-tight [&_h1]:text-foreground"
const dogfoodPrimaryButtonClassName =
  "dogfoodPrimaryButton min-h-9 cursor-pointer rounded-panel border border-foreground-strong bg-foreground-strong px-3.5 font-[inherit] font-bold text-foreground-inverse disabled:cursor-default disabled:border-foreground-subtle disabled:bg-foreground-subtle"
const dogfoodSecondaryButtonClassName =
  "dogfoodSecondaryButton min-h-9 cursor-pointer rounded-panel border border-border-strong bg-surface-canvas px-3.5 font-[inherit] font-bold text-foreground"

export function ConvexDogfoodApp() {
  return (
    <DogfoodErrorBoundary>
      <ConvexDogfoodChat />
    </DogfoodErrorBoundary>
  )
}

function ConvexDogfoodChat() {
  const auth = useAuth()
  const convex = useConvex()
  const convexAuth = useConvexAuth()
  const ensureViewer = useAction(api.chat.ensureViewer)
  const sendMessage = useMutation(api.chat.sendMessage)
  const editMessage = useMutation(api.chat.editMessage)
  const deleteMessage = useMutation(api.chat.deleteMessage)
  const toggleMessageReaction = useMutation(api.chat.toggleMessageReaction)
  const createChannel = useMutation(api.chat.createChannel)
  const ensureChannelMember = useMutation(api.chat.ensureChannelMember)
  const markChannelRead = useMutation(api.chat.markChannelRead)
  const generateAttachmentUploadUrl = useMutation(api.chat.generateAttachmentUploadUrl)
  const registerAttachmentUpload = useMutation(api.chat.registerAttachmentUpload)
  const deleteAttachmentUpload = useMutation(api.chat.deleteAttachmentUpload)
  const [ensuredUserId, setEnsuredUserId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<Id<"channels"> | null>(null)
  const [joinedChannelIds, setJoinedChannelIds] = useState<ReadonlySet<Id<"channels">>>(() => new Set())
  const [createdChannels, setCreatedChannels] = useState<ReadonlyArray<DogfoodChannelView>>([])
  const [error, setError] = useState<ConvexDogfoodError | null>(null)
  const [signInOpening, setSignInOpening] = useState(false)
  const [ensureAttempt, setEnsureAttempt] = useState(0)
  const lastReadMarkerRef = useRef<string | null>(null)
  const storageIdsRef = useRef(new Map<string, Id<"_storage">>())
  const authUserId = auth.user?.id ?? null
  const sessionReady = authUserId !== null && convexAuth.isAuthenticated
  const viewerReady = sessionReady && ensuredUserId === authUserId && error === null
  const workspace = useQuery(api.chat.defaultWorkspace, viewerReady ? {} : "skip")
  const channels = useQuery(
    api.chat.channels,
    workspace === undefined || workspace === null ? "skip" : { workspaceId: workspace.workspace.id }
  )
  const channelList = useMemo(
    () => channels === undefined ? undefined : mergeDogfoodChannels(channels, createdChannels),
    [channels, createdChannels]
  )
  const activeChannelId = selectedChannelId ?? workspace?.channel.id
  const activeChannelJoined = activeChannelId === undefined ? false : joinedChannelIds.has(activeChannelId)
  const messagePagination = usePaginatedQuery(
    api.chat.channelMessages,
    activeChannelId === undefined || !activeChannelJoined ? "skip" : { channelId: activeChannelId },
    { initialNumItems: 50 }
  )
  const messages = useMemo(
    () => [...messagePagination.results].reverse(),
    [messagePagination.results]
  )
  const members = useQuery(
    api.chat.channelMembers,
    activeChannelId === undefined || !activeChannelJoined ? "skip" : { channelId: activeChannelId }
  )
  const channelIndicators = useQuery(
    api.chat.channelIndicators,
    workspace === undefined || workspace === null ? "skip" : { workspaceId: workspace.workspace.id }
  )

  useEffect(() => {
    if (workspace === undefined || workspace === null) return
    setJoinedChannelIds((existing) => {
      if (existing.has(workspace.channel.id)) return existing
      return new Set([...existing, workspace.channel.id])
    })
  }, [workspace])

  useEffect(() => {
    if (!viewerReady || activeChannelId === undefined || activeChannelJoined) return

    let cancelled = false
    void ensureChannelMember({ channelId: activeChannelId })
      .then(() => {
        if (cancelled) return
        setJoinedChannelIds((existing) => {
          if (existing.has(activeChannelId)) return existing
          return new Set([...existing, activeChannelId])
        })
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          const diagnostic = dogfoodDiagnostic("channel", "try-again", cause)
          logDogfoodDiagnostic("channel", cause, diagnostic)
          setError({ message: dogfoodAccessErrorMessage(cause), diagnostic })
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeChannelId, activeChannelJoined, ensureChannelMember, viewerReady])

  useEffect(() => {
    if (!viewerReady || activeChannelId === undefined || !activeChannelJoined || messagePagination.status === "LoadingFirstPage") return
    const readThroughMessageId = latestMessageId(messages)
    if (readThroughMessageId === null) return
    const readMarker = `${activeChannelId}:${readThroughMessageId}`
    if (lastReadMarkerRef.current === readMarker) return
    lastReadMarkerRef.current = readMarker

    void markChannelRead({ channelId: activeChannelId, readThroughMessageId }).catch((cause: unknown) => {
      logDogfoodDiagnostic("read-marker", cause, dogfoodDiagnostic("mutation", "try-again", cause))
    })
  }, [activeChannelId, activeChannelJoined, markChannelRead, messagePagination.status, messages, viewerReady])

  useEffect(() => {
    if (workspace === undefined || workspace === null || channelList === undefined) return
    if (selectedChannelId === null) return
    if (channelList.some((channel) => channel.id === selectedChannelId)) return
    setSelectedChannelId(workspace.channel.id)
  }, [channelList, selectedChannelId, workspace])

  useEffect(() => {
    const user = auth.user
    if (auth.isLoading || convexAuth.isLoading || !convexAuth.isAuthenticated || user === null || ensuredUserId === user.id) {
      return
    }

    let cancelled = false
    void ensureViewer({})
      .then(() => {
        if (!cancelled) {
          setEnsuredUserId(user.id)
          setError(null)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          const diagnostic = dogfoodDiagnostic("viewer", "try-again", cause)
          logDogfoodDiagnostic("viewer", cause, diagnostic)
          setError({ message: dogfoodAccessErrorMessage(cause), diagnostic })
        }
      })

    return () => {
      cancelled = true
    }
  }, [auth.isLoading, auth.user, convexAuth.isAuthenticated, convexAuth.isLoading, ensureAttempt, ensureViewer, ensuredUserId])

  const model = useMemo(
    () => workspace === undefined || workspace === null || channelList === undefined || activeChannelId === undefined
      ? null
      : dogfoodChatToChatData({
          workspace,
          channels: channelList,
          selectedChannelId: activeChannelId,
          messages,
          members: members ?? [],
          channelIndicators: channelIndicators ?? [],
          messagesLoading: messagePagination.status === "LoadingFirstPage",
          messagesHasMore: messagePagination.status === "CanLoadMore" || messagePagination.status === "LoadingMore",
          messagesLoadingMore: messagePagination.status === "LoadingMore",
          loadOlderMessages: () => messagePagination.loadMore(50),
          membersLoading: members === undefined,
          createChannel: async (input) => {
            const channel = await createChannel(input)
            setCreatedChannels((existing) => mergeDogfoodChannels(existing, [channel]))
            setJoinedChannelIds((existing) => new Set([...existing, channel.id]))
            setSelectedChannelId(channel.id)
            return channel
          },
          selectChannel: (channelId) => setSelectedChannelId(channelId),
          sendMessage,
          uploadMessageAttachment: (file) => uploadDogfoodAttachment(
            generateAttachmentUploadUrl,
            registerAttachmentUpload,
            deleteAttachmentUpload,
            storageIdsRef.current,
            file
          ),
          discardMessageAttachment: (attachment) => deleteAttachmentUpload({
            storageId: requiredStorageId(storageIdsRef.current, attachment.storageId)
          }),
          resolveStorageId: (storageId) => requiredStorageId(storageIdsRef.current, storageId),
          editMessage,
          deleteMessage,
          toggleMessageReaction: ({ channelId, messageId, emoji }) => toggleMessageReaction({
            channelId,
            messageId,
            emoji: toDogfoodMessageReactionEmoji(emoji)
          }),
          searchMessages: (input) => convex.query(api.chat.searchChannelMessages, input),
          operationErrorMessage: dogfoodOperationErrorMessage
        }),
    [activeChannelId, channelIndicators, channelList, convex, createChannel, deleteAttachmentUpload, deleteMessage, editMessage, generateAttachmentUploadUrl, members, messagePagination, messages, registerAttachmentUpload, sendMessage, toggleMessageReaction, workspace]
  )

  if (auth.isLoading) {
    return <DogfoodShell title="Checking Session" variant="plain">Loading your Aether session...</DogfoodShell>
  }

  if (auth.user === null) {
    return (
      <DogfoodShell title="Welcome to Aether" variant="plain">
        <button
          type="button"
          className={dogfoodPrimaryButtonClassName}
          disabled={signInOpening}
          onClick={() => void signInInDefaultBrowser(auth, setSignInOpening, setError)}
        >
          {signInOpening ? "Opening browser..." : "Sign in"}
        </button>
      </DogfoodShell>
    )
  }

  if (!convexAuth.isAuthenticated) {
    return <DogfoodShell title="Checking Session" variant="plain">Waiting for your AuthKit session to reach Convex...</DogfoodShell>
  }

  if (error !== null) {
    return (
      <DogfoodShell title="Could Not Join">
        <p className="errorText max-w-[min(720px,calc(100vw-48px))] [overflow-wrap:anywhere] text-destructive-text">{error.message}</p>
        {error.diagnostic === undefined ? null : <DogfoodDiagnosticDetails diagnostic={error.diagnostic} />}
        <button
          type="button"
          className={dogfoodPrimaryButtonClassName}
          onClick={() => {
            setError(null)
            setEnsuredUserId(null)
            setEnsureAttempt((attempt) => attempt + 1)
          }}
        >
          Try again
        </button>
        <button type="button" className={dogfoodSecondaryButtonClassName} onClick={() => auth.signOut()}>
          Sign out
        </button>
      </DogfoodShell>
    )
  }

  if (!viewerReady) {
    return (
      <DogfoodShell title="Preparing Workspace" variant="plain">
        {ensureAttempt > 0
          ? "Retrying dogfood access and reconnecting to the shared channel..."
          : "Checking your dogfood access and setting up the shared channel..."}
      </DogfoodShell>
    )
  }

  if (workspace === null) {
    return <DogfoodShell title="Preparing Workspace" variant="plain">Setting up the shared channel...</DogfoodShell>
  }

  if (model === null) {
    return <DogfoodShell title="Loading Chat" variant="plain">Waiting for realtime messages...</DogfoodShell>
  }

  return (
    <WorkspaceChat
      {...model}
      profileMenuActions={[{ label: "Sign out", onSelect: () => auth.signOut({ returnTo: authKitSignOutReturnTo() }) }]}
    />
  )
}

const signInInDefaultBrowser = async (
  auth: ReturnType<typeof useAuth>,
  setSignInOpening: (opening: boolean) => void,
  setError: (error: ConvexDogfoodError | null) => void
) => {
  setSignInOpening(true)
  setError(null)
  try {
    const url = await auth.getSignInUrl()
    await openExternalUrl(url)
  } catch (cause) {
    const diagnostic = dogfoodDiagnostic("auth", "sign-in", cause)
    logDogfoodDiagnostic("auth", cause, diagnostic)
    setError({ message: signInErrorMessage(cause), diagnostic })
  } finally {
    setSignInOpening(false)
  }
}

function DogfoodDiagnosticDetails(props: { readonly diagnostic: DogfoodDiagnostic }) {
  return (
    <dl className="grid gap-1 rounded-panel border border-border bg-surface-muted p-3 text-xs leading-[1.4] text-foreground-muted">
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        <dt className="font-bold text-foreground">Diagnostic</dt>
        <dd className="font-mono">{props.diagnostic.code}</dd>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        <dt>When</dt>
        <dd>{props.diagnostic.at}</dd>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        <dt>Recovery</dt>
        <dd>{dogfoodDiagnosticRecovery(props.diagnostic.retry)}</dd>
      </div>
    </dl>
  )
}

function DogfoodShell(props: {
  readonly title: string
  readonly children: ReactNode
  readonly variant?: "panel" | "plain"
}) {
  return (
    <main className={dogfoodShellClassName}>
      <section className={props.variant === "plain" ? dogfoodPlainStateClassName : dogfoodAuthPanelClassName} aria-live="polite">
        {props.variant === "plain" ? null : <span className="text-xs font-bold uppercase tracking-[0.08em] text-foreground-subtle">Aether Dogfood</span>}
        <h1>{props.title}</h1>
        <div>{props.children}</div>
      </section>
    </main>
  )
}

export class DogfoodErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly message: string | null }
> {
  state = { message: null }

  static getDerivedStateFromError(error: unknown) {
    return { message: errorMessage(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const diagnostic = dogfoodDiagnostic("render", "try-again", error)
    console.error("Dogfood chat failed", supportSafeDiagnostic(error), {
      diagnostic,
      componentStackPresent: (info.componentStack?.length ?? 0) > 0
    })
  }

  render() {
    if (this.state.message !== null) {
      return (
        <DogfoodShell title="Chat Failed">
          <p className="errorText max-w-[min(720px,calc(100vw-48px))] [overflow-wrap:anywhere] text-destructive-text">Something unexpected interrupted chat.</p>
          <DogfoodDiagnosticDetails diagnostic={dogfoodDiagnostic("render", "try-again", this.state.message)} />
          <button className={dogfoodPrimaryButtonClassName} type="button" onClick={() => window.location.reload()}>
            Reload chat
          </button>
        </DogfoodShell>
      )
    }

    return this.props.children
  }
}

const uploadDogfoodAttachment = async (
  generateAttachmentUploadUrl: (input: Record<string, never>) => Promise<{
    readonly uploadUrl: string
    readonly intentId: Id<"attachmentUploadIntents">
  }>,
  registerAttachmentUpload: (input: {
    readonly intentId: Id<"attachmentUploadIntents">
    readonly storageId: Id<"_storage">
    readonly contentType: string
  }) => Promise<{
    readonly status: "registered"
    readonly storageId: Id<"_storage">
  } | {
    readonly status: "rejected"
    readonly reason: string
  }>,
  deleteAttachmentUpload: (input: {
    readonly storageId: Id<"_storage">
    readonly intentId?: Id<"attachmentUploadIntents">
  }) => Promise<unknown>,
  storageIds: Map<string, Id<"_storage">>,
  file: File
): Promise<ChatMessageAttachment> => {
  const { uploadUrl, intentId } = await generateAttachmentUploadUrl({})
  const contentType = file.type.length === 0 ? "application/octet-stream" : file.type
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: file
  })
  if (!response.ok) throw new Error(`Attachment upload failed (${response.status})`)

  const body: unknown = await response.json()
  const storageId = storageIdFromUploadResponse(body)
  storageIds.set(String(storageId), storageId)
  let registration: Awaited<ReturnType<typeof registerAttachmentUpload>> | undefined
  let registrationFailure: unknown
  for (let attempt = 0; attempt < 3 && registration === undefined; attempt += 1) {
    try {
      registration = await registerAttachmentUpload({ intentId, storageId, contentType })
    } catch (cause) {
      registrationFailure = cause
    }
  }
  if (registration === undefined || registration.status === "rejected") {
    await deleteAttachmentUpload({ intentId, storageId }).catch(() => {})
    if (registration?.status === "rejected") throw new Error(registration.reason)
    throw registrationFailure instanceof Error ? registrationFailure : new Error("Attachment registration failed")
  }

  return {
    id: String(storageId),
    storageId: String(storageId),
    name: file.name.trim().length === 0 ? "attachment" : file.name,
    contentType,
    size: file.size,
    kind: contentType.toLowerCase().startsWith("image/") ? "image" : "file",
    url: null
  }
}

const toDogfoodMessageReactionEmoji = (emoji: string): DogfoodMessageReactionEmoji => {
  switch (emoji) {
    case "👍":
    case "🎉":
    case "👀":
      return emoji
    default:
      throw new Error("Unsupported reaction emoji")
  }
}

const requiredStorageId = (storageIds: ReadonlyMap<string, Id<"_storage">>, id: string): Id<"_storage"> => {
  const storageId = storageIds.get(id)
  if (storageId === undefined) throw new Error("Unknown attachment storage id")
  return storageId
}

const storageIdFromUploadResponse = (body: unknown): Id<"_storage"> => {
  if (typeof body !== "object" || body === null || !("storageId" in body)) {
    throw new Error("Attachment upload did not return a storage id")
  }
  const storageId = body.storageId
  if (typeof storageId !== "string" || storageId.length === 0) {
    throw new Error("Attachment upload did not return a storage id")
  }
  return storageId as Id<"_storage">
}

const latestMessageId = (messages: ReadonlyArray<DogfoodChannelMessageView>): Id<"messages"> | null =>
  messages.reduce<DogfoodChannelMessageView | null>(
    (latest, message) => latest === null || message.createdAt > latest.createdAt ? message : latest,
    null
  )?.id ?? null

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Something went wrong."

const dogfoodDiagnostic = (
  source: DogfoodDiagnostic["source"],
  retry: DogfoodDiagnostic["retry"],
  cause: unknown
): DogfoodDiagnostic => ({
  code: `${source.toUpperCase()}-${safeErrorFingerprint(cause)}`,
  at: new Date().toISOString(),
  source,
  retry
})

const safeErrorFingerprint = (cause: unknown): string => {
  const message = errorMessage(cause)
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "[email]")
  let hash = 0
  for (let index = 0; index < message.length; index += 1) {
    hash = (Math.imul(31, hash) + message.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36).padStart(6, "0").slice(0, 6).toUpperCase()
}

const supportSafeDiagnostic = (cause: unknown): string => {
  const kind = cause instanceof Error && cause.name.trim().length > 0 ? cause.name : "UnknownError"
  return `${kind}: details redacted`
}

const logDogfoodDiagnostic = (
  context: string,
  cause: unknown,
  diagnostic: DogfoodDiagnostic
) => {
  console.warn("Dogfood chat diagnostic", {
    context,
    diagnostic,
    message: supportSafeDiagnostic(cause)
  })
}

const dogfoodDiagnosticRecovery = (retry: DogfoodDiagnostic["retry"]): string => {
  switch (retry) {
    case "sign-in":
      return "Try sign-in again or sign out and start over."
    case "try-again":
      return "Use Try again after checking the connection or allowlist."
    case "automatic":
      return "The app will retry as realtime state reconnects."
    case "message-action":
      return "Keep the draft or dialog open, reconnect, then retry the action."
  }
}

const dogfoodAccessErrorMessage = (cause: unknown): string => {
  const message = errorMessage(cause)
  if (
    message === "Not authenticated" ||
    message === "Authenticated user is missing an email address" ||
    message === "This email is not on the Aether dogfood allowlist" ||
    message === "WorkOS user profile is missing an email address"
  ) {
    return message
  }
  return "Could not join the dogfood chat. Check your connection and try again."
}

const signInErrorMessage = (_cause: unknown): string => "Could not open sign-in. Try again."

const mergeDogfoodChannels = (
  channels: ReadonlyArray<DogfoodChannelView>,
  nextChannels: ReadonlyArray<DogfoodChannelView>
): ReadonlyArray<DogfoodChannelView> => {
  const byId = new Map<Id<"channels">, DogfoodChannelView>()
  channels.forEach((channel) => byId.set(channel.id, channel))
  nextChannels.forEach((channel) => byId.set(channel.id, channel))
  return Array.from(byId.values())
}

const dogfoodOperationErrorMessage = (operation: DogfoodOperation, cause: unknown): string => {
  const diagnostic = dogfoodDiagnostic("mutation", "message-action", cause)
  logDogfoodDiagnostic(operation, cause, diagnostic)
  switch (operation) {
    case "send":
      return `Could not send message. Check your connection and try again. Diagnostic: ${diagnostic.code}.`
    case "edit":
      return `Could not save edit. Check your connection and try again. Diagnostic: ${diagnostic.code}.`
    case "delete":
      return `Could not delete message. Check your connection and try again. Diagnostic: ${diagnostic.code}.`
    case "react":
      return `Could not update reaction. Check your connection and try again. Diagnostic: ${diagnostic.code}.`
    case "attach":
      return `Could not upload attachment. Check your connection and try again. Diagnostic: ${diagnostic.code}.`
  }
}
