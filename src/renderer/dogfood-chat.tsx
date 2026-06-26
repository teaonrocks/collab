import { useAuth } from "@workos-inc/authkit-react"
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react"
import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { ChatDataView } from "./chat-data"
import {
  Channel,
  type ChannelId,
  ChannelMessage,
  ChannelMessageAttachment,
  type ChannelMessageId,
  ChannelMessageParent,
  ChannelMessageReaction,
  HumanAccount,
  type HumanAccountId,
  Workspace,
  type WorkspaceId
} from "../shared/collab-rpc"
import { WorkspaceChat } from "./App"
import { openExternalUrl } from "./electron-shell"

type ConvexDogfoodError = {
  readonly message: string
}

type DogfoodOperation = "send" | "edit" | "delete" | "react" | "attach"
type DogfoodMessageReactionEmoji = "👍" | "🎉" | "👀"
const dogfoodMessageReactionEmojis = new Set<string>(["👍", "🎉", "👀"])

const dogfoodShellClassName =
  "loadingShell grid min-h-screen w-full place-items-center overflow-hidden bg-surface-canvas p-6 font-sans text-foreground"
const dogfoodAuthPanelClassName =
  "dogfoodAuthPanel flex w-[min(420px,100%)] flex-col items-start gap-3.5 rounded-card border border-border bg-surface-canvas p-5 shadow-panel [&_div]:m-0 [&_div]:text-sm [&_div]:leading-[1.45] [&_div]:text-foreground-muted [&_h1]:m-0 [&_h1]:text-lg [&_h1]:leading-tight [&_h1]:text-foreground [&_p]:m-0 [&_p]:text-sm [&_p]:leading-[1.45] [&_p]:text-foreground-muted"
const dogfoodAuthBareClassName =
  "dogfoodAuthBare flex w-[min(420px,100%)] flex-col items-center gap-[18px] [&_div]:flex [&_div]:justify-center [&_h1]:m-0 [&_h1]:text-center [&_h1]:text-[32px] [&_h1]:font-extrabold [&_h1]:leading-[1.1] [&_h1]:text-foreground-strong"
const dogfoodPrimaryButtonClassName =
  "dogfoodPrimaryButton min-h-9 cursor-pointer rounded-panel border border-foreground-strong bg-foreground-strong px-3.5 font-[inherit] font-bold text-foreground-inverse disabled:cursor-default disabled:border-foreground-subtle disabled:bg-foreground-subtle"
const dogfoodSecondaryButtonClassName =
  "dogfoodSecondaryButton min-h-9 cursor-pointer rounded-panel border border-border-strong bg-surface-canvas px-3.5 font-[inherit] font-bold text-foreground"

export type DogfoodChannelView = {
  readonly id: Id<"channels">
  readonly key: string
  readonly name: string
  readonly visibility: "public" | "private"
  readonly createdAt: number
}

export type DogfoodWorkspaceView = {
  readonly currentUser: {
    readonly id: Id<"users">
    readonly displayName: string
  }
  readonly workspace: {
    readonly id: Id<"workspaces">
    readonly name: string
  }
  readonly channel: {
    readonly id: Id<"channels">
    readonly name: string
    readonly visibility: "public" | "private"
  }
}

export type DogfoodChannelMessageView = {
  readonly id: Id<"messages">
  readonly channelId: Id<"channels">
  readonly authorUserId: Id<"users">
  readonly authorDisplayName: string
  readonly body: string
  readonly parentMessageId?: Id<"messages"> | null
  readonly parentMessage?: {
    readonly id: Id<"messages">
    readonly authorDisplayName: string
    readonly bodyPreview: string
    readonly deleted: boolean
  } | null
  readonly createdAt: number
  readonly editedAt?: number | null
  readonly reactions?: ReadonlyArray<{
    readonly emoji: string
    readonly count: number
    readonly reactedByCurrentUser: boolean
  }>
  readonly attachments?: ReadonlyArray<DogfoodMessageAttachmentView>
}

export type DogfoodMessageAttachmentView = {
  readonly storageId: Id<"_storage">
  readonly name: string
  readonly contentType: string
  readonly size: number
  readonly kind: "file" | "image"
  readonly url: string | null
}

export type DogfoodChannelMemberView = {
  readonly id: Id<"users">
  readonly displayName: string
  readonly joinedAt: number
}

export function ConvexDogfoodApp() {
  return (
    <DogfoodErrorBoundary>
      <ConvexDogfoodChat />
    </DogfoodErrorBoundary>
  )
}

