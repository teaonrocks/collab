import { useAuth } from "@workos-inc/authkit-react"
import { useMutation, useQuery } from "convex/react"
import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from "react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { ChannelId, ChannelMessage, CollabSnapshot } from "../shared/collab-rpc"
import { WorkspaceChat } from "./App"
import { openExternalUrl } from "./electron-shell"

type ConvexDogfoodError = {
  readonly message: string
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
  const ensureViewer = useMutation(api.chat.ensureViewer)
  const sendMessage = useMutation(api.chat.sendMessage)
  const [ensuredUserId, setEnsuredUserId] = useState<string | null>(null)
  const [error, setError] = useState<ConvexDogfoodError | null>(null)
  const [signInOpening, setSignInOpening] = useState(false)
  const viewerReady = auth.user !== null && ensuredUserId === auth.user.id && error === null
  const workspace = useQuery(api.chat.defaultWorkspace, viewerReady ? {} : "skip")
  const messages = useQuery(
    api.chat.channelMessages,
    workspace?.channel === undefined ? "skip" : { channelId: workspace.channel.id }
  )

  useEffect(() => {
    const user = auth.user
    if (auth.isLoading || user === null || ensuredUserId === user.id) return

    let cancelled = false
    void ensureViewer({})
      .then(() => {
        if (!cancelled) {
          setEnsuredUserId(user.id)
          setError(null)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError({ message: errorMessage(cause) })
      })

    return () => {
      cancelled = true
    }
  }, [auth.isLoading, auth.user, ensureViewer, ensuredUserId])

  const model = useMemo(
    () => workspace === undefined || workspace === null || messages === undefined
      ? null
      : toCollabSnapshot(workspace, messages),
    [messages, workspace]
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

  if (error !== null) {
    return (
      <DogfoodShell title="Could Not Join">
        <p className="errorText">{error.message}</p>
        <button type="button" className="dogfoodSecondaryButton" onClick={() => auth.signOut()}>
          Sign out
        </button>
      </DogfoodShell>
    )
  }

  if (!viewerReady) {
    return (
      <DogfoodShell title="Preparing Workspace">
        Checking your dogfood access and setting up the shared channel...
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
      model={model}
      canDeleteMessages={false}
      profileMenuActions={[{ label: "Sign out", onSelect: () => auth.signOut() }]}
      createChannelMessage={({ body }) => sendMessage({ channelId: model.channel.id as unknown as Id<"channels">, body })}
      deleteChannelMessage={() => Promise.resolve()}
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
    setError({ message: errorMessage(cause) })
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

const toCollabSnapshot = (
  workspace: NonNullable<typeof api.chat.defaultWorkspace._returnType>,
  messages: ReadonlyArray<typeof api.chat.channelMessages._returnType[number]>
): CollabSnapshot => ({
  currentUser: {
    id: workspace.currentUser.id,
    displayName: workspace.currentUser.displayName,
    email: "",
    createdAt: 0
  },
  workspace: {
    id: workspace.workspace.id,
    name: workspace.workspace.name,
    createdAt: 0
  },
  workspaceRole: "member",
  channel: {
    id: workspace.channel.id,
    workspaceId: workspace.workspace.id,
    name: workspace.channel.name,
    visibility: workspace.channel.visibility,
    createdBy: workspace.currentUser.id,
    createdAt: 0
  },
  channelRole: "member",
  channelMessages: messages.map(toChannelMessage),
  workspaceAgents: [],
  channelAgentEnablements: [],
  threads: [],
  threadMessages: [],
  agentRuns: [],
  auditEvents: []
}) as unknown as CollabSnapshot

const toChannelMessage = (
  message: typeof api.chat.channelMessages._returnType[number]
): ChannelMessage => ({
  id: message.id,
  channelId: message.channelId as unknown as ChannelId,
  authorType: "human",
  authorId: message.authorUserId,
  authorDisplayName: message.authorDisplayName,
  body: message.body,
  createdAt: message.createdAt,
  deletedAt: null
}) as unknown as ChannelMessage

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Something went wrong."
