import { useAuth } from "@workos-inc/authkit-react"
import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useState } from "react"
import type { WindowAccountContext } from "../shared/account-session"
import { authKitSignOutReturnTo } from "./authkit-redirect"
import { dogfoodChatToChatData } from "./dogfood-chat-adapter"
import { useConversationSelection } from "./dogfood-chat/use-conversation-selection"
import { useDesktopNotifications } from "./dogfood-chat/use-desktop-notifications"
import { useActiveConversationData, useDogfoodWorkspaceData } from "./dogfood-chat/use-dogfood-data"
import { useDogfoodCommands } from "./dogfood-chat/use-dogfood-commands"
import { useReadMarkers } from "./dogfood-chat/use-read-markers"
import { useViewerSession } from "./dogfood-chat/use-viewer-session"
import {
  addWindowAccount,
  getWindowAccountContext,
  openExternalUrl,
  openNativeAuthUrl,
  removeCurrentWindowAccount,
  signOutAllWindowAccounts,
  subscribeToWindowAccountContext,
  switchWindowAccount,
  updateWindowAccountProfile
} from "./electron-shell"
import { Button } from "./ui"
import { WorkspaceChat, type ProfileMenuAction } from "./workspace-chat"

type ConvexDogfoodError = {
  readonly message: string
  readonly diagnostic?: DogfoodDiagnostic
}

type DogfoodOperation = "send" | "edit" | "delete" | "react" | "attach"
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
  "dogfoodPlainState flex w-[min(420px,100%)] flex-col items-center gap-4 text-center [&_h1]:m-0 [&_h1]:text-lg [&_h1]:leading-tight [&_h1]:text-foreground"
const dogfoodPlainContentClassName =
  "m-0 flex min-h-10 flex-col items-center justify-center gap-3 text-sm leading-[1.45] text-foreground-muted"
export function ConvexDogfoodApp() {
  return (
    <DogfoodErrorBoundary>
      <ConvexDogfoodChat />
    </DogfoodErrorBoundary>
  )
}