function ConvexDogfoodChat() {
  const auth = useAuth()
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
  const [ensuredUserId, setEnsuredUserId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<Id<"channels"> | null>(null)
  const [joinedChannelIds, setJoinedChannelIds] = useState<ReadonlySet<Id<"channels">>>(() => new Set())
  const [createdChannels, setCreatedChannels] = useState<ReadonlyArray<DogfoodChannelView>>([])
  const [error, setError] = useState<ConvexDogfoodError | null>(null)
  const [signInOpening, setSignInOpening] = useState(false)
  const [ensureAttempt, setEnsureAttempt] = useState(0)
  const lastReadMarkerRef = useRef<string | null>(null)
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
  const messages = useQuery(
    api.chat.channelMessages,
    activeChannelId === undefined || !activeChannelJoined ? "skip" : { channelId: activeChannelId }
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
        if (!cancelled) setError({ message: dogfoodAccessErrorMessage(cause) })
      })

    return () => {
      cancelled = true
    }
  }, [activeChannelId, activeChannelJoined, ensureChannelMember, viewerReady])

  useEffect(() => {
    if (!viewerReady || activeChannelId === undefined || !activeChannelJoined || messages === undefined) return
    const readThroughCreatedAt = latestMessageCreatedAt(messages)
    const readMarker = `${activeChannelId}:${readThroughCreatedAt}`
    if (lastReadMarkerRef.current === readMarker) return
    lastReadMarkerRef.current = readMarker

    void markChannelRead({ channelId: activeChannelId, readThroughCreatedAt }).catch((cause: unknown) => {
      console.warn("Could not mark channel read", cause)
    })
  }, [activeChannelId, activeChannelJoined, markChannelRead, messages, viewerReady])

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
        if (!cancelled) setError({ message: dogfoodAccessErrorMessage(cause) })
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
        messages: messages ?? [],
        members: members ?? [],
        channelIndicators: channelIndicators ?? [],
        messagesLoading: messages === undefined,
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
        uploadMessageAttachment: (file) => uploadDogfoodAttachment(generateAttachmentUploadUrl, file),
        editMessage,
        deleteMessage,
        toggleMessageReaction
      }),
    [activeChannelId, channelIndicators, channelList, createChannel, deleteMessage, editMessage, members, messages, sendMessage, toggleMessageReaction, workspace]
  )

  if (auth.isLoading) {
    return <DogfoodShell title="Checking Session">Loading your Aether session...</DogfoodShell>
  }

  if (auth.user === null) {
    return (
      <DogfoodShell title="Aether Dogfood" variant="bare">
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
    return <DogfoodShell title="Checking Session">Waiting for your AuthKit session to reach Convex...</DogfoodShell>
  }

  if (error !== null) {
    return (
      <DogfoodShell title="Could Not Join">
        <p className="errorText max-w-[min(720px,calc(100vw-48px))] [overflow-wrap:anywhere] text-destructive-text">{error.message}</p>
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
      <DogfoodShell title="Preparing Workspace">
        {ensureAttempt > 0
          ? "Retrying dogfood access and reconnecting to the shared channel..."
          : "Checking your dogfood access and setting up the shared channel..."}
      </DogfoodShell>
    )
  }

  if (workspace === null) {
    return <DogfoodShell title="Preparing Workspace">Setting up the shared channel...</DogfoodShell>
  }

  if (model === null) {
    return <DogfoodShell title="Loading Chat">Waiting for realtime messages...</DogfoodShell>
  }

  return (
    <WorkspaceChat
      {...model}
      profileMenuActions={[{ label: "Sign out", onSelect: () => auth.signOut() }]}
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
    setError({ message: signInErrorMessage(cause) })
  } finally {
    setSignInOpening(false)
  }
}

function DogfoodShell(props: {
  readonly title: string
  readonly children: ReactNode
  readonly variant?: "panel" | "bare"
}) {
  const variant = props.variant ?? "panel"
  return (
    <main className={dogfoodShellClassName}>
      <section className={variant === "bare" ? dogfoodAuthBareClassName : dogfoodAuthPanelClassName} aria-live="polite">
        <h1>{props.title}</h1>
        <div>{props.children}</div>
      </section>
    </main>
  )
}

class DogfoodErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly message: string | null }
> {
  state = { message: null }

  static getDerivedStateFromError(error: unknown) {
    return { message: errorMessage(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Dogfood chat failed", error, info)
  }

  render() {
    if (this.state.message !== null) {
      return (
        <DogfoodShell title="Chat Failed">
          <p className="errorText max-w-[min(720px,calc(100vw-48px))] [overflow-wrap:anywhere] text-destructive-text">{this.state.message}</p>
        </DogfoodShell>
      )
    }

    return this.props.children
  }
}

export const dogfoodChatToChatData = (input: {
  readonly workspace: DogfoodWorkspaceView
  readonly channels: ReadonlyArray<DogfoodChannelView>
  readonly selectedChannelId: Id<"channels">
  readonly messages: ReadonlyArray<DogfoodChannelMessageView>
  readonly members?: ReadonlyArray<DogfoodChannelMemberView>
  readonly channelIndicators?: ReadonlyArray<{
    readonly channelId: Id<"channels">
    readonly indicator: "unread" | "mentioned"
  }>
  readonly messagesLoading?: boolean
  readonly membersLoading?: boolean
  readonly createChannel?: (input: { readonly name: string; readonly visibility?: "public" | "private" }) => Promise<DogfoodChannelView>
  readonly selectChannel?: (channelId: Id<"channels">) => void
  readonly sendMessage: (input: {
    readonly channelId: Id<"channels">
    readonly body: string
    readonly parentMessageId?: Id<"messages">
    readonly attachments?: Array<{
      readonly storageId: Id<"_storage">
      readonly name: string
    }>
  }) => Promise<unknown>
  readonly uploadMessageAttachment?: (file: File) => Promise<ChannelMessageAttachment>
  readonly editMessage: (input: {
    readonly channelId: Id<"channels">
    readonly messageId: Id<"messages">
    readonly body: string
  }) => Promise<unknown>
  readonly deleteMessage: (input: {
    readonly channelId: Id<"channels">
    readonly messageId: Id<"messages">
  }) => Promise<unknown>
  readonly toggleMessageReaction?: (input: {
    readonly channelId: Id<"channels">
    readonly messageId: Id<"messages">
    readonly emoji: DogfoodMessageReactionEmoji
  }) => Promise<unknown>
}): ChatDataView => {
  const currentUserId = toHumanAccountId(input.workspace.currentUser.id)
  const workspaceId = toWorkspaceId(input.workspace.workspace.id)
  const selectedChannel =
    input.channels.find((channel) => channel.id === input.selectedChannelId) ??
    input.channels.find((channel) => channel.id === input.workspace.channel.id) ?? {
      id: input.workspace.channel.id,
      key: "general",
      name: input.workspace.channel.name,
      visibility: input.workspace.channel.visibility,
      createdAt: 0
    }
  const channelId = toChannelId(selectedChannel.id)

  return {
    model: {
      currentUser: new HumanAccount({
        id: currentUserId,
        displayName: input.workspace.currentUser.displayName,
        email: "",
        createdAt: 0
      }),
      workspace: new Workspace({
        id: workspaceId,
        name: input.workspace.workspace.name,
        createdAt: 0
      }),
      channel: new Channel({
        id: channelId,
        workspaceId,
        name: selectedChannel.name,
        visibility: selectedChannel.visibility,
        createdBy: currentUserId,
        createdAt: selectedChannel.createdAt
      }),
      channels: input.channels.map((channel) => new Channel({
        id: toChannelId(channel.id),
        workspaceId,
        name: channel.name,
        visibility: channel.visibility,
        createdBy: currentUserId,
        createdAt: channel.createdAt
      })),
      channelMessages: input.messages.map(toLegacyChannelMessage),
      channelMembers: input.members?.map((member) => ({
        id: toHumanAccountId(member.id),
        displayName: member.displayName
      })),
      channelIndicators: input.channelIndicators?.map((state) => ({
        channelId: toChannelId(state.channelId),
        indicator: state.indicator
      })),
      channelMembersLoading: input.membersLoading ?? false,
      channelMessagesLoading: input.messagesLoading ?? false
    },
    createChannel: input.createChannel === undefined
      ? undefined
      : async ({ name, visibility }) => {
        const channel = await input.createChannel!({ name, visibility })
        return new Channel({
          id: toChannelId(channel.id),
          workspaceId,
          name: channel.name,
          visibility: channel.visibility,
          createdBy: currentUserId,
          createdAt: channel.createdAt
        })
      },
    selectChannel: input.selectChannel === undefined
      ? undefined
      : (channelId) => input.selectChannel?.(toConvexChannelId(channelId)),
    createChannelMessage: ({ channelId, body, parentMessageId, attachments }) => input.sendMessage({
      channelId: toConvexChannelId(channelId),
      body,
      parentMessageId: parentMessageId == null ? undefined : toConvexMessageId(parentMessageId),
      attachments: attachments?.map((attachment) => ({
        storageId: toConvexStorageId(attachment.storageId),
        name: attachment.name
      }))
    }),
    uploadMessageAttachment: input.uploadMessageAttachment,
    editChannelMessage: ({ channelId, messageId, body }) =>
      input.editMessage({ channelId: toConvexChannelId(channelId), messageId: toConvexMessageId(messageId), body }),
    deleteChannelMessage: ({ channelId, messageId }) =>
      input.deleteMessage({ channelId: toConvexChannelId(channelId), messageId: toConvexMessageId(messageId) }),
    toggleMessageReaction: input.toggleMessageReaction === undefined
      ? undefined
      : ({ channelId, messageId, emoji }) => input.toggleMessageReaction!({
        channelId: toConvexChannelId(channelId),
        messageId: toConvexMessageId(messageId),
        emoji: toDogfoodMessageReactionEmoji(emoji)
      }),
    operationErrorMessage: (operation) => dogfoodOperationErrorMessage(operation),
    canEditMessage: (message) => message.authorId === currentUserId,
    canDeleteMessage: (message) => message.authorId === currentUserId
  }
}

const toLegacyChannelMessage = (message: DogfoodChannelMessageView): ChannelMessage =>
  new ChannelMessage({
    id: toChannelMessageId(message.id),
    channelId: toChannelId(message.channelId),
    authorType: "human",
    authorId: message.authorUserId,
    authorDisplayName: message.authorDisplayName,
    body: message.body,
    createdAt: message.createdAt,
    editedAt: message.editedAt ?? null,
    deletedAt: null,
    parentMessageId: message.parentMessageId == null ? null : toChannelMessageId(message.parentMessageId),
    parentMessage: message.parentMessage == null
      ? null
      : new ChannelMessageParent({
        id: toChannelMessageId(message.parentMessage.id),
        authorDisplayName: message.parentMessage.authorDisplayName,
        bodyPreview: message.parentMessage.bodyPreview,
        deleted: message.parentMessage.deleted
      }),
    reactions: (message.reactions ?? []).map((reaction) => new ChannelMessageReaction(reaction)),
    attachments: (message.attachments ?? []).map(toLegacyMessageAttachment)
  })

const toLegacyMessageAttachment = (attachment: DogfoodMessageAttachmentView): ChannelMessageAttachment =>
  new ChannelMessageAttachment({
    id: String(attachment.storageId),
    storageId: String(attachment.storageId),
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
    kind: attachment.kind,
    url: attachment.url
  })

const toHumanAccountId = (id: Id<"users">): HumanAccountId => String(id) as HumanAccountId

const toWorkspaceId = (id: Id<"workspaces">): WorkspaceId => String(id) as WorkspaceId

const toChannelId = (id: Id<"channels">): ChannelId => String(id) as ChannelId

const toChannelMessageId = (id: Id<"messages">): ChannelMessageId => String(id) as ChannelMessageId

const toConvexChannelId = (id: ChannelId): Id<"channels"> => String(id) as Id<"channels">

const toConvexMessageId = (id: ChannelMessageId): Id<"messages"> => String(id) as Id<"messages">

const toConvexStorageId = (id: string): Id<"_storage"> => String(id) as Id<"_storage">

const uploadDogfoodAttachment = async (
  generateAttachmentUploadUrl: (input: Record<string, never>) => Promise<string>,
  file: File
): Promise<ChannelMessageAttachment> => {
  const uploadUrl = await generateAttachmentUploadUrl({})
  const contentType = file.type.length === 0 ? "application/octet-stream" : file.type
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: file
  })
  if (!response.ok) throw new Error(`Attachment upload failed (${response.status})`)

  const body = await response.json() as { readonly storageId?: string }
  if (body.storageId === undefined || body.storageId.length === 0) throw new Error("Attachment upload did not return a storage id")

  return new ChannelMessageAttachment({
    id: body.storageId,
    storageId: body.storageId,
    name: file.name.trim().length === 0 ? "attachment" : file.name,
    contentType,
    size: file.size,
    kind: contentType.toLowerCase().startsWith("image/") ? "image" : "file",
    url: null
  })
}

const toDogfoodMessageReactionEmoji = (emoji: string): DogfoodMessageReactionEmoji => {
  if (dogfoodMessageReactionEmojis.has(emoji)) return emoji as DogfoodMessageReactionEmoji
  throw new Error("Unsupported reaction emoji")
}

const latestMessageCreatedAt = (messages: ReadonlyArray<DogfoodChannelMessageView>): number =>
  messages.reduce((latest, message) => Math.max(latest, message.createdAt), 0)

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Something went wrong."

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

const dogfoodOperationErrorMessage = (operation: DogfoodOperation): string => {
  switch (operation) {
    case "send":
      return "Could not send message. Check your connection and try again."
    case "edit":
      return "Could not save edit. Check your connection and try again."
    case "delete":
      return "Could not delete message. Check your connection and try again."
    case "react":
      return "Could not update reaction. Check your connection and try again."
    case "attach":
      return "Could not upload attachment. Check your connection and try again."
  }
}
