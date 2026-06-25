import { useAuth } from "@workos-inc/authkit-react"
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react"
import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from "react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { ChatDataView } from "./chat-data"
import {
  Channel,
  type ChannelId,
  ChannelMessage,
  type ChannelMessageId,
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

type DogfoodOperation = "send" | "edit" | "delete"

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
  readonly createdAt: number
  readonly editedAt?: number | null
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
  const [ensuredUserId, setEnsuredUserId] = useState<string | null>(null)
  const [error, setError] = useState<ConvexDogfoodError | null>(null)
  const [signInOpening, setSignInOpening] = useState(false)
  const [ensureAttempt, setEnsureAttempt] = useState(0)
  const authUserId = auth.user?.id ?? null
  const sessionReady = authUserId !== null && convexAuth.isAuthenticated
  const viewerReady = sessionReady && ensuredUserId === authUserId && error === null
  const workspace = useQuery(api.chat.defaultWorkspace, viewerReady ? {} : "skip")
  const messages = useQuery(
    api.chat.channelMessages,
    workspace?.channel === undefined ? "skip" : { channelId: workspace.channel.id }
  )

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
    () => workspace === undefined || workspace === null || messages === undefined
      ? null
      : dogfoodChatToChatData({
        workspace,
        messages,
        sendMessage,
        editMessage,
        deleteMessage
      }),
    [deleteMessage, editMessage, messages, sendMessage, workspace]
  )

  if (auth.isLoading) {
    return <DogfoodShell title="Checking Session">Loading your Aether session...</DogfoodShell>
  }

  if (auth.user === null) {
    return (
      <DogfoodShell title="Aether Dogfood" variant="bare">
        <button
          type="button"
          className="dogfoodPrimaryButton"
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
        <p className="errorText">{error.message}</p>
        <button
          type="button"
          className="dogfoodPrimaryButton"
          onClick={() => {
            setError(null)
            setEnsuredUserId(null)
            setEnsureAttempt((attempt) => attempt + 1)
          }}
        >
          Try again
        </button>
        <button type="button" className="dogfoodSecondaryButton" onClick={() => auth.signOut()}>
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
    <main className={`loadingShell ${variant === "bare" ? "bare" : ""}`}>
      <section className={variant === "bare" ? "dogfoodAuthBare" : "dogfoodAuthPanel"} aria-live="polite">
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
          <p className="errorText">{this.state.message}</p>
        </DogfoodShell>
      )
    }

    return this.props.children
  }
}

export const dogfoodChatToChatData = (input: {
  readonly workspace: DogfoodWorkspaceView
  readonly messages: ReadonlyArray<DogfoodChannelMessageView>
  readonly sendMessage: (input: { readonly channelId: Id<"channels">; readonly body: string }) => Promise<unknown>
  readonly editMessage: (input: {
    readonly channelId: Id<"channels">
    readonly messageId: Id<"messages">
    readonly body: string
  }) => Promise<unknown>
  readonly deleteMessage: (input: {
    readonly channelId: Id<"channels">
    readonly messageId: Id<"messages">
  }) => Promise<unknown>
}): ChatDataView => {
  const currentUserId = toHumanAccountId(input.workspace.currentUser.id)
  const workspaceId = toWorkspaceId(input.workspace.workspace.id)
  const channelId = toChannelId(input.workspace.channel.id)

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
        name: input.workspace.channel.name,
        visibility: input.workspace.channel.visibility,
        createdBy: currentUserId,
        createdAt: 0
      }),
      channelMessages: input.messages.map(toLegacyChannelMessage)
    },
    createChannelMessage: ({ channelId, body }) => input.sendMessage({ channelId: toConvexChannelId(channelId), body }),
    editChannelMessage: ({ channelId, messageId, body }) =>
      input.editMessage({ channelId: toConvexChannelId(channelId), messageId: toConvexMessageId(messageId), body }),
    deleteChannelMessage: ({ channelId, messageId }) =>
      input.deleteMessage({ channelId: toConvexChannelId(channelId), messageId: toConvexMessageId(messageId) }),
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
    deletedAt: null
  })

const toHumanAccountId = (id: Id<"users">): HumanAccountId => String(id) as HumanAccountId

const toWorkspaceId = (id: Id<"workspaces">): WorkspaceId => String(id) as WorkspaceId

const toChannelId = (id: Id<"channels">): ChannelId => String(id) as ChannelId

const toChannelMessageId = (id: Id<"messages">): ChannelMessageId => String(id) as ChannelMessageId

const toConvexChannelId = (id: ChannelId): Id<"channels"> => String(id) as Id<"channels">

const toConvexMessageId = (id: ChannelMessageId): Id<"messages"> => String(id) as Id<"messages">

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

const dogfoodOperationErrorMessage = (operation: DogfoodOperation): string => {
  switch (operation) {
    case "send":
      return "Could not send message. Check your connection and try again."
    case "edit":
      return "Could not save edit. Check your connection and try again."
    case "delete":
      return "Could not delete message. Check your connection and try again."
  }
}