function ConvexDogfoodChat() {
  const [error, setError] = useState<ConvexDogfoodError | null>(null)
  const [signInOpening, setSignInOpening] = useState(false)
  const viewerFailure = useCallback((cause: unknown) => {
    const diagnostic = dogfoodDiagnostic("viewer", "try-again", cause)
    logDogfoodDiagnostic("viewer", cause, diagnostic)
    setError({ message: dogfoodAccessErrorMessage(cause), diagnostic })
  }, [])
  const membershipFailure = useCallback((cause: unknown) => {
    const diagnostic = dogfoodDiagnostic("channel", "try-again", cause)
    logDogfoodDiagnostic("channel", cause, diagnostic)
    setError({ message: dogfoodAccessErrorMessage(cause), diagnostic })
  }, [])
  const readMarkerFailure = useCallback((cause: unknown) => {
    logDogfoodDiagnostic("read-marker", cause, dogfoodDiagnostic("mutation", "try-again", cause))
  }, [])
  const session = useViewerSession(error !== null, viewerFailure)
  const { auth, authUserId, viewerReady, ensureAttempt } = session
  const accountContext = useWindowAccountContext(auth.user)
  const workspaceData = useDogfoodWorkspaceData(viewerReady)
  const { workspace } = workspaceData
  const selection = useConversationSelection({
    viewerReady,
    workspace,
    channels: workspaceData.channels,
    directConversations: workspaceData.directConversations,
    onMembershipError: membershipFailure
  })
  const conversationData = useActiveConversationData(selection, workspace?.currentUser.id)
  const commands = useDogfoodCommands({
    workspace,
    selection,
    loadOlderMessages: conversationData.loadOlderMessages,
    operationErrorMessage: dogfoodOperationErrorMessage
  })
  useDesktopNotifications({
    viewerReady,
    authUserId,
    activeChannelId: selection.activeChannelId,
    activateConversation: selection.activateConversation
  })
  useReadMarkers({
    viewerReady,
    activeKind: selection.activeKind,
    activeChannelId: selection.activeChannelId,
    activeChannelJoined: selection.activeChannelJoined,
    messagesLoading: conversationData.messagesLoading,
    messages: conversationData.messages,
    onFailure: readMarkerFailure
  })

  const model =
    workspace === undefined ||
    workspace === null ||
    selection.channelList === undefined ||
    selection.activeChannelId === undefined
      ? null
      : dogfoodChatToChatData({
          data: {
            workspace,
            channels: selection.channelList,
            directConversations: selection.directConversations,
            ...(workspaceData.directMessageProfile === undefined
              ? {}
              : { directMessageProfile: workspaceData.directMessageProfile }),
            ...(workspaceData.incomingFriendRequests === undefined
              ? {}
              : { incomingFriendRequests: workspaceData.incomingFriendRequests }),
            selectedConversation:
              selection.activeKind === "direct"
                ? { kind: "direct", id: selection.activeChannelId }
                : { kind: "channel", id: selection.activeChannelId },
            messages: conversationData.messages,
            ...(conversationData.members === undefined ? {} : { members: conversationData.members }),
            ...(conversationData.channelMemberInviteCandidates === undefined
              ? {}
              : { channelMemberInviteCandidates: conversationData.channelMemberInviteCandidates }),
            ...(workspaceData.createChannelInviteCandidates === undefined
              ? {}
              : { createChannelInviteCandidates: workspaceData.createChannelInviteCandidates }),
            ...(workspaceData.conversationIndicators === undefined
              ? {}
              : { channelIndicators: workspaceData.conversationIndicators }),
            ...(conversationData.notificationPreference === undefined
              ? {}
              : { notificationPreference: conversationData.notificationPreference })
          },
          state: {
            messagesLoading: conversationData.messagesLoading,
            messagesHasMore: conversationData.messagesHasMore,
            messagesLoadingMore: conversationData.messagesLoadingMore,
            membersLoading: conversationData.members === undefined,
            directConversationsLoading: workspaceData.directConversations === undefined
          },
          commands
        })

  if (session.status === "auth-loading") {
    return (
      <DogfoodShell title="Checking Session" variant="plain">
        Loading your Aether session...
      </DogfoodShell>
    )
  }

  if (session.status === "signed-out") {
    const previousAccount = accountContext?.accounts.find(
      (account) => !account.current && account.displayName !== "Sign in"
    )
    return (
      <DogfoodShell title="Welcome to Aether" variant="plain">
        <Button
          type="button"
          className="dogfoodPrimaryButton min-h-9 rounded-panel"
          disabled={signInOpening || (window.aetherShell !== undefined && accountContext === null)}
          onClick={() => void signInInDefaultBrowser(auth, setSignInOpening, setError, accountContext)}
        >
          {signInOpening
            ? "Opening browser..."
            : accountContext === null && window.aetherShell !== undefined
              ? "Loading account..."
              : "Sign in"}
        </Button>
        {previousAccount === undefined ? null : (
          <Button
            type="button"
            variant="link"
            className="dogfoodLinkButton text-xs font-normal focus-visible:rounded-sm"
            onClick={() => void switchWindowAccount(previousAccount.id)}
          >
            Back to {previousAccount.displayName}
          </Button>
        )}
      </DogfoodShell>
    )
  }

  if (session.status === "convex-loading") {
    return (
      <DogfoodShell title="Checking Session" variant="plain">
        Waiting for your AuthKit session to reach Convex...
      </DogfoodShell>
    )
  }

  if (error !== null) {
    return (
      <DogfoodShell title="Could Not Join">
        <p className="errorText max-w-[min(720px,calc(100vw-48px))] [overflow-wrap:anywhere] text-destructive-text">
          {error.message}
        </p>
        {error.diagnostic === undefined ? null : <DogfoodDiagnosticDetails diagnostic={error.diagnostic} />}
        <Button
          type="button"
          className="dogfoodPrimaryButton min-h-9 rounded-panel"
          onClick={() => {
            setError(null)
            session.retry()
          }}
        >
          Try again
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="dogfoodSecondaryButton min-h-9 rounded-panel"
          onClick={() => void signOutCurrentAccount(auth, accountContext)}
        >
          Sign out
        </Button>
      </DogfoodShell>
    )
  }

  if (session.status !== "ready") {
    return (
      <DogfoodShell title="Preparing Workspace" variant="plain">
        {ensureAttempt > 0
          ? "Retrying dogfood access and reconnecting to the shared channel..."
          : "Checking your dogfood access and setting up the shared channel..."}
      </DogfoodShell>
    )
  }

  if (workspace === null) {
    return (
      <DogfoodShell title="Preparing Workspace" variant="plain">
        Setting up the shared channel...
      </DogfoodShell>
    )
  }

  if (model === null) {
    return (
      <DogfoodShell title="Loading Chat" variant="plain">
        Waiting for realtime messages...
      </DogfoodShell>
    )
  }

  return <WorkspaceChat {...model} profileMenuActions={profileMenuActions(auth, accountContext, setError)} />
}

