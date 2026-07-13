import { useAuth } from "@workos-inc/authkit-react"
import { useAction, useConvex, useConvexAuth, useMutation, usePaginatedQuery, useQuery } from "convex/react"
import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { WindowAccountContext } from "../shared/account-session"
import { uploadAttachment } from "./attachment-draft"
import { authKitSignOutReturnTo } from "./authkit-redirect"
import {
  dogfoodChatToChatData,
  type DogfoodChannelMemberView,
  type DogfoodChannelMessageView,
  type DogfoodChannelView,
  type DogfoodActiveConversation,
  type DogfoodDirectConversationView,
  type DogfoodWorkspaceView
} from "./dogfood-chat-adapter"
import {
  addWindowAccount,
  getWindowAccountContext,
  openExternalUrl,
  removeCurrentWindowAccount,
  signOutAllWindowAccounts,
  switchWindowAccount,
  updateWindowAccountProfile
} from "./electron-shell"
import { WorkspaceChat, type ProfileMenuAction } from "./workspace-chat"

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
  const editChannel = useMutation(api.chat.editChannel)
  const deleteChannel = useMutation(api.chat.deleteChannel)
  const addPrivateChannelMember = useMutation(api.chat.addPrivateChannelMember)
  const removePrivateChannelMember = useMutation(api.chat.removePrivateChannelMember)
  const ensureChannelMember = useMutation(api.chat.ensureChannelMember)
  const markChannelRead = useMutation(api.chat.markChannelRead)
  const generateAttachmentUploadUrl = useMutation(api.chat.generateAttachmentUploadUrl)
  const registerAttachmentUpload = useMutation(api.chat.registerAttachmentUpload)
  const deleteAttachmentUpload = useMutation(api.chat.deleteAttachmentUpload)
  const startOrReopenDirectConversation = useMutation(api.direct_conversations.startOrReopen)
  const sendFriendRequest = useMutation(api.social.sendFriendRequest)
  const updateDirectMessageProfile = useMutation(api.social.updateProfile)
  const respondToFriendRequest = useMutation(api.social.respondToFriendRequest)
  const [ensuredUserId, setEnsuredUserId] = useState<string | null>(null)
  const [selectedConversation, setSelectedConversation] = useState<DogfoodActiveConversation | null>(null)
  const [stableDirectConversations, setStableDirectConversations] = useState<ReadonlyArray<DogfoodDirectConversationView>>([])
  const [joinedChannelIds, setJoinedChannelIds] = useState<ReadonlySet<Id<"channels">>>(() => new Set())
  const [createdChannels, setCreatedChannels] = useState<ReadonlyArray<DogfoodChannelView>>([])
  const [error, setError] = useState<ConvexDogfoodError | null>(null)
  const [signInOpening, setSignInOpening] = useState(false)
  const [accountContext, setAccountContext] = useState<WindowAccountContext | null>(null)
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
  const directConversations = useQuery(
    api.direct_conversations.list,
    viewerReady ? {} : "skip"
  )
  // Kept as a compatibility fallback for plain consumers; the dialog itself
  // uses the server-side username search command below.
  const directConversationCandidates = useQuery(api.direct_conversations.candidates, viewerReady ? {} : "skip")
  const directIndicators = useQuery(api.direct_conversations.indicators, viewerReady ? {} : "skip")
  const directMessageProfile = useQuery(api.social.profile, viewerReady ? {} : "skip")
  const incomingFriendRequests = useQuery(api.social.incomingFriendRequests, viewerReady ? {} : "skip")
  useEffect(() => {
    if (directConversations !== undefined) setStableDirectConversations(directConversations)
  }, [directConversations])
  const activeKind = selectedConversation?.kind ?? "channel"
  const selectedChannelId = selectedConversation?.kind === "channel" ? selectedConversation.id : null
  const activeChannel = activeKind === "direct"
    ? undefined
    : selectedChannelId === null
    ? workspace?.channel
    : channelList?.find((channel) => channel.id === selectedChannelId) ?? workspace?.channel
  const activeDirectConversation = selectedConversation?.kind === "direct"
    ? stableDirectConversations.find((conversation) => conversation.id === selectedConversation.id)
    : undefined
  const activeChannelId = activeDirectConversation?.id ?? activeChannel?.id
  const activeChannelJoined = activeChannelId === undefined ? false : joinedChannelIds.has(activeChannelId)
  const messagePagination = usePaginatedQuery(
    api.chat.channelMessages,
    activeChannelId === undefined || (activeKind === "channel" && !activeChannelJoined) ? "skip" : { channelId: activeChannelId },
    { initialNumItems: 50 }
  )
  const messages = useMemo(
    () => [...messagePagination.results].reverse(),
    [messagePagination.results]
  )
  const members = useQuery(
    api.chat.channelMembers,
    activeKind === "direct" || activeChannelId === undefined || !activeChannelJoined ? "skip" : { channelId: activeChannelId }
  )
  const currentUserIsPrivateChannelAdmin = activeChannel?.visibility === "private" && members?.some((member) =>
    member.id === workspace?.currentUser.id && member.role === "admin"
  ) === true
  const channelMemberInviteCandidates = useQuery(
    api.chat.eligiblePrivateChannelMembers,
    activeChannelId === undefined || !currentUserIsPrivateChannelAdmin ? "skip" : { channelId: activeChannelId }
  )
  const createChannelInviteCandidates = useQuery(
    api.chat.eligiblePrivateChannelMembers,
    workspace === undefined || workspace === null ? "skip" : {}
  )
  const channelIndicators = useQuery(
    api.chat.channelIndicators,
    workspace === undefined || workspace === null ? "skip" : { workspaceId: workspace.workspace.id }
  )

  useEffect(() => {
    let cancelled = false
    void getWindowAccountContext()
      .then((context) => {
        if (!cancelled) setAccountContext(context)
      })
      .catch((cause: unknown) => {
        console.warn("Could not load the Aether account list", cause)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const user = auth.user
    if (
      user === null ||
      typeof user.email !== "string" ||
      user.email.length === 0
    ) {
      return
    }
    const displayName = [user.firstName, user.lastName]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" ") || user.email
    let cancelled = false
    void updateWindowAccountProfile({
      userId: user.id,
      displayName,
      email: user.email,
      avatarUrl: user.profilePictureUrl
    }).then((context) => {
      if (!cancelled && context !== null) setAccountContext(context)
    }).catch((cause: unknown) => {
      console.warn("Could not remember the signed-in Aether account", cause)
    })
    return () => {
      cancelled = true
    }
  }, [auth.user])

  useEffect(() => {
    if (workspace === undefined || workspace === null) return
    setJoinedChannelIds((existing) => {
      if (existing.has(workspace.channel.id)) return existing
      return new Set([...existing, workspace.channel.id])
    })
  }, [workspace])

  useEffect(() => {
    if (!viewerReady || activeKind === "direct" || activeChannelId === undefined || activeChannelJoined) return

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
  }, [activeChannelId, activeChannelJoined, activeKind, ensureChannelMember, viewerReady])

  useEffect(() => {
    if (!viewerReady || activeChannelId === undefined || (activeKind === "channel" && !activeChannelJoined) || messagePagination.status === "LoadingFirstPage") return
    const readThroughMessageId = latestMessageId(messages)
    if (readThroughMessageId === null) return
    const readMarker = `${activeChannelId}:${readThroughMessageId}`
    if (lastReadMarkerRef.current === readMarker) return
    lastReadMarkerRef.current = readMarker

    void markChannelRead({ channelId: activeChannelId, readThroughMessageId }).catch((cause: unknown) => {
      logDogfoodDiagnostic("read-marker", cause, dogfoodDiagnostic("mutation", "try-again", cause))
    })
  }, [activeChannelId, activeChannelJoined, activeKind, markChannelRead, messagePagination.status, messages, viewerReady])

  useEffect(() => {
    if (workspace === undefined || workspace === null || channelList === undefined) return
    if (selectedConversation?.kind !== "channel") return
    if (channelList.some((channel) => channel.id === selectedChannelId)) return
    setSelectedConversation({ kind: "channel", id: workspace.channel.id })
  }, [channelList, selectedChannelId, selectedConversation, workspace])

  useEffect(() => {
    if (selectedConversation?.kind !== "direct" || directConversations === undefined) return
    if (directConversations.some((conversation) => conversation.id === selectedConversation.id)) return
    if (workspace !== undefined && workspace !== null) {
      setSelectedConversation({ kind: "channel", id: workspace.channel.id })
    }
  }, [directConversations, selectedConversation, workspace])

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
          data: {
            workspace,
            channels: channelList,
            directConversations: stableDirectConversations,
            directConversationCandidates,
            directMessageProfile,
            incomingFriendRequests,
            selectedConversation: activeKind === "direct"
              ? { kind: "direct", id: activeChannelId }
              : { kind: "channel", id: activeChannelId },
            messages,
            members: members ?? [],
            channelMemberInviteCandidates,
            createChannelInviteCandidates,
            channelIndicators: Array.from(new Map([...(Array.isArray(channelIndicators) ? channelIndicators : []), ...(Array.isArray(directIndicators) ? directIndicators : [])]
              .map((indicator) => [indicator.channelId, indicator])).values())
          },
          state: {
            messagesLoading: messagePagination.status === "LoadingFirstPage",
            messagesHasMore: messagePagination.status === "CanLoadMore" || messagePagination.status === "LoadingMore",
            messagesLoadingMore: messagePagination.status === "LoadingMore",
            membersLoading: members === undefined,
            directConversationsLoading: directConversations === undefined
          },
          commands: {
            loadOlderMessages: () => messagePagination.loadMore(50),
            createChannel: async (input) => {
              const channel = await createChannel(input)
              setCreatedChannels((existing) => mergeDogfoodChannels(existing, [channel]))
              setJoinedChannelIds((existing) => new Set([...existing, channel.id]))
              setSelectedConversation({ kind: "channel", id: channel.id })
              return channel
            },
            selectChannel: (channelId) => setSelectedConversation({ kind: "channel", id: channelId }),
            selectDirectConversation: (conversationId) => setSelectedConversation({ kind: "direct", id: conversationId }),
            startDirectConversation: async (recipientUserId) => {
              const conversation = await startOrReopenDirectConversation({
                recipientUserId
              })
              setStableDirectConversations((existing) => {
                const withoutConversation = existing.filter((item) => item.id !== conversation.id)
                return [conversation, ...withoutConversation]
              })
              setSelectedConversation({ kind: "direct", id: conversation.id })
              return conversation
            },
            searchDirectConversationCandidates: (query) => convex.query(api.social.searchUsers, { query }),
            sendFriendRequest,
            updateDirectMessageProfile,
            respondToFriendRequest,
            editChannel,
            deleteChannel: async (input) => {
              await deleteChannel(input)
              if (selectedConversation?.kind === "channel" && selectedConversation.id === input.channelId) {
                setSelectedConversation({ kind: "channel", id: workspace.channel.id })
              }
              setCreatedChannels((existing) => existing.filter((channel) => channel.id !== input.channelId))
            },
            addChannelMember: addPrivateChannelMember,
            removeChannelMember: async (input) => {
              const result = await removePrivateChannelMember(input)
              if (workspace.currentUser.id === input.userId) {
                setSelectedConversation({ kind: "channel", id: workspace.channel.id })
                setJoinedChannelIds((existing) => {
                  const next = new Set(existing)
                  next.delete(input.channelId)
                  return next
                })
                setCreatedChannels((existing) => existing.filter((channel) => channel.id !== input.channelId))
              }
              return result
            },
            sendMessage,
            uploadMessageAttachment: (file) => uploadAttachment({
              file,
              generateUploadUrl: () => generateAttachmentUploadUrl({}),
              register: (input) => registerAttachmentUpload(input),
              deleteUpload: (input) => deleteAttachmentUpload(input),
              storageIdFromResponse: storageIdFromUploadResponse,
              storageIdToString: String
            }),
            discardMessageAttachment: deleteAttachmentUpload,
            editMessage,
            deleteMessage,
            toggleMessageReaction,
            searchMessages: (input) => convex.query(api.chat.searchChannelMessages, input),
            operationErrorMessage: dogfoodOperationErrorMessage
          }
        }),
    [activeChannelId, activeKind, addPrivateChannelMember, channelIndicators, channelList, channelMemberInviteCandidates, convex, createChannel, createChannelInviteCandidates, deleteAttachmentUpload, deleteChannel, deleteMessage, directConversationCandidates, directConversations, directIndicators, directMessageProfile, editChannel, editMessage, generateAttachmentUploadUrl, incomingFriendRequests, members, messagePagination, messages, registerAttachmentUpload, removePrivateChannelMember, respondToFriendRequest, selectedConversation, sendFriendRequest, sendMessage, stableDirectConversations, startOrReopenDirectConversation, toggleMessageReaction, updateDirectMessageProfile, workspace]
  )

  if (auth.isLoading) {
    return <DogfoodShell title="Checking Session" variant="plain">Loading your Aether session...</DogfoodShell>
  }

  if (auth.user === null) {
    const previousAccount = accountContext?.accounts.find((account) => !account.current && account.displayName !== "Sign in")
    return (
      <DogfoodShell title="Welcome to Aether" variant="plain">
        <button
          type="button"
          className={dogfoodPrimaryButtonClassName}
          disabled={signInOpening || (window.aetherShell !== undefined && accountContext === null)}
          onClick={() => void signInInDefaultBrowser(auth, setSignInOpening, setError, accountContext)}
        >
          {signInOpening ? "Opening browser..." : accountContext === null && window.aetherShell !== undefined ? "Loading account..." : "Sign in"}
        </button>
        {previousAccount === undefined
          ? null
          : (
            <button
              type="button"
              className={dogfoodSecondaryButtonClassName}
              onClick={() => void switchWindowAccount(previousAccount.id)}
            >
              Back to {previousAccount.displayName}
            </button>
          )}
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
        <button type="button" className={dogfoodSecondaryButtonClassName} onClick={() => void signOutCurrentAccount(auth, accountContext)}>
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
      profileMenuActions={profileMenuActions(auth, accountContext, setError)}
    />
  )
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
    const url = await auth.getSignInUrl(accountContext === null
      ? {}
      : {
          state: {
            aetherWindowId: accountContext.windowId,
            aetherAccountId: accountContext.currentAccountId
          }
        })
    await openExternalUrl(url)
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
    return [{
      label: "Sign out",
      onSelect: () => auth.signOut({ returnTo: authKitSignOutReturnTo() })
    }]
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