function useWindowAccountContext(user: ReturnType<typeof useAuth>["user"]): WindowAccountContext | null {
  const [accountContext, setAccountContext] = useState<WindowAccountContext | null>(null)

  useEffect(() => {
    let cancelled = false
    let receivedUpdate = false
    const unsubscribe = subscribeToWindowAccountContext((context) => {
      receivedUpdate = true
      if (!cancelled) setAccountContext(context)
    })
    void getWindowAccountContext()
      .then((context) => {
        if (!cancelled && !receivedUpdate) setAccountContext(context)
      })
      .catch((cause: unknown) => {
        console.warn("Could not load the Aether account list", cause)
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (user === null || typeof user.email !== "string" || user.email.length === 0) return
    const displayName =
      [user.firstName, user.lastName]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(" ") || user.email
    let cancelled = false
    void updateWindowAccountProfile({
      userId: user.id,
      displayName,
      email: user.email,
      avatarUrl: user.profilePictureUrl
    })
      .then((context) => {
        if (!cancelled && context !== null) setAccountContext(context)
      })
      .catch((cause: unknown) => {
        console.warn("Could not remember the signed-in Aether account", cause)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  return accountContext
}

const signInInDefaultBrowser = async (
  auth: ReturnType<typeof useAuth>,
  setSignInOpening: (opening: boolean) => void,
  setError: (error: ConvexDogfoodError | null) => void,
  accountContext: WindowAccountContext | null
) => {
  setSignInOpening(true)
  setError(null)
  try {
    const generatedUrl = await auth.getSignInUrl(
      accountContext === null
        ? {}
        : {
            state: {
              aetherWindowId: accountContext.windowId,
              aetherAccountId: accountContext.currentAccountId
            }
          }
    )
    const currentAccount = accountContext?.accounts.find((account) => account.current)
    if (currentAccount?.pending === true) {
      await openNativeAuthUrl(generatedUrl)
    } else {
      await openExternalUrl(generatedUrl)
    }
  } catch (cause) {
    const diagnostic = dogfoodDiagnostic("auth", "sign-in", cause)
    logDogfoodDiagnostic("auth", cause, diagnostic)
    setError({ message: signInErrorMessage(cause), diagnostic })
  } finally {
    setSignInOpening(false)
  }
}

const signOutCurrentAccount = async (
  auth: ReturnType<typeof useAuth>,
  accountContext: WindowAccountContext | null
): Promise<void> => {
  if (accountContext === null) {
    auth.signOut({ returnTo: authKitSignOutReturnTo() })
    return
  }
  try {
    await auth.signOut({ navigate: false })
  } catch {
    // The main process clears the isolated partition even if AuthKit has
    // already lost its in-memory access token.
  }
  await removeCurrentWindowAccount()
}

const signOutAllAccounts = async (
  auth: ReturnType<typeof useAuth>,
  accountContext: WindowAccountContext | null
): Promise<void> => {
  if (accountContext === null) {
    auth.signOut({ returnTo: authKitSignOutReturnTo() })
    return
  }
  try {
    await auth.signOut({ navigate: false })
  } catch {
    // Every saved partition is cleared by the main process below.
  }
  await signOutAllWindowAccounts()
}

const profileMenuActions = (
  auth: ReturnType<typeof useAuth>,
  accountContext: WindowAccountContext | null,
  setError: (error: ConvexDogfoodError | null) => void
): ReadonlyArray<ProfileMenuAction> => {
  if (accountContext === null) {
    return [
      {
        label: "Sign out",
        onSelect: () => auth.signOut({ returnTo: authKitSignOutReturnTo() })
      }
    ]
  }

  const run = (operation: () => Promise<void>) => {
    void operation().catch((cause: unknown) => {
      const diagnostic = dogfoodDiagnostic("auth", "try-again", cause)
      logDogfoodDiagnostic("auth", cause, diagnostic)
      setError({ message: "Could not update the active account. Try again.", diagnostic })
    })
  }

  return [
    ...accountContext.accounts.map<ProfileMenuAction>((account) => ({
      id: `account:${account.id}`,
      label: account.displayName,
      ...(account.email === null ? {} : { detail: account.email }),
      selected: account.current,
      onSelect: () => {
        if (!account.current) run(() => switchWindowAccount(account.id))
      }
    })),
    {
      id: "account:add",
      label: "Add account",
      separatorBefore: true,
      onSelect: () => run(addWindowAccount)
    },
    {
      id: "account:sign-out",
      label: "Sign out this account",
      separatorBefore: true,
      onSelect: () => run(() => signOutCurrentAccount(auth, accountContext))
    },
    {
      id: "account:sign-out-all",
      label: "Sign out all accounts",
      tone: "destructive",
      onSelect: () => run(() => signOutAllAccounts(auth, accountContext))
    }
  ]
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
      <section
        className={props.variant === "plain" ? dogfoodPlainStateClassName : dogfoodAuthPanelClassName}
        aria-live="polite"
      >
        {props.variant === "plain" ? null : (
          <span className="text-xs font-bold tracking-[0.08em] text-foreground-subtle uppercase">Aether Dogfood</span>
        )}
        <h1>{props.title}</h1>
        <div className={props.variant === "plain" ? dogfoodPlainContentClassName : undefined}>{props.children}</div>
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
          <p className="errorText max-w-[min(720px,calc(100vw-48px))] [overflow-wrap:anywhere] text-destructive-text">
            Something unexpected interrupted chat.
          </p>
          <DogfoodDiagnosticDetails diagnostic={dogfoodDiagnostic("render", "try-again", this.state.message)} />
          <Button
            className="dogfoodPrimaryButton min-h-9 rounded-panel"
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload chat
          </Button>
        </DogfoodShell>
      )
    }

    return this.props.children
  }
}

const errorMessage = (cause: unknown): string => (cause instanceof Error ? cause.message : "Something went wrong.")

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

const logDogfoodDiagnostic = (context: string, cause: unknown, diagnostic: DogfoodDiagnostic) => {
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
