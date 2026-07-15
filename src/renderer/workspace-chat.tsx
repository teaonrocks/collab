import {
  Check,
  Copy,
  Ellipsis,
  File as FileIcon,
  Hash,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  Search,
  SendHorizontal,
  Square,
  SquareCheck,
  Trash2,
  UserMinus,
  UserRoundCog,
  X,
  Users
} from "lucide-react"
import { type FormEvent, type RefObject, useEffect, useMemo, useRef, useState } from "react"
import "./App.css"
import { MESSAGE_ATTACHMENT_POLICY } from "../shared/attachment-policy"
import { useAttachmentDraft } from "./attachment-draft"
import type {
  ChatChannel,
  ChatChannelId,
  ChatChannelIndicator,
  ChatChannelInviteCandidate,
  ChatChannelMember,
  ChatDirectConversation,
  ChatDirectMessageProfile,
  ChatDataModel,
  ChatDataView,
  ChatMessage,
  ChatMessageAttachment,
  ChatMessageGuard,
  ChatMessageId,
  ChatOperationErrorMessage,
  SearchChatMessages,
  SelectChatChannel
} from "./chat-data"
import { activeConversationId, activeConversationName } from "./chat-data"
import {
  type MessageRowState,
  useMessageInteractions
} from "./message-interactions"
import {
  type ChannelMessageGroup,
  type ChannelMessageSearchResult,
  type ChannelMessageSearchState,
  createChannelViewModel,
  filterDirectConversationCandidates,
  filterMentionMembers,
  formatClockPart,
  formatDatePart,
  formatTime,
  getMentionRequest,
  groupConsecutiveMessages,
  initials,
  MESSAGE_SEARCH_MAX_QUERY_LENGTH,
  mergeChannelMembers,
  resizeTextarea,
  searchChannelMessages,
  toIso
} from "./workspace-chat-model"
import { cn } from "./lib/cn"
import {
  Avatar,
  Button,
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  Textarea
} from "./ui"

type ChannelNameValidation =
  | { readonly valid: true; readonly name: string }
  | { readonly valid: false; readonly message: string }

export type ProfileMenuAction = {
  readonly id?: string
  readonly label: string
  readonly detail?: string
  readonly selected?: boolean
  readonly separatorBefore?: boolean
  readonly tone?: "default" | "destructive"
  readonly onSelect: () => void
}

const MESSAGE_CONTEXT_MENU_WIDTH = 170
const MESSAGE_CONTEXT_MENU_OFFSET = 6
const COMPOSER_MIN_HEIGHT = 44
const COMPOSER_MAX_HEIGHT = 140
const MESSAGE_EDIT_MAX_HEIGHT = 180
const normalizeChannelName = (name: string): string =>
  name.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase()

const validateChannelName = (rawName: string): ChannelNameValidation => {
  const name = normalizeChannelName(rawName)
  if (name.length === 0) return { valid: false, message: "Channel name is required." }
  if (!/^[a-z0-9_-]+$/.test(name)) {
    return { valid: false, message: "Use letters, numbers, dashes, or underscores." }
  }
  return { valid: true, name }
}

const channelCreateErrorMessage = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/already exists/i.test(message)) return "Channel already exists."
  if (/channel name is required/i.test(message)) return "Channel name is required."
  if (/letters, numbers, dashes, and underscores/i.test(message)) {
    return "Use letters, numbers, dashes, or underscores."
  }
  return "Could not create channel. Check your connection and try again."
}

const chatTimelineClassName =
  "chatTimeline row-start-2 flex min-h-0 list-none flex-col gap-0.5 overflow-auto px-4 pb-[18px] pt-3.5 [--message-avatar-column:40px] [--message-column-gap:10px] [--message-group-x:10px]"
const channelMessageGroupClassName =
  "channelMessageGroup min-w-0"
const channelMessageClassName =
  "channelMessage group/message relative grid min-w-0 grid-cols-[var(--message-avatar-column)_minmax(0,1fr)] items-start gap-[var(--message-column-gap)] border border-transparent bg-transparent px-[var(--message-group-x)] py-2 hover:bg-surface-muted has-[:focus-visible]:bg-surface-muted"
const messageContentClassName =
  "messageContent min-w-0 w-full"
const messageBodyClassName =
  "mb-0 mt-[3px] w-full text-sm leading-[1.42] text-foreground break-words"
const iconClassName =
  "size-4 [stroke-width:2]"
const messageActionButtonClassName =
  "size-[34px] min-h-[30px] rounded-none border-0 border-l border-surface-rail bg-surface-raised text-foreground-muted first:border-l-0 hover:bg-surface-muted hover:text-foreground"
const loadingShellClassName =
  "loadingShell grid min-h-screen w-full place-items-center overflow-hidden bg-surface-canvas p-6 font-sans text-foreground"
const appShellClassName =
  "appShell grid h-full min-h-0 w-full overflow-hidden bg-surface-canvas font-sans text-foreground [grid-template-areas:'rail_sidebar_header_header'_'rail_sidebar_chat_members'] [grid-template-columns:56px_minmax(200px,236px)_minmax(360px,1fr)_minmax(280px,320px)] [grid-template-rows:56px_minmax(0,1fr)] [&_*]:box-border max-[920px]:[grid-template-areas:'rail_header'_'rail_chat'] max-[920px]:[grid-template-columns:56px_minmax(0,1fr)]"
const appShellMembersCollapsedClassName =
  "membersCollapsed [grid-template-areas:'rail_sidebar_header'_'rail_sidebar_chat'] [grid-template-columns:56px_minmax(200px,236px)_minmax(360px,1fr)] max-[920px]:[grid-template-areas:'rail_header'_'rail_chat'] max-[920px]:[grid-template-columns:56px_minmax(0,1fr)]"
const appShellDirectConversationClassName =
  "directConversation [grid-template-areas:'rail_header'_'rail_chat'] [grid-template-columns:56px_minmax(0,1fr)]"
const railItemClassName =
  "group/rail relative grid size-9 cursor-pointer place-items-center rounded-card border-0 bg-surface-muted text-[13px] font-extrabold text-foreground"
const railTooltipClassName =
  "pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-30 flex min-h-7 max-w-[180px] -translate-y-1/2 -translate-x-1 items-center whitespace-nowrap rounded-control bg-foreground px-[9px] text-xs font-bold leading-none text-foreground-inverse opacity-0 transition-[opacity,transform] duration-150 before:absolute before:right-full before:top-1/2 before:size-0 before:-translate-y-1/2 before:border-y-[5px] before:border-r-[5px] before:border-y-transparent before:border-r-foreground group-hover/rail:translate-x-0 group-hover/rail:opacity-100 group-focus-visible/rail:translate-x-0 group-focus-visible/rail:opacity-100"
const channelNavItemClassName =
  "channelNavItem group/channel flex min-h-[34px] w-full items-center justify-between gap-2 rounded-none border-0 bg-transparent px-5 py-[7px] text-left font-[inherit] text-foreground-muted hover:bg-surface-muted-hover"
const memberListClassName =
  "memberList m-0 flex list-none flex-col gap-2 p-0"
const memberItemClassName =
  "grid min-w-0 grid-cols-[36px_minmax(0,1fr)] items-center gap-2.5"
const memberNameClassName =
  "block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold text-foreground"
const memberRoleClassName =
  "mt-0.5 block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-foreground-subtle"
const skeletonBlockClassName =
  "block overflow-hidden rounded-panel bg-[linear-gradient(90deg,var(--aether-color-surface-muted-hover)_0%,var(--aether-color-surface-shimmer)_48%,var(--aether-color-surface-muted-hover)_100%)] bg-[length:220%_100%] motion-safe:animate-[skeletonPulse_1.15s_ease-in-out_infinite]"

const channelIndicatorDescription = (indicator: ChatChannelIndicator, channelName: string): string =>
  indicator === "mentioned"
    ? `Mention in #${channelName} since you last opened it. No native push is sent.`
    : `Unread messages in #${channelName} since you last opened it. No native push is sent.`

const directConversationIndicatorDescription = (indicator: ChatChannelIndicator, recipientName: string): string =>
  indicator === "mentioned"
    ? `Mention in direct message with ${recipientName} since you last opened it.`
    : `Unread direct messages with ${recipientName} since you last opened it.`

const directConversationButtonLabel = (
  recipientName: string,
  indicator: ChatChannelIndicator | undefined
): string =>
  indicator === undefined
    ? recipientName
    : `${recipientName}, ${directConversationIndicatorDescription(indicator, recipientName)}`

export function WorkspaceChat(props: {
  readonly model: ChatDataModel
  readonly createChannelMessage: ChatDataView["createChannelMessage"]
  readonly uploadMessageAttachment?: ChatDataView["uploadMessageAttachment"]
  readonly discardMessageAttachment?: ChatDataView["discardMessageAttachment"]
  readonly deleteChannelMessage: ChatDataView["deleteChannelMessage"]
  readonly createChannel?: ChatDataView["createChannel"]
  readonly editChannel?: ChatDataView["editChannel"]
  readonly deleteChannel?: ChatDataView["deleteChannel"]
  readonly selectChannel?: SelectChatChannel
  readonly selectDirectConversation?: ChatDataView["selectDirectConversation"]
  readonly startDirectConversation?: ChatDataView["startDirectConversation"]
  readonly searchDirectConversationCandidates?: ChatDataView["searchDirectConversationCandidates"]
  readonly sendFriendRequest?: ChatDataView["sendFriendRequest"]
  readonly updateDirectMessageProfile?: ChatDataView["updateDirectMessageProfile"]
  readonly respondToFriendRequest?: ChatDataView["respondToFriendRequest"]
  readonly addChannelMember?: ChatDataView["addChannelMember"]
  readonly removeChannelMember?: ChatDataView["removeChannelMember"]
  readonly editChannelMessage?: ChatDataView["editChannelMessage"]
  readonly toggleMessageReaction?: ChatDataView["toggleMessageReaction"]
  readonly searchChannelMessages?: SearchChatMessages
  readonly loadOlderChannelMessages?: ChatDataView["loadOlderChannelMessages"]
  readonly canDeleteMessages?: boolean
  readonly canDeleteMessage?: ChatMessageGuard
  readonly canEditMessage?: ChatMessageGuard
  readonly operationErrorMessage?: ChatOperationErrorMessage
  readonly profileMenuActions?: ReadonlyArray<ProfileMenuAction>
}) {
  const {
    model,
    createChannel,
    editChannel,
    deleteChannel,
    selectChannel,
    selectDirectConversation,
    startDirectConversation,
    searchDirectConversationCandidates,
    sendFriendRequest,
    updateDirectMessageProfile,
    respondToFriendRequest,
    createChannelMessage,
    uploadMessageAttachment,
    discardMessageAttachment,
    deleteChannelMessage,
    editChannelMessage,
    toggleMessageReaction,
    searchChannelMessages: searchChannelHistory,
    loadOlderChannelMessages,
    addChannelMember,
    removeChannelMember,
    canDeleteMessages = true,
    canDeleteMessage,
    canEditMessage,
    operationErrorMessage,
    profileMenuActions = []
  } = props
  const activeConversation = model.activeConversation.kind === "channel"
    ? { kind: "channel" as const, channel: model.channel }
    : model.activeConversation
  const activeId = activeConversationId(activeConversation)
  const activeName = activeConversationName(activeConversation)
  const activeChannel = activeConversation.kind === "channel" ? activeConversation.channel : null
  const [messageDraft, setMessageDraft] = useState("")
  const [operationError, setOperationError] = useState<string | null>(null)
  const [channelOperationError, setChannelOperationError] = useState<string | null>(null)
  const [membersOpen, setMembersOpen] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [directMessageSettingsOpen, setDirectMessageSettingsOpen] = useState(false)
  const [messageSearchQuery, setMessageSearchQuery] = useState("")
  const [activeSearchMessageId, setActiveSearchMessageId] = useState<ChatMessageId | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [replyParent, setReplyParent] = useState<ChatMessage | null>(null)
  const attachmentDraft = useAttachmentDraft({
    channelId: activeId,
    upload: uploadMessageAttachment,
    discard: discardMessageAttachment,
    operationErrorMessage,
    reportError: setOperationError
  })
  const view = useMemo(() => createChannelViewModel(model), [model])
  const localMessageSearchState = useMemo(
    () => searchChannelMessages(model.channelMessages, messageSearchQuery),
    [model.channelMessages, messageSearchQuery]
  )
  const [remoteMessageSearchState, setRemoteMessageSearchState] = useState<ChannelMessageSearchState>({ status: "idle" })
  const messageSearchState = searchChannelHistory === undefined ? localMessageSearchState : remoteMessageSearchState
  const activeSearchMessage = messageSearchState.status === "results"
    ? messageSearchState.results.find((result) => result.message.id === activeSearchMessageId)?.message
    : undefined
  const displayedMessages = useMemo(() => {
    if (activeSearchMessage === undefined || model.channelMessages.some((message) => message.id === activeSearchMessage.id)) {
      return model.channelMessages
    }
    return [...model.channelMessages, activeSearchMessage].sort((left, right) => left.createdAt - right.createdAt)
  }, [activeSearchMessage, model.channelMessages])
  const messageGroups = useMemo(() => groupConsecutiveMessages(displayedMessages), [displayedMessages])
  const channelMessagesLoading = model.channelMessagesLoading === true
  const channelMembersLoading = model.channelMembers === undefined
    ? channelMessagesLoading
    : model.channelMembersLoading === true
  const [directMessageMembers, setDirectMessageMembers] = useState<ReadonlyArray<ChatChannelMember>>([])
  const visibleMembers = model.channelMembers ?? directMessageMembers
  const messageInteractions = useMessageInteractions({
    channelId: activeId,
    messages: model.channelMessages,
    deleteChannelMessage,
    editChannelMessage,
    operationErrorMessage,
    setOperationError
  })

  useEffect(() => {
    if (searchChannelHistory === undefined) return
    const query = messageSearchQuery.trim()
    if (query.length === 0) {
      setRemoteMessageSearchState({ status: "idle" })
      return
    }
    if (query.length > MESSAGE_SEARCH_MAX_QUERY_LENGTH) {
      setRemoteMessageSearchState({
        status: "error",
        message: `Search is limited to ${MESSAGE_SEARCH_MAX_QUERY_LENGTH} characters.`
      })
      return
    }

    let cancelled = false
    setRemoteMessageSearchState({ status: "loading" })
    const timeout = window.setTimeout(() => {
      void searchChannelHistory({ channelId: activeId, query })
        .then((messages) => {
          if (cancelled) return
          setRemoteMessageSearchState(messages.length === 0
            ? { status: "empty" }
            : { status: "results", results: messages.map((message) => ({ message, bodyPreview: message.body })) })
        })
        .catch(() => {
          if (!cancelled) setRemoteMessageSearchState({ status: "error", message: "Could not search messages." })
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [activeId, messageSearchQuery, searchChannelHistory])

  useEffect(() => {
    setMessageDraft("")
    setOperationError(null)
    setChannelOperationError(null)
    setSearchOpen(false)
    setMessageSearchQuery("")
    setActiveSearchMessageId(null)
    setReplyParent(null)
  }, [activeId])

  useEffect(() => {
    if (replyParent === null) return
    const latestParent = model.channelMessages.find((message) => message.id === replyParent.id)
    if (latestParent === undefined || latestParent.deletedAt !== null) setReplyParent(null)
  }, [model.channelMessages, replyParent])

  useEffect(() => {
    if (channelMessagesLoading) return
    setDirectMessageMembers((members) => mergeChannelMembers(members, view.members))
  }, [channelMessagesLoading, view.members])

  useEffect(() => {
    if (!profileMenuOpen) return
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileMenuOpen(false)
    }
    window.addEventListener("keydown", closeMenuOnEscape)
    return () => window.removeEventListener("keydown", closeMenuOnEscape)
  }, [profileMenuOpen])

  useEffect(() => {
    const openSearchOnHotkey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "f") return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      event.preventDefault()
      if (!searchOpen) {
        setSearchOpen(true)
        return
      }
      if (document.activeElement === searchInputRef.current) {
        setSearchOpen(false)
        setActiveSearchMessageId(null)
        return
      }
      searchInputRef.current?.focus()
    }
    window.addEventListener("keydown", openSearchOnHotkey)
    return () => window.removeEventListener("keydown", openSearchOnHotkey)
  }, [searchOpen])

  useEffect(() => {
    if (!searchOpen) return
    const closeSearchOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      if (document.activeElement === searchInputRef.current) {
        setSearchOpen(false)
        setActiveSearchMessageId(null)
        return
      }
      if (activeSearchMessageId !== null) {
        searchInputRef.current?.focus()
        return
      }
      setSearchOpen(false)
    }
    window.addEventListener("keydown", closeSearchOnEscape, true)
    return () => window.removeEventListener("keydown", closeSearchOnEscape, true)
  }, [searchOpen, activeSearchMessageId])

  const copyMessage = (message: ChatMessage) => {
    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
      void navigator.clipboard.writeText(message.body).catch(() => {})
    }
  }

  const toggleReaction = (message: ChatMessage, emoji: string): Promise<void> => {
    if (toggleMessageReaction === undefined) return Promise.resolve()
    return toggleMessageReaction({ channelId: activeId, messageId: message.id, emoji })
      .then(() => setOperationError(null))
      .catch((cause: unknown) => {
        setOperationError(operationErrorMessage?.("react", cause) ?? "Could not update reaction.")
        throw cause
      })
  }

  const sendChannelMessage = () => {
    if (channelMessagesLoading || attachmentDraft.uploading) return
    const body = messageDraft.trim()
    if (body.length === 0 && attachmentDraft.attachments.length === 0) return
    setOperationError(null)
    void attachmentDraft.send((attachments) => createChannelMessage({
      channelId: activeId,
      body,
      parentMessageId: replyParent?.id ?? null,
      ...(attachments.length === 0 ? {} : { attachments })
    }))
      .then((result) => {
        if (result !== "success") return
        setMessageDraft("")
        setReplyParent(null)
      })
  }

  const messageCanDelete = (message: ChatMessage): boolean =>
    canDeleteMessages && (canDeleteMessage?.(message) ?? true)

  const messageCanEdit = (message: ChatMessage): boolean =>
    editChannelMessage !== undefined && (canEditMessage?.(message) ?? true)

  const menuMessage = messageInteractions.menuMessage
  const messageMenu = messageInteractions.messageMenu
  const pendingDeleteMessage = messageInteractions.pendingDeleteMessage

  return (
    <main className={classNames(
      appShellClassName,
      activeConversation.kind === "direct"
        ? appShellDirectConversationClassName
        : !membersOpen && appShellMembersCollapsedClassName
    )}>
      <WorkspaceRail
        workspaceName={model.workspace.name}
        currentUserName={model.currentUser.displayName}
        conversations={model.directConversations}
        indicators={new Map(model.channelIndicators?.map((state) => [state.channelId, state.indicator]))}
        activeConversationId={activeConversation.kind === "direct" ? activeId : null}
        onSelectConversation={selectDirectConversation}
        candidates={model.directConversationCandidates}
        conversationsLoading={model.directConversationsLoading === true}
        onStartConversation={startDirectConversation}
        onSearchConversationCandidates={searchDirectConversationCandidates}
        onSendFriendRequest={sendFriendRequest}
        profileMenuOpen={profileMenuOpen}
        profileMenuActions={model.directMessageProfile === undefined || updateDirectMessageProfile === undefined
          ? profileMenuActions
          : [{ label: "DM settings", onSelect: () => setDirectMessageSettingsOpen(true) }, ...profileMenuActions]}
        onOpenProfileMenu={() => setProfileMenuOpen(true)}
        onCloseProfileMenu={() => setProfileMenuOpen(false)}
      />
      {directMessageSettingsOpen && model.directMessageProfile !== undefined && updateDirectMessageProfile !== undefined
        ? <DirectMessageSettingsDialog
            profile={model.directMessageProfile}
            incomingFriendRequests={model.incomingFriendRequests ?? []}
            onSave={updateDirectMessageProfile}
            onRespondToFriendRequest={respondToFriendRequest}
            onClose={() => setDirectMessageSettingsOpen(false)}
          />
        : null}

      {activeConversation.kind === "direct" ? null : <ChannelSidebar
        workspaceName={model.workspace.name}
        channels={model.channels}
        activeChannelId={activeChannel?.id ?? null}
        channelName={activeChannel?.name ?? ""}
        channelVisibility={activeChannel?.visibility ?? "private"}
        channelIndicators={view.channelIndicators}
        channelOperationError={channelOperationError}
        createChannelInviteCandidates={model.createChannelInviteCandidates}
        createChannel={createChannel}
        editChannel={editChannel}
        deleteChannel={deleteChannel}
        onSelectChannel={selectChannel}
        onManageChannel={(channelId) => {
          selectChannel?.(channelId)
          setMembersOpen(true)
        }}
        onChannelOperationError={setChannelOperationError}
      />}

      <ChannelHeader
        channelName={activeName}
        direct={activeConversation.kind === "direct"}
        searchOpen={searchOpen}
        membersOpen={membersOpen}
        onToggleSearch={() => {
          setSearchOpen((open) => {
            if (open) setActiveSearchMessageId(null)
            return !open
          })
        }}
        onToggleMembers={() => { if (activeChannel !== null) setMembersOpen((open) => !open) }}
      />

      <ChatPane
        channelName={activeName}
        messageGroups={messageGroups}
        loading={channelMessagesLoading}
        messageDraft={messageDraft}
        searchOpen={searchOpen}
        searchInputRef={searchInputRef}
        searchQuery={messageSearchQuery}
        searchState={messageSearchState}
        activeSearchMessageId={activeSearchMessageId}
        operationError={operationError}
        hasMoreMessages={model.channelMessagesHasMore === true}
        loadingMoreMessages={model.channelMessagesLoadingMore === true}
        onLoadOlderMessages={loadOlderChannelMessages}
        onMessageDraftChange={setMessageDraft}
        onSearchQueryChange={(query) => {
          setMessageSearchQuery(query)
          setActiveSearchMessageId(null)
        }}
        onSelectSearchResult={(messageId) =>
          setActiveSearchMessageId((active) => active === messageId ? null : messageId)
        }
        onNextSearchResult={() => {
          if (messageSearchState.status !== "results" || messageSearchState.results.length === 0) return
          const currentIndex = messageSearchState.results.findIndex((result) => result.message.id === activeSearchMessageId)
          const nextResult = messageSearchState.results[(currentIndex + 1) % messageSearchState.results.length]
          if (nextResult !== undefined) setActiveSearchMessageId(nextResult.message.id)
        }}
        onSendMessage={sendChannelMessage}
        onToggleMessage={messageInteractions.toggleMessageSelection}
        onCopyMessage={copyMessage}
        onStartEditMessage={messageInteractions.startEditingMessage}
        onEditDraftChange={messageInteractions.setEditingDraft}
        onCancelEditMessage={messageInteractions.cancelEditingMessage}
        onSaveEditMessage={messageInteractions.saveEditingMessage}
        onDeleteMessage={messageInteractions.requestDeleteMessage}
        replyParent={replyParent}
        attachments={attachmentDraft.attachments}
        attachmentUploadAvailable={attachmentDraft.uploadAvailable}
        uploadingAttachment={attachmentDraft.uploading}
        onCancelReply={() => setReplyParent(null)}
        onChooseAttachments={attachmentDraft.choose}
        onRemoveAttachment={attachmentDraft.remove}
        onToggleReaction={toggleMessageReaction === undefined ? undefined : toggleReaction}
        mentionMembers={visibleMembers}
        mentionMembersLoading={channelMembersLoading}
        canDeleteMessage={messageCanDelete}
        canEditMessage={messageCanEdit}
        getMessageRowState={messageInteractions.getRowState}
        onOpenMessageMenu={messageInteractions.openMessageMenu}
      />

      {activeChannel === null ? null : <MembersPanel
        channel={activeChannel}
        members={visibleMembers}
        inviteCandidates={model.channelMemberInviteCandidates}
        currentUserId={model.currentUser.id}
        loading={channelMembersLoading}
        open={membersOpen}
        addChannelMember={addChannelMember}
        removeChannelMember={removeChannelMember}
      />}

      {menuMessage === null || messageMenu === null
        ? null
        : (
          <MessageContextMenu
            message={menuMessage}
            selected={messageInteractions.selectedMessageIdSet.has(menuMessage.id)}
            x={messageMenu.x}
            y={messageMenu.y}
            onToggle={() => messageInteractions.toggleMessageSelection(menuMessage.id)}
            onCopy={() => copyMessage(menuMessage)}
            onEdit={() => messageInteractions.startEditingMessage(menuMessage)}
            onReply={() => setReplyParent(menuMessage)}
            onDelete={() => messageInteractions.requestDeleteMessage(menuMessage.id)}
            canEdit={messageCanEdit(menuMessage)}
            canDelete={messageCanDelete(menuMessage)}
            onClose={messageInteractions.closeMessageMenu}
          />
        )}

      {pendingDeleteMessage === null
        ? null
        : (
          <DeleteMessageDialog
            authorDisplayName={pendingDeleteMessage.authorDisplayName}
            operationError={operationError}
            onCancel={messageInteractions.cancelDeleteMessage}
            onConfirm={messageInteractions.confirmDeleteMessage}
          />
        )}
    </main>
  )
}

function WorkspaceRail(props: {
  readonly workspaceName: string
  readonly currentUserName: string
  readonly conversations: ReadonlyArray<ChatDirectConversation>
  readonly indicators: ReadonlyMap<ChatChannelId, ChatChannelIndicator>
  readonly activeConversationId: ChatChannelId | null
  readonly onSelectConversation?: ChatDataView["selectDirectConversation"]
  readonly candidates?: ReadonlyArray<ChatChannelMember>
  readonly conversationsLoading: boolean
  readonly onStartConversation?: ChatDataView["startDirectConversation"]
  readonly onSearchConversationCandidates?: ChatDataView["searchDirectConversationCandidates"]
  readonly onSendFriendRequest?: ChatDataView["sendFriendRequest"]
  readonly profileMenuOpen: boolean
  readonly profileMenuActions: ReadonlyArray<ProfileMenuAction>
  readonly onOpenProfileMenu: () => void
  readonly onCloseProfileMenu: () => void
}) {
  const {
    workspaceName,
    currentUserName,
    conversations,
    indicators,
    activeConversationId,
    onSelectConversation,
    candidates,
    conversationsLoading,
    onStartConversation,
    onSearchConversationCandidates,
    onSendFriendRequest,
    profileMenuOpen,
    profileMenuActions,
    onOpenProfileMenu,
    onCloseProfileMenu
  } = props
  const hasProfileActions = profileMenuActions.length > 0
  const [startOpen, setStartOpen] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  return (
    <aside className="workspaceRail flex h-full min-h-0 min-w-0 flex-col items-center gap-3 border-r border-border bg-surface-rail px-2 py-3 [grid-area:rail]" aria-label="Global navigation">
      <nav className="railGroup flex w-full flex-col items-center gap-2" aria-label="Workspaces">
        <button
          type="button"
          className={classNames(
            railItemClassName,
            "active bg-surface-canvas outline-2 outline-border before:absolute before:-left-2 before:h-6 before:w-[3px] before:rounded-r-[3px] before:bg-foreground"
          )}
          aria-label={workspaceName}
        >
          {initials(workspaceName)}
          <span className={railTooltipClassName} role="tooltip">{workspaceName}</span>
        </button>
      </nav>
      <div className="railDivider h-px w-8 shrink-0 bg-border-strong" role="separator" aria-label="Direct messages" />
      <nav className="railGroup flex w-full flex-col items-center gap-2" aria-label="Direct messages">
        {onStartConversation === undefined
          ? null
          : (
            <button
              ref={addButtonRef}
              type="button"
              className={classNames(railItemClassName, "rounded-full text-foreground-muted")}
              aria-label="Start direct message"
              onClick={() => setStartOpen(true)}
            >
              <Plus className={iconClassName} aria-hidden="true" />
              <span className={railTooltipClassName} role="tooltip">Start direct message</span>
            </button>
          )}
        {conversationsLoading && conversations.length === 0
          ? <span className="sr-only" role="status">Loading direct messages...</span>
          : conversations.length === 0
            ? <span className="sr-only">No direct messages yet.</span>
            : null}
        {conversations.map((conversation) => {
          const indicator = conversation.id === activeConversationId ? undefined : indicators.get(conversation.id)
          const indicatorDescription = indicator === undefined
            ? undefined
            : directConversationIndicatorDescription(indicator, conversation.otherUser.displayName)
          return (
          <button
            key={conversation.id}
            type="button"
            className={classNames(railItemClassName, "dmRailItem rounded-full", conversation.id === activeConversationId && "active bg-surface-canvas outline-2 outline-border")}
            aria-label={directConversationButtonLabel(conversation.otherUser.displayName, indicator)}
            aria-current={conversation.id === activeConversationId ? "page" : undefined}
            onClick={() => onSelectConversation?.(conversation.id)}
          >
            {initials(conversation.otherUser.displayName)}
            {indicator === undefined ? null : <span className="absolute right-0 top-0 size-2 rounded-full bg-accent" title={indicatorDescription} />}
            <span className={railTooltipClassName} role="tooltip">{conversation.otherUser.displayName}</span>
          </button>
          )
        })}
      </nav>
      <div className="railSpacer flex-1" />
      <div
        className="railProfile relative"
        onMouseEnter={() => {
          if (hasProfileActions) onOpenProfileMenu()
        }}
        onMouseLeave={() => {
          if (hasProfileActions) onCloseProfileMenu()
        }}
        onFocusCapture={() => {
          if (hasProfileActions) onOpenProfileMenu()
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onCloseProfileMenu()
        }}
      >
        <button
          type="button"
          className="railUser grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-surface-muted p-0 text-[11px] font-extrabold text-foreground disabled:cursor-default"
          title={currentUserName}
          aria-label={hasProfileActions ? `Profile menu for ${currentUserName}` : currentUserName}
          aria-haspopup={hasProfileActions ? "menu" : undefined}
          aria-expanded={hasProfileActions ? profileMenuOpen : undefined}
          disabled={!hasProfileActions}
        >
          {initials(currentUserName)}
        </button>
        {profileMenuOpen && hasProfileActions
          ? (
            <>
              <div className="profileMenuBridge absolute bottom-0 left-full z-30 h-8 w-2.5" aria-hidden="true" />
              <div className="profileMenu absolute bottom-0 left-[calc(100%+10px)] z-40 flex max-h-[calc(100dvh-24px)] w-[248px] flex-col overflow-hidden rounded-panel border border-border-strong bg-surface-canvas shadow-popover" role="menu" aria-label="Profile settings">
                <div className="profileMenuHeader shrink-0 border-b border-surface-rail p-2.5">
                  <strong className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-tight text-foreground">{currentUserName}</strong>
                </div>
                <div className="profileMenuActions min-h-0 overflow-y-auto overscroll-contain" role="group" aria-label="Accounts and profile actions">
                  {profileMenuActions.map((action) => (
                    <button
                      key={action.id ?? action.label}
                      type="button"
                      role="menuitem"
                      className={classNames(
                        "relative grid min-h-9 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-1.5 border-0 bg-surface-canvas px-2.5 py-2 text-left font-[inherit] text-[13px] text-foreground hover:bg-surface-muted focus-visible:bg-surface-muted",
                        action.separatorBefore && "border-t border-t-surface-rail",
                        action.tone === "destructive" && "text-destructive-text"
                      )}
                      onClick={() => {
                        onCloseProfileMenu()
                        action.onSelect()
                      }}
                    >
                      <span className="grid size-[18px] place-items-center" aria-hidden="true">
                        {action.selected === true ? <Check className="size-3.5 [stroke-width:2.25]" /> : null}
                      </span>
                      <span className="min-w-0">
                        <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-tight">{action.label}</strong>
                        {action.detail === undefined
                          ? null
                          : <span className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-normal leading-tight text-foreground-subtle">{action.detail}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )
          : null}
      </div>
      {startOpen && onStartConversation !== undefined
        ? <StartDirectMessageDialog
            candidates={candidates}
            onStart={onStartConversation}
            onSearch={onSearchConversationCandidates}
            onSendFriendRequest={onSendFriendRequest}
            onClose={() => {
              setStartOpen(false)
              window.setTimeout(() => addButtonRef.current?.focus(), 0)
            }}
          />
        : null}
    </aside>
  )
}

function DirectMessageSettingsDialog(props: {
  readonly profile: ChatDirectMessageProfile
  readonly incomingFriendRequests: NonNullable<ChatDataModel["incomingFriendRequests"]>
  readonly onSave: NonNullable<ChatDataView["updateDirectMessageProfile"]>
  readonly onRespondToFriendRequest?: ChatDataView["respondToFriendRequest"]
  readonly onClose: () => void
}) {
  const { profile, incomingFriendRequests, onSave, onRespondToFriendRequest, onClose } = props
  const [username, setUsername] = useState(profile.username ?? "")
  const [preference, setPreference] = useState(profile.directMessagePreference)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = () => {
    if (saving) return
    setSaving(true)
    setError(null)
    void onSave({ username, directMessagePreference: preference })
      .then(onClose)
      .catch((cause: unknown) => {
        setSaving(false)
        setError(cause instanceof Error ? cause.message : "Could not save DM settings.")
      })
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-[420px]">
        <DialogTitle>DM settings</DialogTitle>
        <DialogDescription>Set the username people use to find you and who can start a new direct message.</DialogDescription>
        <div className="mt-4 grid gap-4">
          <label className="grid gap-1.5 text-sm font-bold text-foreground" htmlFor="dm-username">
            Username
            <Input id="dm-username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={saving} autoCapitalize="none" />
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-bold text-foreground">Who can start a new DM</legend>
            {([
              ["all", "Anyone on Aether"],
              ["mutuals", "People who share a workspace with you"],
              ["friends", "Accepted friends only"]
            ] as const).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm text-foreground">
                <input type="radio" name="dm-preference" value={value} checked={preference === value} disabled={saving} onChange={() => setPreference(value)} />
                {label}
              </label>
            ))}
          </fieldset>
          {incomingFriendRequests.length === 0 ? null : (
            <section className="grid gap-2" aria-label="Friend requests">
              <h3 className="m-0 text-sm font-bold text-foreground">Friend requests</h3>
              {incomingFriendRequests.map((request) => (
                <div key={request.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"><strong>{request.requester.displayName}</strong> <span className="text-foreground-subtle">@{request.requester.username}</span></span>
                  <Button size="sm" disabled={saving || onRespondToFriendRequest === undefined} onClick={() => void onRespondToFriendRequest?.({ friendRequestId: request.id, accept: true })}>Accept</Button>
                  <Button size="sm" variant="secondary" disabled={saving || onRespondToFriendRequest === undefined} onClick={() => void onRespondToFriendRequest?.({ friendRequestId: request.id, accept: false })}>Decline</Button>
                </div>
              ))}
            </section>
          )}
          {error === null ? null : <p className="m-0 text-sm text-destructive-text" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={save}>{saving ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StartDirectMessageDialog(props: {
  readonly candidates?: ReadonlyArray<ChatChannelMember>
  readonly onStart: NonNullable<ChatDataView["startDirectConversation"]>
  readonly onSearch?: ChatDataView["searchDirectConversationCandidates"]
  readonly onSendFriendRequest?: ChatDataView["sendFriendRequest"]
  readonly onClose: () => void
}) {
  const { candidates, onStart, onSearch, onSendFriendRequest, onClose } = props
  const [query, setQuery] = useState("")
  const [searchResults, setSearchResults] = useState<ReadonlyArray<ChatChannelMember> | undefined>(candidates)
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const savingRef = useRef(false)
  const visibleCandidates = onSearch === undefined
    ? filterDirectConversationCandidates(candidates ?? [], query)
    : searchResults ?? []
  const candidateResults = onSearch === undefined ? candidates : searchResults

  useEffect(() => {
    if (onSearch === undefined) {
      setSearchResults(candidates)
      return
    }
    const normalizedQuery = query.trim()
    if (normalizedQuery.length === 0) {
      setSearchResults([])
      return
    }
    let cancelled = false
    void onSearch(normalizedQuery)
      .then((results) => { if (!cancelled) setSearchResults(results) })
      .catch(() => { if (!cancelled) setSearchResults([]) })
    return () => { cancelled = true }
  }, [candidates, onSearch, query])

  const start = (candidate: ChatChannelMember) => {
    if (savingRef.current) return
    savingRef.current = true
    setSavingUserId(candidate.id)
    setError(null)
    void onStart(candidate.id)
      .then(onClose)
      .catch(() => {
        savingRef.current = false
        setSavingUserId(null)
        setError("Could not open this direct message. Check your connection and try again.")
      })
  }

  const sendFriendRequest = (candidate: ChatChannelMember) => {
    if (savingRef.current || onSendFriendRequest === undefined) return
    savingRef.current = true
    setSavingUserId(candidate.id)
    setError(null)
    void onSendFriendRequest(candidate.id)
      .then(() => {
        savingRef.current = false
        setSavingUserId(null)
        const normalizedQuery = query.trim()
        if (onSearch !== undefined && normalizedQuery.length > 0) {
          setSearchResults(undefined)
          void onSearch(normalizedQuery)
            .then(setSearchResults)
            .catch(() => setSearchResults([]))
        }
      })
      .catch(() => {
        savingRef.current = false
        setSavingUserId(null)
        setError("Could not send the friend request. Check your connection and try again.")
      })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="directMessageDialog max-w-[420px]">
        <DialogTitle>Start Direct Message</DialogTitle>
        <DialogDescription className="sr-only">Search Aether accounts by username, open a direct conversation, or send a friend request.</DialogDescription>
        <div className="mt-3 flex flex-col gap-2">
          <label className="sr-only" htmlFor="direct-message-member-search">Search usernames</label>
          <Input
            id="direct-message-member-search"
            type="search"
            value={query}
            placeholder="Search usernames"
            autoFocus
            disabled={savingUserId !== null}
            onChange={(event) => {
              const nextQuery = event.target.value
              setQuery(nextQuery)
              if (onSearch !== undefined) setSearchResults(nextQuery.trim().length === 0 ? [] : undefined)
            }}
          />
          <div className="max-h-60 overflow-y-auto rounded-control border border-border bg-surface-canvas p-1" aria-label="Aether accounts">
            {onSearch !== undefined && query.trim().length === 0
              ? <p className="m-0 px-2 py-3 text-sm text-foreground-subtle">Search for a username to begin.</p>
              : candidateResults === undefined
                ? <p className="m-0 px-2 py-3 text-sm text-foreground-subtle" role="status">Loading accounts...</p>
              : candidateResults.length === 0
                ? <p className="m-0 px-2 py-3 text-sm text-foreground-subtle">No accounts are available.</p>
                : visibleCandidates.length === 0
                  ? <p className="m-0 px-2 py-3 text-sm text-foreground-subtle">No matching accounts.</p>
                  : visibleCandidates.map((candidate) => (
                      <div key={candidate.id} className="flex min-h-10 items-center gap-2 rounded-control px-2 text-sm text-foreground hover:bg-surface-muted">
                        <Avatar name={candidate.displayName} aria-hidden="true" className="size-8" />
                        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"><strong className="block">{candidate.displayName}</strong><span className="text-xs text-foreground-subtle">@{candidate.username}</span></span>
                        {savingUserId === candidate.id ? <span className="text-xs text-foreground-subtle">Working...</span> : candidate.canStartDirectMessage !== false
                          ? <Button size="sm" aria-label={candidate.displayName} onClick={() => start(candidate)}>Message</Button>
                          : candidate.friendRequestDirection === "outgoing"
                            ? <span className="text-xs text-foreground-subtle">Request sent</span>
                            : candidate.friendship === "accepted"
                              ? <span className="text-xs text-foreground-subtle">Friends · DM restricted</span>
                              : onSendFriendRequest === undefined ? <span className="text-xs text-foreground-subtle">DM restricted</span>
                                : <Button size="sm" variant="secondary" aria-label={candidate.friendRequestDirection === "incoming" ? `Accept friend request from ${candidate.displayName}` : undefined} onClick={() => sendFriendRequest(candidate)}>{candidate.friendRequestDirection === "incoming" ? "Accept request" : "Add friend"}</Button>}
                      </div>
                    ))}
          </div>
          {error === null ? null : <p className="m-0 text-sm text-destructive-text" role="alert">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ChannelSidebar(props: {
  readonly workspaceName: string
  readonly channels: ReadonlyArray<ChatChannel>
  readonly activeChannelId: ChatChannelId | null
  readonly channelName: string
  readonly channelVisibility: ChatChannel["visibility"]
  readonly channelIndicators: ReadonlyMap<ChatChannelId, ChatChannelIndicator>
  readonly channelOperationError: string | null
  readonly createChannelInviteCandidates?: ReadonlyArray<ChatChannelInviteCandidate>
  readonly createChannel?: ChatDataView["createChannel"]
  readonly editChannel?: ChatDataView["editChannel"]
  readonly deleteChannel?: ChatDataView["deleteChannel"]
  readonly onSelectChannel?: SelectChatChannel
  readonly onManageChannel: (channelId: ChatChannelId) => void
  readonly onChannelOperationError: (message: string | null) => void
}) {
  const {
    workspaceName,
    channels,
    activeChannelId,
    channelName,
    channelVisibility,
    channelIndicators,
    channelOperationError,
    createChannelInviteCandidates,
    createChannel,
    editChannel,
    deleteChannel,
    onSelectChannel,
    onManageChannel,
    onChannelOperationError
  } = props
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState("")
  const [visibility, setVisibility] = useState<ChatChannel["visibility"]>("public")
  const [inviteSearch, setInviteSearch] = useState("")
  const [selectedInviteeIds, setSelectedInviteeIds] = useState<ReadonlySet<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [channelMenu, setChannelMenu] = useState<{ readonly channel: ChatChannel; readonly x: number; readonly y: number } | null>(null)
  const [editingChannel, setEditingChannel] = useState<ChatChannel | null>(null)
  const [deletingChannel, setDeletingChannel] = useState<ChatChannel | null>(null)
  const showAgentParkedPanel = import.meta.env.VITE_AETHER_SHOW_AGENT_UI === "true"
  const canCreate = createChannel !== undefined
  useEffect(() => {
    if (channelMenu === null) return
    const close = () => setChannelMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("click", close)
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("click", close)
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [channelMenu])
  const closeCreateDialog = () => {
    if (saving) return
    setCreating(false)
    setDraft("")
    setVisibility("public")
    setInviteSearch("")
    setSelectedInviteeIds(new Set())
    onChannelOperationError(null)
  }
  const submitChannel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (createChannel === undefined || saving) return
    const validation = validateChannelName(draft)
    if (!validation.valid) {
      onChannelOperationError(validation.message)
      return
    }
    setSaving(true)
    onChannelOperationError(null)
    void createChannel({
      name: validation.name,
      visibility,
      ...(visibility === "private" ? { initialMemberIds: [...selectedInviteeIds] } : {})
    })
      .then(() => {
        setDraft("")
        setVisibility("public")
        setInviteSearch("")
        setSelectedInviteeIds(new Set())
        setCreating(false)
      })
      .catch((cause: unknown) => onChannelOperationError(channelCreateErrorMessage(cause)))
      .finally(() => setSaving(false))
  }

  return (
    <>
      <aside className="channelSidebar flex h-full min-h-0 min-w-0 flex-col gap-[18px] overflow-hidden border-r border-border bg-surface-muted pb-3 [grid-area:sidebar] max-[920px]:hidden" aria-label="Workspace navigation">
        <header className="workspaceHeader flex min-h-14 items-center border-b border-border px-4">
          <h1 className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-base leading-tight tracking-normal text-foreground">{workspaceName}</h1>
        </header>

        <nav className="sidebarSection flex min-w-0 flex-col p-0" aria-label="Channels">
          <div className="sidebarHeaderRow flex min-h-6 items-center justify-between gap-2 px-4 text-xs font-bold uppercase text-foreground-subtle">
            <span>Channels</span>
            <button
              type="button"
              className="grid size-6 cursor-pointer place-items-center rounded-[4px] border-0 bg-transparent font-[inherit] text-foreground-subtle disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-surface-muted-hover enabled:hover:text-foreground enabled:focus-visible:bg-surface-muted-hover enabled:focus-visible:text-foreground"
              aria-label="Add channel"
              aria-haspopup="dialog"
              aria-expanded={creating}
              disabled={!canCreate}
              onClick={() => {
                setCreating(true)
                onChannelOperationError(null)
              }}
            >
              <Plus className={iconClassName} aria-hidden="true" />
            </button>
          </div>
          {channels.map((channel) => {
            const active = channel.id === activeChannelId
            const channelIndicator = active ? null : channelIndicators.get(channel.id) ?? null
            const indicatorLabel = channelIndicator === null ? null : channelIndicatorDescription(channelIndicator, channel.name)
            return (
              <button
                key={channel.id}
                type="button"
                className={classNames(channelNavItemClassName, active && "active bg-surface-rail")}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (!active) onSelectChannel?.(channel.id)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setChannelMenu({ channel, x: event.clientX, y: event.clientY })
                }}
              >
                <span className="channelNavMain min-w-0 flex flex-col gap-[3px]">
                  <span className="channelNavName flex min-w-0 items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap font-bold">
                    <ChannelGlyph visibility={channel.visibility} />
                    <span className="channelNavText min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{channel.name}</span>
                  </span>
                </span>
                {!active && channelIndicator !== null
                  ? (
                    <span
                      className={classNames(
                        "channelIndicator size-2 shrink-0 rounded-full",
                        channelIndicator === "mentioned" ? "mentioned bg-signal-mentioned" : "unread bg-signal-unread"
                      )}
                      aria-label={indicatorLabel ?? undefined}
                      title={indicatorLabel ?? undefined}
                    />
                  )
                  : null}
              </button>
            )
          })}
          {channels.length === 0
            ? (
              <button type="button" className={classNames(channelNavItemClassName, "active bg-surface-rail")} aria-current="page">
                <span className="channelNavMain min-w-0 flex flex-col gap-[3px]">
                  <span className="channelNavName flex min-w-0 items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap font-bold">
                    <ChannelGlyph visibility={channelVisibility} />
                    <span className="channelNavText min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{channelName}</span>
                  </span>
                </span>
              </button>
            )
            : null}
        </nav>

        {showAgentParkedPanel
          ? (
            <section className="laterPanel mx-3 mt-auto rounded-panel border border-border bg-surface-canvas p-3" aria-label="Later integrations">
              <strong className="mb-[5px] block text-[13px] text-foreground">Agents later</strong>
              <p className="m-0 text-xs leading-[1.4] text-foreground-subtle">Chat stays first. The existing RPC agent plumbing is parked behind the product surface for the next phase.</p>
            </section>
          )
          : null}
      </aside>

      {creating
        ? (
          <CreateChannelDialog
            draft={draft}
            visibility={visibility}
            inviteSearch={inviteSearch}
            inviteCandidates={createChannelInviteCandidates}
            selectedInviteeIds={selectedInviteeIds}
            saving={saving}
            error={channelOperationError}
            onDraftChange={(nextDraft) => {
              setDraft(nextDraft)
              if (channelOperationError !== null) onChannelOperationError(null)
            }}
            onVisibilityChange={(nextVisibility) => {
              setVisibility(nextVisibility)
              if (channelOperationError !== null) onChannelOperationError(null)
            }}
            onInviteSearchChange={setInviteSearch}
            onToggleInvitee={(userId) => {
              setSelectedInviteeIds((current) => {
                const next = new Set(current)
                if (next.has(userId)) next.delete(userId)
                else next.add(userId)
                return next
              })
            }}
            onSubmit={submitChannel}
            onCancel={closeCreateDialog}
          />
        )
        : null}
      {channelMenu === null
        ? null
        : (
          <ChannelContextMenu
            channel={channelMenu.channel}
            x={channelMenu.x}
            y={channelMenu.y}
            canEdit={editChannel !== undefined}
            canDelete={deleteChannel !== undefined}
            onEdit={() => setEditingChannel(channelMenu.channel)}
            onDelete={() => setDeletingChannel(channelMenu.channel)}
            onManage={() => onManageChannel(channelMenu.channel.id)}
            onClose={() => setChannelMenu(null)}
          />
        )}
      {editingChannel === null || editChannel === undefined
        ? null
        : (
          <EditChannelDialog
            channel={editingChannel}
            editChannel={editChannel}
            onClose={() => setEditingChannel(null)}
            onError={onChannelOperationError}
          />
        )}
      {deletingChannel === null || deleteChannel === undefined
        ? null
        : (
          <DeleteChannelDialog
            channel={deletingChannel}
            deleteChannel={deleteChannel}
            onClose={() => setDeletingChannel(null)}
            onError={onChannelOperationError}
          />
        )}
    </>
  )
}

function ChannelContextMenu(props: {
  readonly channel: ChatChannel
  readonly x: number
  readonly y: number
  readonly canEdit: boolean
  readonly canDelete: boolean
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly onManage: () => void
  readonly onClose: () => void
}) {
  const { channel, x, y, canEdit, canDelete, onEdit, onDelete, onManage, onClose } = props
  const itemClassName = "min-h-[34px] w-full justify-start rounded-none border-0 border-b border-surface-rail bg-surface-raised px-2.5 text-left text-foreground last:border-b-0 hover:bg-surface-muted"
  const select = (action: () => void) => {
    action()
    onClose()
  }
  return (
    <div
      className="channelContextMenu fixed z-40 flex min-w-[170px] flex-col overflow-hidden rounded-panel border border-border-strong bg-surface-raised shadow-popover"
      role="menu"
      aria-label={`Context menu for #${channel.name}`}
      style={{ left: Math.min(x, window.innerWidth - 180), top: Math.min(y, window.innerHeight - 112) }}
      onClick={(event) => event.stopPropagation()}
    >
      <Button type="button" variant="ghost" className={itemClassName} role="menuitem" disabled={!canEdit} onClick={() => select(onEdit)}>
        <Pencil className={iconClassName} aria-hidden="true" /><span>Edit</span>
      </Button>
      <Button type="button" variant="ghost" className={itemClassName} role="menuitem" disabled={!canDelete} onClick={() => select(onDelete)}>
        <Trash2 className={iconClassName} aria-hidden="true" /><span>Delete</span>
      </Button>
      <Button type="button" variant="ghost" className={itemClassName} role="menuitem" onClick={() => select(onManage)}>
        <UserRoundCog className={iconClassName} aria-hidden="true" /><span>Manage</span>
      </Button>
    </div>
  )
}

function EditChannelDialog(props: {
  readonly channel: ChatChannel
  readonly editChannel: NonNullable<ChatDataView["editChannel"]>
  readonly onClose: () => void
  readonly onError: (message: string | null) => void
}) {
  const { channel, editChannel, onClose, onError } = props
  const [draft, setDraft] = useState(channel.name)
  const [saving, setSaving] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validation = validateChannelName(draft)
    if (!validation.valid) return onError(validation.message)
    setSaving(true)
    onError(null)
    void editChannel({ channelId: channel.id, name: validation.name })
      .then(onClose)
      .catch((cause: unknown) => onError(channelCreateErrorMessage(cause)))
      .finally(() => setSaving(false))
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <DialogContent className="max-w-[400px]">
        <DialogTitle>Edit channel</DialogTitle>
        <DialogDescription className="sr-only">Rename #{channel.name}.</DialogDescription>
        <form className="mt-3 flex flex-col gap-3" aria-label="Edit channel" onSubmit={submit}>
          <Input value={draft} autoFocus disabled={saving} aria-label="Channel name" onChange={(event) => setDraft(event.target.value)} />
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteChannelDialog(props: {
  readonly channel: ChatChannel
  readonly deleteChannel: NonNullable<ChatDataView["deleteChannel"]>
  readonly onClose: () => void
  readonly onError: (message: string | null) => void
}) {
  const { channel, deleteChannel, onClose, onError } = props
  const [deleting, setDeleting] = useState(false)
  const confirm = () => {
    setDeleting(true)
    onError(null)
    void deleteChannel({ channelId: channel.id })
      .then(onClose)
      .catch(() => onError("Could not delete channel. Check your permissions and try again."))
      .finally(() => setDeleting(false))
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !deleting) onClose() }}>
      <DialogContent className="max-w-[400px]">
        <DialogTitle>Delete #{channel.name}?</DialogTitle>
        <DialogDescription>This removes the channel from the workspace. This action cannot be undone.</DialogDescription>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={deleting} onClick={onClose}>Cancel</Button>
          <Button type="button" variant="danger" disabled={deleting} onClick={confirm}>{deleting ? "Deleting..." : "Delete channel"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateChannelDialog(props: {
  readonly draft: string
  readonly visibility: ChatChannel["visibility"]
  readonly inviteSearch: string
  readonly inviteCandidates?: ReadonlyArray<ChatChannelInviteCandidate>
  readonly selectedInviteeIds: ReadonlySet<string>
  readonly saving: boolean
  readonly error: string | null
  readonly onDraftChange: (draft: string) => void
  readonly onVisibilityChange: (visibility: ChatChannel["visibility"]) => void
  readonly onInviteSearchChange: (query: string) => void
  readonly onToggleInvitee: (userId: string) => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
  readonly onCancel: () => void
}) {
  const {
    draft,
    visibility,
    inviteSearch,
    inviteCandidates,
    selectedInviteeIds,
    saving,
    error,
    onDraftChange,
    onVisibilityChange,
    onInviteSearchChange,
    onToggleInvitee,
    onSubmit,
    onCancel
  } = props
  const normalizedInviteSearch = inviteSearch.trim().toLocaleLowerCase()
  const visibleInviteCandidates = inviteCandidates?.filter((candidate) =>
    normalizedInviteSearch.length === 0 || candidate.displayName.toLocaleLowerCase().includes(normalizedInviteSearch)
  )
  const privateCandidatesLoading = visibility === "private" && inviteCandidates === undefined

  const handleOpenChange = (open: boolean) => {
    if (!open) onCancel()
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="channelCreateDialog max-w-[420px]">
        <DialogTitle id="create-channel-title">Create Channel</DialogTitle>
        <DialogDescription id="create-channel-description" className="sr-only">
          Choose who can discover this channel, then name it and create it.
        </DialogDescription>
        <form className="mt-3 flex flex-col gap-3" aria-label="Create channel" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="new-channel-name">
            Channel name
          </label>
          <Input
            id="new-channel-name"
            value={draft}
            placeholder="new-channel"
            disabled={saving}
            autoFocus
            aria-describedby="create-channel-error"
            aria-invalid={error !== null}
            onChange={(event) => {
              onDraftChange(event.target.value)
            }}
          />
          <fieldset className="m-0 grid grid-cols-2 gap-1 rounded-control border border-border bg-surface-muted p-1" disabled={saving}>
            <legend className="sr-only">Channel visibility</legend>
            {(["public", "private"] as const).map((option) => (
              <label
                key={option}
                className={classNames(
                  "cursor-pointer rounded-[5px] px-2.5 py-2 text-left text-xs text-foreground-subtle",
                  visibility === option && "bg-surface-canvas font-bold text-foreground shadow-sm"
                )}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name="channel-visibility"
                  value={option}
                  checked={visibility === option}
                  onChange={() => onVisibilityChange(option)}
                />
                <span className="block capitalize">{option}</span>
                <span className="mt-0.5 block font-normal leading-[1.35]">
                  {option === "public" ? "Anyone in the workspace can join." : "Only invited members can find and open it."}
                </span>
              </label>
            ))}
          </fieldset>
          {visibility === "private"
            ? (
              <section className="flex flex-col gap-2" aria-label="Initial invitations">
                <label className="text-xs font-bold text-foreground" htmlFor="private-channel-member-search">
                  Invite members
                </label>
                <Input
                  id="private-channel-member-search"
                  type="search"
                  value={inviteSearch}
                  placeholder="Search workspace members"
                  disabled={saving || inviteCandidates === undefined || inviteCandidates.length === 0}
                  onChange={(event) => onInviteSearchChange(event.target.value)}
                />
                <div className="max-h-36 overflow-y-auto rounded-control border border-border bg-surface-canvas p-1" aria-label="Eligible members">
                  {inviteCandidates === undefined
                    ? <p className="m-0 px-2 py-2 text-xs text-foreground-subtle" role="status">Loading members...</p>
                    : inviteCandidates.length === 0
                      ? <p className="m-0 px-2 py-2 text-xs text-foreground-subtle">No other eligible members yet. You can create this channel for yourself.</p>
                      : visibleInviteCandidates?.length === 0
                        ? <p className="m-0 px-2 py-2 text-xs text-foreground-subtle">No matching members.</p>
                        : visibleInviteCandidates?.map((candidate) => {
                            const selected = selectedInviteeIds.has(candidate.id)
                            return (
                              <button
                                key={candidate.id}
                                type="button"
                                role="checkbox"
                                aria-checked={selected}
                                className="flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-1.5 text-left text-sm text-foreground hover:bg-surface-muted-hover focus-visible:bg-surface-muted-hover"
                                disabled={saving}
                                onClick={() => onToggleInvitee(candidate.id)}
                                onKeyDown={(event) => {
                                  if (event.key !== " ") return
                                  event.preventDefault()
                                  onToggleInvitee(candidate.id)
                                }}
                              >
                                {selected
                                  ? <SquareCheck className="size-4 shrink-0 text-foreground" aria-hidden="true" />
                                  : <Square className="size-4 shrink-0 text-foreground-subtle" aria-hidden="true" />}
                                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{candidate.displayName}</span>
                              </button>
                            )
                          })}
                </div>
                {inviteCandidates !== undefined && inviteCandidates.length > 0
                  ? (
                    <p className="m-0 text-xs text-foreground-subtle" aria-live="polite">
                      {selectedInviteeIds.size} of {inviteCandidates.length} selected
                    </p>
                  )
                  : null}
              </section>
            )
            : null}
          <p
            id="create-channel-error"
            className={classNames(
              "m-0 min-h-[17px] text-xs leading-[1.35] text-destructive-text",
              error === null && "invisible"
            )}
            role="status"
          >
            {error ?? ""}
          </p>
          <DialogFooter className="mt-0">
            <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={normalizeChannelName(draft).length === 0 || saving || privateCandidatesLoading}>
              {saving ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ChannelGlyph(props: { readonly visibility?: ChatChannel["visibility"] }) {
  return (
    <span
      className={classNames(
        "channelGlyph relative inline-flex size-[18px] shrink-0 items-center justify-center text-foreground-subtle",
        props.visibility === "private" && "private w-[21px]"
      )}
      aria-hidden="true"
    >
      <Hash className="channelHashIcon size-[18px]" />
      {props.visibility === "private"
        ? <Lock className="channelLockBadge absolute -right-px -top-px size-[9px] rounded-[2px] bg-surface-muted p-px text-foreground-subtle [stroke-width:4] group-hover/channel:bg-surface-muted-hover group-[.active]/channel:bg-surface-rail" />
        : null}
    </span>
  )
}

function ChannelHeader(props: {
  readonly channelName: string
  readonly direct?: boolean
  readonly searchOpen: boolean
  readonly membersOpen: boolean
  readonly onToggleSearch: () => void
  readonly onToggleMembers: () => void
}) {
  const { channelName, direct = false, searchOpen, membersOpen, onToggleSearch, onToggleMembers } = props
  const searchToggleLabel = searchOpen ? "Hide search" : "Show search"
  const membersToggleLabel = membersOpen ? "Hide members" : "Show members"
  return (
    <header className="chatHeader flex min-h-0 min-w-0 items-center justify-between gap-3 border-b border-border bg-surface-canvas px-4 py-2 [grid-area:header]">
      <div className="channelTitle flex min-w-0 items-center gap-2">
        {direct ? null : <Hash className={classNames("channelHashIcon shrink-0 text-foreground-subtle", iconClassName)} aria-hidden="true" />}
        <h2 className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-lg leading-tight tracking-normal text-foreground">{channelName}</h2>
      </div>
      <div className="chatHeaderActions flex items-center justify-end gap-2 text-xs text-foreground-subtle" aria-label="Channel actions">
        {direct ? null : <button
          type="button"
          className={classNames(
            "searchToggle grid min-h-[30px] w-8 cursor-pointer place-items-center rounded-control border border-border-strong bg-surface-canvas p-0 font-[inherit] text-ring hover:border-ring hover:bg-surface-muted hover:text-foreground-subtle focus-visible:border-ring focus-visible:bg-surface-muted focus-visible:text-foreground-subtle",
            searchOpen && "active text-foreground hover:text-foreground focus-visible:text-foreground"
          )}
          aria-label={searchToggleLabel}
          aria-pressed={searchOpen}
          title={searchToggleLabel}
          onClick={onToggleSearch}
        >
          <Search className={iconClassName} aria-hidden="true" />
        </button>}
        <button
          type="button"
          className={classNames(
            "membersToggle grid min-h-[30px] w-8 cursor-pointer place-items-center rounded-control border border-border-strong bg-surface-canvas p-0 font-[inherit] text-ring hover:border-ring hover:bg-surface-muted hover:text-foreground-subtle focus-visible:border-ring focus-visible:bg-surface-muted focus-visible:text-foreground-subtle",
            membersOpen && "active text-foreground hover:text-foreground focus-visible:text-foreground"
          )}
          aria-label={membersToggleLabel}
          aria-pressed={membersOpen}
          title={membersToggleLabel}
          onClick={onToggleMembers}
        >
          <Users className={iconClassName} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}

function ChatPane(props: {
  readonly channelName: string
  readonly messageGroups: ReadonlyArray<ChannelMessageGroup>
  readonly loading: boolean
  readonly messageDraft: string
  readonly searchOpen: boolean
  readonly searchInputRef: RefObject<HTMLInputElement | null>
  readonly searchQuery: string
  readonly searchState: ChannelMessageSearchState
  readonly activeSearchMessageId: ChatMessageId | null
  readonly operationError: string | null
  readonly hasMoreMessages: boolean
  readonly loadingMoreMessages: boolean
  readonly onLoadOlderMessages?: () => void
  readonly attachments: ReadonlyArray<ChatMessageAttachment>
  readonly attachmentUploadAvailable: boolean
  readonly uploadingAttachment: boolean
  readonly onMessageDraftChange: (draft: string) => void
  readonly onSearchQueryChange: (query: string) => void
  readonly onSelectSearchResult: (messageId: ChatMessageId) => void
  readonly onNextSearchResult: () => void
  readonly onSendMessage: () => void
  readonly onToggleMessage: (messageId: ChatMessageId) => void
  readonly onCopyMessage: (message: ChatMessage) => void
  readonly onStartEditMessage: (message: ChatMessage) => void
  readonly onEditDraftChange: (draft: string) => void
  readonly onCancelEditMessage: () => void
  readonly onSaveEditMessage: () => void
  readonly onDeleteMessage: (messageId: ChatMessageId) => void
  readonly replyParent: ChatMessage | null
  readonly onChooseAttachments: (files: ReadonlyArray<File>) => void
  readonly onRemoveAttachment: (attachmentId: string) => void
  readonly onCancelReply: () => void
  readonly onToggleReaction?: (message: ChatMessage, emoji: string) => Promise<void>
  readonly mentionMembers: ReadonlyArray<ChatChannelMember>
  readonly mentionMembersLoading: boolean
  readonly canDeleteMessage: ChatMessageGuard
  readonly canEditMessage: ChatMessageGuard
  readonly getMessageRowState: (message: ChatMessage) => MessageRowState
  readonly onOpenMessageMenu: (messageId: ChatMessageId, x: number, y: number) => void
}) {
  const {
    channelName,
    messageGroups,
    loading,
    messageDraft,
    searchOpen,
    searchInputRef,
    searchQuery,
    searchState,
    activeSearchMessageId,
    operationError,
    hasMoreMessages,
    loadingMoreMessages,
    onLoadOlderMessages,
    attachments,
    attachmentUploadAvailable,
    uploadingAttachment,
    onMessageDraftChange,
    onSearchQueryChange,
    onSelectSearchResult,
    onNextSearchResult,
    onSendMessage,
    onToggleMessage,
    onCopyMessage,
    onStartEditMessage,
    onEditDraftChange,
    onCancelEditMessage,
    onSaveEditMessage,
    onDeleteMessage,
    replyParent,
    onChooseAttachments,
    onRemoveAttachment,
    onCancelReply,
    onToggleReaction,
    mentionMembers,
    mentionMembersLoading,
    canDeleteMessage,
    canEditMessage,
    getMessageRowState,
    onOpenMessageMenu
  } = props
  const messageRowRefs = useRef(new Map<ChatMessageId, HTMLElement>())

  useEffect(() => {
    if (activeSearchMessageId === null) return
    const row = messageRowRefs.current.get(activeSearchMessageId)
    row?.scrollIntoView?.({ block: "center" })
    row?.focus({ preventScroll: true })
  }, [activeSearchMessageId])

  return (
    <section className="chatPane grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-surface-canvas [grid-area:chat]" aria-label={`${channelName} chat`}>
      <ChannelMessageSearch
        channelName={channelName}
        open={searchOpen}
        inputRef={searchInputRef}
        query={searchQuery}
        state={searchState}
        activeSearchMessageId={activeSearchMessageId}
        disabled={loading}
        onQueryChange={onSearchQueryChange}
        onSelectResult={onSelectSearchResult}
      />
      <ol className={chatTimelineClassName} aria-label="Channel messages" aria-busy={loading}>
        {loading
          ? <ChannelMessagesSkeleton />
          : null}
        {!loading && messageGroups.length === 0
          ? (
            <li className="chatEmptyState grid flex-1 place-content-center justify-items-center gap-1.5 px-5 py-8 text-center text-sm text-foreground-subtle">
              <strong className="text-[15px] text-foreground">No messages yet</strong>
              <span className="chatEmptyChannel inline-flex items-center justify-center gap-1">
                Start the conversation in
                <Hash className={classNames("channelHashIcon", iconClassName)} aria-hidden="true" />
                <span>{channelName}.</span>
              </span>
            </li>
          )
          : null}
        {!loading && hasMoreMessages && onLoadOlderMessages !== undefined
          ? (
            <li className="flex justify-center px-4 py-2">
              <Button type="button" variant="secondary" disabled={loadingMoreMessages} onClick={onLoadOlderMessages}>
                {loadingMoreMessages ? "Loading older messages..." : "Load older messages"}
              </Button>
            </li>
          )
          : null}
        {!loading && messageGroups.map((group) => (
          <li key={group.id} className={channelMessageGroupClassName}>
            <div className="messageRun flex min-w-0 flex-col gap-0.5">
              {group.messages.map((message, index) => {
                const rowState = getMessageRowState(message)
                return (
                  <ChannelMessageRow
                    key={message.id}
                    message={message}
                    startsAuthorRun={index === 0}
                    selected={rowState.selected}
                    selectionMode={rowState.selectionMode}
                    actionsPinned={rowState.actionsPinned}
                    actionsAvailable={rowState.actionsAvailable}
                    onToggle={() => onToggleMessage(message.id)}
                    onEditDraftChange={onEditDraftChange}
                    onCancelEdit={onCancelEditMessage}
                    onSaveEdit={onSaveEditMessage}
                    editingDraft={rowState.editingDraft}
                    editSaving={rowState.editSaving}
                    onOpenMenu={(x, y) => onOpenMessageMenu(message.id, x, y)}
                    onFocusParent={(messageId) => {
                      const row = messageRowRefs.current.get(messageId)
                      row?.scrollIntoView?.({ block: "center" })
                      row?.focus({ preventScroll: true })
                    }}
                    onToggleReaction={onToggleReaction === undefined ? undefined : (emoji) => onToggleReaction(message, emoji)}
                    highlighted={activeSearchMessageId === message.id}
                    onNextSearchResult={onNextSearchResult}
                    refCallback={(element) => {
                      if (element === null) {
                        messageRowRefs.current.delete(message.id)
                      } else {
                        messageRowRefs.current.set(message.id, element)
                      }
                    }}
                  />
                )
              })}
            </div>
          </li>
        ))}
      </ol>

      <MessageComposer
        channelName={channelName}
        draft={messageDraft}
        operationError={operationError}
        disabled={loading}
        replyParent={replyParent}
        attachments={attachments}
        attachmentUploadAvailable={attachmentUploadAvailable}
        uploadingAttachment={uploadingAttachment}
        members={mentionMembers}
        membersLoading={mentionMembersLoading}
        onDraftChange={onMessageDraftChange}
        onSend={onSendMessage}
        onChooseAttachments={onChooseAttachments}
        onRemoveAttachment={onRemoveAttachment}
        onCancelReply={onCancelReply}
      />
    </section>
  )
}

function ChannelMessageSearch(props: {
  readonly channelName: string
  readonly open: boolean
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly query: string
  readonly state: ChannelMessageSearchState
  readonly activeSearchMessageId: ChatMessageId | null
  readonly disabled: boolean
  readonly onQueryChange: (query: string) => void
  readonly onSelectResult: (messageId: ChatMessageId) => void
}) {
  const { channelName, open, inputRef, query, state, activeSearchMessageId, disabled, onQueryChange, onSelectResult } = props
  const activeResultIndexRef = useRef(0)
  const [activeResultIndex, setActiveResultIndex] = useState(0)
  const showResults = query.trim().length > 0
  const navigableResults = state.status === "results" ? state.results : []
  const selectedResult = activeSearchMessageId === null
    ? null
    : navigableResults.find((result) => result.message.id === activeSearchMessageId) ?? null
  const activeResult = navigableResults[activeResultIndex] ?? navigableResults[0]
  const activeResultId = activeResult === undefined ? undefined : `channel-message-search-option-${activeResult.message.id}`

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
  }, [inputRef, open])

  useEffect(() => {
    activeResultIndexRef.current = 0
    setActiveResultIndex(0)
  }, [query])

  useEffect(() => {
    if (state.status !== "results") return
    setActiveResultIndex((index) => {
      const nextIndex = Math.min(index, Math.max(0, state.results.length - 1))
      activeResultIndexRef.current = nextIndex
      return nextIndex
    })
  }, [state])

  useEffect(() => {
    if (activeSearchMessageId === null || state.status !== "results") return
    const index = state.results.findIndex((result) => result.message.id === activeSearchMessageId)
    if (index >= 0) {
      activeResultIndexRef.current = index
      setActiveResultIndex(index)
    }
  }, [activeSearchMessageId, state])

  useEffect(() => {
    if (!open || activeSearchMessageId !== null) return
    inputRef.current?.focus()
  }, [activeSearchMessageId, inputRef, open])

  const selectSearchResult = (result: ChannelMessageSearchResult) => {
    onSelectResult(result.message.id)
  }

  return (
    <Combobox<ChannelMessageSearchResult>
      items={navigableResults}
      value={selectedResult}
      inputValue={query}
      open={open && showResults}
      disabled={disabled}
      filter={null}
      autoHighlight={false}
      highlightItemOnHover={false}
      itemToStringLabel={(result) => result.bodyPreview}
      itemToStringValue={(result) => result.message.id}
      isItemEqualToValue={(item, value) => item.message.id === value.message.id}
      onInputValueChange={(value, eventDetails) => {
        if (eventDetails.reason === "input-change") onQueryChange(value)
      }}
    >
      <div className={classNames("channelMessageSearch relative z-30 row-start-1 border-b border-border bg-surface-canvas px-4 py-2.5", !open && "hidden")}>
        <label className="sr-only" htmlFor="channel-message-search">Search messages</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" aria-hidden="true" />
          <ComboboxInput
            ref={inputRef}
            id="channel-message-search"
            className="h-9 pl-9 text-sm"
            placeholder={`Search ${channelName}`}
            aria-controls="channel-message-search-results"
            aria-activedescendant={activeResultId}
            aria-invalid={state.status === "error"}
            onKeyDownCapture={(event) => {
              if (navigableResults.length === 0) return
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault()
                event.stopPropagation()
                setActiveResultIndex((index) => {
                  const nextIndex = event.key === "ArrowDown"
                    ? (index + 1) % navigableResults.length
                    : (index - 1 + navigableResults.length) % navigableResults.length
                  activeResultIndexRef.current = nextIndex
                  return nextIndex
                })
                return
              }
              if (event.key !== "Enter") return
              const selectedResult = navigableResults[activeResultIndexRef.current] ?? activeResult
              if (selectedResult === undefined) return
              event.preventDefault()
              event.stopPropagation()
              selectSearchResult(selectedResult)
            }}
          />
          <ComboboxContent
            id="channel-message-search-results"
            className="messageSearchResults w-[min(680px,calc(100vw-120px))]"
            role={showResults ? "region" : undefined}
            aria-label="Message search results"
            initialFocus={false}
            finalFocus={false}
          >
            {renderChannelMessageSearchState(
              channelName,
              state,
              activeSearchMessageId,
              activeResultIndex,
              (index) => {
                activeResultIndexRef.current = index
                setActiveResultIndex(index)
              },
              selectSearchResult
            )}
          </ComboboxContent>
        </div>
      </div>
    </Combobox>
  )
}

function renderChannelMessageSearchState(
  channelName: string,
  state: ChannelMessageSearchState,
  activeSearchMessageId: ChatMessageId | null,
  activeResultIndex: number,
  onActiveResultIndexChange: (index: number) => void,
  onSelectResult: (result: ChannelMessageSearchResult) => void
) {
  if (state.status === "idle") {
    return <p className="m-0 text-xs text-foreground-subtle">Search the current channel.</p>
  }
  if (state.status === "loading") {
    return <p className="m-0 text-xs text-foreground-subtle" role="status">Searching channel history...</p>
  }
  if (state.status === "error") {
    return <p className="m-0 text-xs text-destructive-text" role="alert">{state.message}</p>
  }
  if (state.status === "empty") {
    return <p className="m-0 text-xs text-foreground-subtle" role="status">No matching messages.</p>
  }
  return (
    <ComboboxList className="messageSearchMatches" aria-label="Message search matches">
      {state.results.map((result, index) => {
        const highlighted = activeSearchMessageId === result.message.id
        const active = index === activeResultIndex
        return (
          <ComboboxItem
            key={result.message.id}
            id={`channel-message-search-option-${result.message.id}`}
            value={result}
            className={classNames(
              "messageSearchResult grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-control border border-transparent bg-transparent px-2 py-1.5 text-left hover:border-border hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              active && "border-border bg-surface-muted",
              highlighted && "border-border-strong"
            )}
            data-active={active ? "" : undefined}
            data-message-highlighted={highlighted ? "" : undefined}
            onMouseEnter={() => onActiveResultIndexChange(index)}
            onClick={() => onSelectResult(result)}
          >
            <span className="min-w-0">
              <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-bold text-foreground">
                {result.message.authorDisplayName}
              </span>
              <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-foreground-muted">
                {result.bodyPreview}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] leading-tight text-foreground-subtle">
              <time dateTime={toIso(result.message.createdAt)}>{formatTime(result.message.createdAt)}</time>
              <span>#{channelName}</span>
            </span>
          </ComboboxItem>
        )
      })}
    </ComboboxList>
  )
}

function ChannelMessagesSkeleton() {
  return (
    <>
      {Array.from({ length: 7 }, (_, index) => (
        <li
          key={index}
          className="channelMessageSkeleton grid min-w-0 grid-cols-[var(--message-avatar-column)_minmax(0,1fr)] items-start gap-[var(--message-column-gap)] px-[var(--message-group-x)] py-2"
          aria-hidden="true"
        >
          <span className={classNames(skeletonBlockClassName, "mx-auto size-9 rounded-card")} />
          <span className="flex min-w-0 flex-col gap-2 pt-[3px]">
            <span className={classNames(skeletonBlockClassName, "h-3 w-[min(220px,45%)]")} />
            <span
              className={classNames(
                skeletonBlockClassName,
                "h-3.5 w-[min(680px,88%)]",
                index % 3 === 0 && "w-[min(420px,58%)]",
                index % 3 === 1 && "w-[min(560px,72%)]"
              )}
            />
          </span>
        </li>
      ))}
    </>
  )
}

function ChannelMessageRow(props: {
  readonly message: ChatMessage
  readonly startsAuthorRun: boolean
  readonly selected: boolean
  readonly selectionMode: boolean
  readonly actionsPinned: boolean
  readonly actionsAvailable: boolean
  readonly onToggle: () => void
  readonly onEditDraftChange: (draft: string) => void
  readonly onCancelEdit: () => void
  readonly onSaveEdit: () => void
  readonly editingDraft: string | null
  readonly editSaving: boolean
  readonly onOpenMenu: (x: number, y: number) => void
  readonly onFocusParent: (messageId: ChatMessageId) => void
  readonly onToggleReaction?: (emoji: string) => Promise<void>
  readonly highlighted: boolean
  readonly onNextSearchResult: () => void
  readonly refCallback: (element: HTMLElement | null) => void
}) {
  const {
    message,
    startsAuthorRun,
    selected,
    selectionMode,
    actionsPinned,
    actionsAvailable,
    onToggle,
    onEditDraftChange,
    onCancelEdit,
    onSaveEdit,
    editingDraft,
    editSaving,
    onOpenMenu,
    onFocusParent,
    onToggleReaction,
    highlighted,
    onNextSearchResult,
    refCallback
  } = props
  const deleted = message.deletedAt !== null
  const editing = editingDraft !== null
  const displayTimestamp = message.editedAt ?? message.createdAt
  const edited = message.editedAt !== null
  const className = classNames(
    channelMessageClassName,
    !startsAuthorRun && "compact items-center",
    deleted && "deleted text-foreground-placeholder",
    editing && "editing bg-surface-muted",
    highlighted && "searchHighlighted border-border-strong bg-surface-muted",
    selected && "selected border-border bg-surface-muted",
    selectionMode && !deleted && "selecting grid-cols-[20px_var(--message-avatar-column)_minmax(0,1fr)] cursor-pointer"
  )

  return (
    <article
      ref={refCallback}
      className={className}
      tabIndex={highlighted ? -1 : undefined}
      onKeyDown={(event) => {
        if (!highlighted || event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
        event.preventDefault()
        onNextSearchResult()
      }}
      onClick={() => {
        if (selectionMode && !deleted) onToggle()
      }}
      onContextMenu={(event) => {
        if (deleted) return
        event.preventDefault()
        onOpenMenu(event.clientX, event.clientY)
      }}
    >
      {selectionMode && !deleted
        ? (
          <label
            className={classNames(
              "messageCheckbox relative grid size-4 cursor-pointer place-items-center",
              startsAuthorRun ? "mt-2.5" : "mt-[5px]"
            )}
            onClick={(event) => event.stopPropagation()}
          >
            <input
              className="peer sr-only"
              type="checkbox"
              checked={selected}
              aria-label={`${selected ? "Deselect" : "Select"} message from ${message.authorDisplayName}`}
              onChange={onToggle}
            />
            <span
              className={classNames(
                "grid size-4 place-items-center rounded-[3px] border border-border-strong bg-surface-canvas text-foreground transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                selected && "border-foreground bg-foreground text-foreground-inverse"
              )}
              aria-hidden="true"
            >
              {selected ? <Check className="size-3 [stroke-width:3]" /> : null}
            </span>
          </label>
        )
        : null}
      <div className="messageAvatarCell flex min-w-0 justify-center">
        {startsAuthorRun
          ? (
            <Avatar
              name={message.authorDisplayName}
              className="messageAvatar messageRunAvatar sticky top-3.5 z-10"
              aria-hidden="true"
            />
          )
          : (
            <time
              className="messageTimestamp mt-[3px] inline-flex flex-col items-center whitespace-nowrap text-[11px] leading-tight text-foreground-subtle opacity-0 group-hover/message:opacity-100 group-has-[:focus-visible]/message:opacity-100"
              dateTime={toIso(displayTimestamp)}
              title={edited ? `Edited ${formatTime(displayTimestamp)}` : undefined}
              aria-label={`${formatTime(displayTimestamp)}${edited ? " edited" : ""}`}
            >
              <span>{formatDatePart(displayTimestamp)}</span>
              <span>{formatClockPart(displayTimestamp)}{edited ? "*" : ""}</span>
            </time>
          )}
      </div>
      <div className={messageContentClassName}>
        {startsAuthorRun
          ? (
            <div className="messageMeta flex min-w-0 items-baseline gap-2">
              <strong className="min-w-0 text-sm font-bold text-foreground [overflow-wrap:anywhere]">{message.authorDisplayName}</strong>
              <time
                className="messageTimestamp whitespace-nowrap text-xs text-foreground-subtle"
                dateTime={toIso(displayTimestamp)}
                title={edited ? `Edited ${formatTime(displayTimestamp)}` : undefined}
              >
                {formatTime(displayTimestamp)}{edited ? "*" : ""}
              </time>
            </div>
          )
          : null}
        {message.parentMessageId !== null && message.parentMessage !== null
          ? <MessageParentPreview parent={message.parentMessage} onFocusParent={onFocusParent} />
          : message.parentMessageId !== null
            ? <MessageParentUnavailable />
            : null}
        {editing
          ? (
            <MessageEditForm
              authorDisplayName={message.authorDisplayName}
              draft={editingDraft}
              saving={editSaving}
              onDraftChange={onEditDraftChange}
              onSave={onSaveEdit}
              onCancel={onCancelEdit}
            />
          )
          : deleted
            ? <p className={classNames(messageBodyClassName, "text-foreground-placeholder italic")}>Message deleted</p>
            : (
              <>
                {message.body.trim().length === 0
                  ? null
                  : <p className={messageBodyClassName}>{message.body}</p>}
                {message.attachments.length === 0 ? null : <MessageAttachmentList attachments={message.attachments} />}
                {message.reactions.length === 0 && onToggleReaction === undefined
                  ? null
                  : <MessageReactions message={message} onToggleReaction={onToggleReaction} />}
              </>
            )}
      </div>
      {deleted || editing || (onToggleReaction === undefined && !actionsAvailable)
        ? null
        : (
          <div
            className={classNames(
              "messageActions pointer-events-none absolute right-3 top-[-14px] z-10 flex overflow-hidden rounded-panel border border-border-strong bg-surface-raised opacity-0 shadow-floating group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-has-[:focus-visible]/message:pointer-events-auto group-has-[:focus-visible]/message:opacity-100",
              actionsPinned && "visible pointer-events-auto opacity-100"
            )}
            aria-label={`Message actions for ${message.authorDisplayName}`}
            onClick={(event) => event.stopPropagation()}
          >
            {onToggleReaction === undefined
              ? null
              : <MessageReactionPicker message={message} onToggleReaction={onToggleReaction} />}
            {actionsAvailable
              ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={messageActionButtonClassName}
                  aria-label={`More actions for message from ${message.authorDisplayName}`}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    const x = Math.max(MESSAGE_CONTEXT_MENU_OFFSET, rect.right - MESSAGE_CONTEXT_MENU_WIDTH)
                    onOpenMenu(x, rect.bottom + MESSAGE_CONTEXT_MENU_OFFSET)
                  }}
                >
                  <Ellipsis className={iconClassName} aria-hidden="true" />
                </Button>
              )
              : null}
          </div>
        )}
    </article>
  )
}

function MessageParentPreview(props: {
  readonly parent: NonNullable<ChatMessage["parentMessage"]>
  readonly onFocusParent: (messageId: ChatMessageId) => void
}) {
  const { parent, onFocusParent } = props
  if (parent.deleted) return <MessageParentUnavailable />
  return (
    <button
      type="button"
      className="replyParentPreview mt-1.5 grid max-w-[min(520px,100%)] min-w-0 grid-cols-[3px_minmax(0,1fr)] gap-2 rounded-control border border-border bg-surface-muted px-2.5 py-1.5 text-left text-xs text-foreground-muted hover:border-border-strong hover:bg-surface-muted-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      aria-label={`Reply to ${parent.authorDisplayName}: ${parent.bodyPreview}`}
      onClick={(event) => {
        event.stopPropagation()
        onFocusParent(parent.id)
      }}
    >
      <span className="rounded-full bg-border-strong" aria-hidden="true" />
      <span className="min-w-0">
        <strong className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-foreground">{parent.authorDisplayName}</strong>
        <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{parent.bodyPreview}</span>
      </span>
    </button>
  )
}

function MessageParentUnavailable() {
  return (
    <div className="replyParentPreview unavailable mt-1.5 grid max-w-[min(520px,100%)] min-w-0 grid-cols-[3px_minmax(0,1fr)] gap-2 rounded-control border border-border bg-surface-muted px-2.5 py-1.5 text-left text-xs text-foreground-subtle">
      <span className="rounded-full bg-border-strong" aria-hidden="true" />
      <span className="min-w-0">
        <strong className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-foreground-muted">Original message unavailable</strong>
        <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">The parent message was deleted or cannot be shown.</span>
      </span>
    </div>
  )
}

const reactionPalette = ["👍", "🎉", "👀"] as const

function MessageAttachmentList(props: {
  readonly attachments: ReadonlyArray<ChatMessageAttachment>
}) {
  return (
    <div className="messageAttachments mt-2 flex min-w-0 flex-col gap-2" aria-label="Message attachments">
      {props.attachments.map((attachment) => <MessageAttachment key={attachment.id} attachment={attachment} />)}
    </div>
  )
}

function MessageAttachment(props: {
  readonly attachment: ChatMessageAttachment
}) {
  const { attachment } = props
  const url = safeAttachmentUrl(attachment.url)
  const size = formatAttachmentSize(attachment.size)
  const isImage = attachment.kind === "image" && attachment.contentType.toLowerCase().startsWith("image/") && url !== null

  if (isImage) {
    return (
      <a
        className="messageImageAttachment block w-fit max-w-full overflow-hidden rounded-panel border border-border bg-surface-muted hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open image attachment ${attachment.name}`}
      >
        <img
          className="block max-h-[320px] max-w-[min(520px,100%)] object-contain"
          src={url}
          alt={attachment.name}
          loading="lazy"
          decoding="async"
        />
      </a>
    )
  }

  const content = (
    <>
      <span className="grid size-8 shrink-0 place-items-center rounded-control bg-surface-canvas text-foreground-subtle" aria-hidden="true">
        <FileIcon className={iconClassName} />
      </span>
      <span className="min-w-0">
        <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold text-foreground">{attachment.name}</span>
        <span className="block text-xs text-foreground-subtle">{attachment.contentType || "file"} - {size}</span>
      </span>
    </>
  )

  if (url === null) {
    return (
      <span className="messageFileAttachment grid max-w-[min(420px,100%)] grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-panel border border-border bg-surface-muted px-2.5 py-2">
        {content}
      </span>
    )
  }

  return (
    <a
      className="messageFileAttachment grid max-w-[min(420px,100%)] grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-panel border border-border bg-surface-muted px-2.5 py-2 no-underline hover:border-border-strong hover:bg-surface-muted-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      {content}
    </a>
  )
}

const safeAttachmentUrl = (url: string | null): string | null => {
  if (url === null) return null
  try {
    const parsed = new URL(url, window.location.href)
    return parsed.protocol === "https:" || parsed.protocol === "blob:" ? parsed.toString() : null
  } catch {
    return null
  }
}

const formatAttachmentSize = (size: number): string => {
  if (!Number.isFinite(size) || size < 0) return "Unknown size"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function MessageReactionPicker(props: {
  readonly message: ChatMessage
  readonly onToggleReaction: (emoji: string) => Promise<void>
}) {
  const { message, onToggleReaction } = props

  return (
    <div className="messageReactionPicker flex min-w-0 items-center" aria-label={`Add a reaction to message from ${message.authorDisplayName}`}>
      {reactionPalette.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="messageReactionPickerButton inline-flex size-[34px] min-h-[30px] items-center justify-center rounded-none border-0 border-l border-surface-rail bg-surface-raised px-1.5 text-xs leading-none text-foreground-muted first:border-l-0 hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
            aria-label={`Add ${emoji} reaction to message from ${message.authorDisplayName}`}
            onClick={(event) => {
              event.stopPropagation()
              void onToggleReaction(emoji)
            }}
          >
            <span aria-hidden="true">{emoji}</span>
          </button>
      ))}
    </div>
  )
}

function MessageReactions(props: {
  readonly message: ChatMessage
  readonly onToggleReaction?: (emoji: string) => Promise<void>
}) {
  const { message, onToggleReaction } = props
  const [optimisticState, setOptimisticState] = useState<Record<string, boolean>>({})
  const reactionByEmoji = useMemo(
    () => new Map(message.reactions.map((reaction) => [reaction.emoji, reaction])),
    [message.reactions]
  )

  useEffect(() => {
    setOptimisticState((current) => {
      const next = { ...current }
      let changed = false
      for (const [emoji, target] of Object.entries(current)) {
        if ((reactionByEmoji.get(emoji)?.reactedByCurrentUser ?? false) === target) {
          delete next[emoji]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [reactionByEmoji])

  const visibleEmojis = Array.from(new Set([...message.reactions.map((reaction) => reaction.emoji), ...Object.keys(optimisticState)]))
  if (visibleEmojis.length === 0) return null

  return (
    <div className="messageReactions mt-1.5 flex min-w-0 flex-wrap items-center gap-1" aria-label={`Reactions for message from ${message.authorDisplayName}`}>
      {visibleEmojis.map((emoji) => {
        const reaction = reactionByEmoji.get(emoji)
        const serverActive = reaction?.reactedByCurrentUser ?? false
        const active = optimisticState[emoji] ?? serverActive
        const serverCount = reaction?.count ?? 0
        const count = serverCount + (active === serverActive ? 0 : active ? 1 : -1)
        if (count <= 0 && !active) return null
        const content = <><span aria-hidden="true">{emoji}</span><span>{count}</span></>
        const className = classNames(
          "messageReaction inline-flex min-h-6 items-center justify-center gap-1 rounded-control border border-border bg-surface-muted px-2 py-0.5 text-xs leading-none text-foreground-muted",
          active && "border-border-strong bg-surface-muted-hover text-foreground",
          onToggleReaction !== undefined && "cursor-pointer hover:border-border-strong hover:bg-surface-rail hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        )
        return onToggleReaction === undefined
          ? <span key={emoji} className={className}>{content}</span>
          : (
            <button
              key={emoji}
              type="button"
              className={className}
              aria-pressed={active}
              aria-label={`${active ? "Remove" : "Add"} ${emoji} reaction to message from ${message.authorDisplayName}`}
              onClick={(event) => {
                event.stopPropagation()
                const target = !active
                setOptimisticState((current) => ({ ...current, [emoji]: target }))
                void onToggleReaction(emoji).catch(() => {
                  setOptimisticState((current) => {
                    const next = { ...current }
                    delete next[emoji]
                    return next
                  })
                })
              }}
            >
              {content}
            </button>
          )
      })}
    </div>
  )
}

function MessageEditForm(props: {
  readonly authorDisplayName: string
  readonly draft: string
  readonly saving: boolean
  readonly onDraftChange: (draft: string) => void
  readonly onSave: () => void
  readonly onCancel: () => void
}) {
  const { authorDisplayName, draft, saving, onDraftChange, onSave, onCancel } = props
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const canSave = draft.trim().length > 0 && !saving

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null) return
    resizeTextarea(textarea, COMPOSER_MIN_HEIGHT, MESSAGE_EDIT_MAX_HEIGHT)
  }, [draft])

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (canSave) onSave()
  }

  return (
    <form
      className="messageEditForm mt-1.5 flex min-w-0 flex-col gap-2"
      aria-label={`Edit message from ${authorDisplayName}`}
      onSubmit={submit}
      onClick={(event) => event.stopPropagation()}
    >
      <Textarea
        ref={textareaRef}
        rows={2}
        value={draft}
        className="min-h-12 max-h-[180px] resize-none overflow-hidden bg-surface-canvas px-2.5 py-2 text-sm leading-[1.42]"
        aria-label={`Edit message text from ${authorDisplayName}`}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            onCancel()
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            if (canSave) onSave()
          }
        }}
      />
      <div className="messageEditActions flex items-center justify-end gap-1.5">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" size="sm" disabled={!canSave}>{saving ? "Saving..." : "Save"}</Button>
      </div>
    </form>
  )
}

function MessageComposer(props: {
  readonly channelName: string
  readonly draft: string
  readonly operationError: string | null
  readonly disabled: boolean
  readonly replyParent: ChatMessage | null
  readonly attachments: ReadonlyArray<ChatMessageAttachment>
  readonly attachmentUploadAvailable: boolean
  readonly uploadingAttachment: boolean
  readonly members: ReadonlyArray<ChatChannelMember>
  readonly membersLoading: boolean
  readonly onDraftChange: (draft: string) => void
  readonly onSend: () => void
  readonly onChooseAttachments: (files: ReadonlyArray<File>) => void
  readonly onRemoveAttachment: (attachmentId: string) => void
  readonly onCancelReply: () => void
}) {
  const {
    channelName,
    draft,
    operationError,
    disabled,
    replyParent,
    attachments,
    attachmentUploadAvailable,
    uploadingAttachment,
    members,
    membersLoading,
    onDraftChange,
    onSend,
    onChooseAttachments,
    onRemoveAttachment,
    onCancelReply
  } = props
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [cursorIndex, setCursorIndex] = useState(draft.length)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [dismissedMentionKey, setDismissedMentionKey] = useState<string | null>(null)
  const canAttach = attachmentUploadAvailable && !disabled && !uploadingAttachment && attachments.length < MESSAGE_ATTACHMENT_POLICY.maxFiles
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !disabled && !uploadingAttachment
  const mentionRequest = useMemo(() => getMentionRequest(draft, cursorIndex), [cursorIndex, draft])
  const mentionKey = mentionRequest === null ? null : `${mentionRequest.triggerIndex}:${mentionRequest.query}`
  const mentionSuggestions = useMemo(
    () => filterMentionMembers(members, mentionRequest?.query ?? ""),
    [members, mentionRequest?.query]
  )
  const mentionMenuOpen = !disabled && mentionRequest !== null && mentionKey !== dismissedMentionKey
  const activeMention = membersLoading ? null : mentionSuggestions[activeMentionIndex] ?? mentionSuggestions[0] ?? null

  useEffect(() => {
    resizeTextarea(textareaRef.current, COMPOSER_MIN_HEIGHT, COMPOSER_MAX_HEIGHT)
  }, [draft])

  useEffect(() => {
    setActiveMentionIndex(0)
  }, [mentionRequest?.query])

  useEffect(() => {
    if (mentionKey === null) setDismissedMentionKey(null)
  }, [mentionKey])

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSend) return
    onSend()
  }

  const updateDraft = (value: string, nextCursorIndex: number) => {
    setCursorIndex(nextCursorIndex)
    if (mentionKey !== null && nextCursorIndex <= (mentionRequest?.triggerIndex ?? -1)) {
      setDismissedMentionKey(null)
    }
    onDraftChange(value)
  }

  const selectMention = (member: ChatChannelMember) => {
    if (mentionRequest === null) return
    const mentionText = `@${member.displayName} `
    const nextDraft = `${draft.slice(0, mentionRequest.triggerIndex)}${mentionText}${draft.slice(mentionRequest.cursorIndex)}`
    const nextCursorIndex = mentionRequest.triggerIndex + mentionText.length
    setDismissedMentionKey(`${mentionRequest.triggerIndex}:`)
    setCursorIndex(nextCursorIndex)
    onDraftChange(nextDraft)
    window.setTimeout(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextCursorIndex, nextCursorIndex)
    }, 0)
  }

  return (
    <div className="composerDock row-start-3 border-t border-border bg-surface-canvas px-4 pb-3 pt-2.5">
      {operationError === null
        ? null
        : <p className="composerError mb-2 mt-0 text-[13px] leading-[1.35] text-destructive-text" role="status">{operationError}</p>}
      {replyParent === null
        ? null
        : (
          <div className="composerReplyPreview mb-2 flex min-w-0 items-start justify-between gap-3 rounded-panel border border-border bg-surface-muted px-3 py-2 text-xs">
            <div className="min-w-0">
              <p className="m-0 font-bold text-foreground">Replying to {replyParent.authorDisplayName}</p>
              <p className="m-0 mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-foreground-muted">{replyParent.body}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2" onClick={onCancelReply}>
              Cancel
            </Button>
          </div>
        )}
      {attachments.length === 0 && !uploadingAttachment
        ? null
        : (
          <div className="composerAttachments mb-2 flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Selected attachments">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="composerAttachmentChip inline-flex max-w-full items-center gap-1.5 rounded-control border border-border bg-surface-muted px-2 py-1 text-xs text-foreground-muted"
              >
                <Paperclip className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{attachment.name}</span>
                <button
                  type="button"
                  className="grid size-5 shrink-0 place-items-center rounded-control border-0 bg-transparent p-0 text-foreground-subtle hover:bg-surface-muted-hover hover:text-foreground"
                  aria-label={`Remove attachment ${attachment.name}`}
                  onClick={() => onRemoveAttachment(attachment.id)}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            ))}
            {uploadingAttachment
              ? <span className="text-xs text-foreground-subtle" role="status">Uploading attachment...</span>
              : null}
          </div>
        )}
      <div className="relative">
        {mentionMenuOpen
          ? (
            <MentionSuggestionMenu
              members={mentionSuggestions}
              loading={membersLoading}
              activeIndex={activeMentionIndex}
              query={mentionRequest.query}
              onSelect={selectMention}
              onActiveIndexChange={setActiveMentionIndex}
            />
          )
          : null}
        <form
          className={classNames(
            "composer grid min-h-11 grid-cols-[48px_minmax(0,1fr)_44px] items-center overflow-hidden rounded-panel border border-border bg-surface-canvas",
            disabled && "disabled bg-surface-sunken"
          )}
          onSubmit={onSubmit}
          aria-label="Channel message composer"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="composerAddButton h-full min-h-11 w-12 rounded-none border-0 border-r border-border bg-surface-canvas text-foreground-subtle hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-55"
            aria-label="Add attachment"
            disabled={!canAttach}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className={iconClassName} aria-hidden="true" />
          </Button>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept={MESSAGE_ATTACHMENT_POLICY.acceptedContentTypes.join(",")}
            multiple
            tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? [])
              event.currentTarget.value = ""
              onChooseAttachments(files)
            }}
          />
          <label className="sr-only" htmlFor="channel-message">Message</label>
          <div className="min-w-0">
            <Textarea
              ref={textareaRef}
              id="channel-message"
              rows={1}
              value={draft}
              disabled={disabled}
              className="block max-h-[140px] min-h-11 resize-none overflow-hidden rounded-none border-0 bg-surface-canvas px-3 py-3 text-sm leading-5 focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0 disabled:bg-surface-sunken"
              placeholder={`Message ${channelName}`}
              onChange={(event) => updateDraft(event.target.value, event.currentTarget.selectionStart ?? event.target.value.length)}
              onClick={(event) => setCursorIndex(event.currentTarget.selectionStart ?? draft.length)}
              onKeyUp={(event) => setCursorIndex(event.currentTarget.selectionStart ?? draft.length)}
              onKeyDown={(event) => {
                if (mentionMenuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                  event.preventDefault()
                  if (mentionSuggestions.length === 0) return
                  setActiveMentionIndex((index) =>
                    event.key === "ArrowDown"
                      ? (index + 1) % mentionSuggestions.length
                      : (index - 1 + mentionSuggestions.length) % mentionSuggestions.length
                  )
                  return
                }
                if (mentionMenuOpen && event.key === "Escape") {
                  event.preventDefault()
                  setDismissedMentionKey(mentionKey)
                  return
                }
                if (mentionMenuOpen && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))) {
                  event.preventDefault()
                  if (activeMention !== null) selectMention(activeMention)
                  return
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  if (canSend) onSend()
                }
              }}
            />
          </div>
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            className="h-full min-h-11 w-11 rounded-none border-0 border-l border-border text-foreground-muted hover:bg-surface-muted hover:text-foreground"
            aria-label="Send message"
            disabled={!canSend}
          >
            <SendHorizontal className={iconClassName} aria-hidden="true" />
          </Button>
        </form>
      </div>
    </div>
  )
}

function MentionSuggestionMenu(props: {
  readonly members: ReadonlyArray<ChatChannelMember>
  readonly loading: boolean
  readonly activeIndex: number
  readonly query: string
  readonly onSelect: (member: ChatChannelMember) => void
  readonly onActiveIndexChange: (index: number) => void
}) {
  const { members, loading, activeIndex, query, onSelect, onActiveIndexChange } = props
  const emptyMessage = loading
    ? "Loading members..."
    : query.length === 0
      ? "No members available"
      : "No matching members"

  return (
    <div
      className="mentionMenu absolute bottom-[calc(100%+6px)] left-12 z-20 w-[min(320px,calc(100vw-120px))] overflow-hidden rounded-panel border border-border-strong bg-surface-raised py-1 shadow-popover"
      role="listbox"
      aria-label="Mention suggestions"
    >
      {loading || members.length === 0
        ? <p className="m-0 px-3 py-2 text-[13px] leading-[1.35] text-foreground-subtle">{emptyMessage}</p>
        : members.map((member, index) => (
          <button
            key={member.id}
            type="button"
            className={classNames(
              "flex min-h-9 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2.5 py-1.5 text-left font-[inherit] text-foreground hover:bg-surface-muted",
              index === activeIndex && "bg-surface-muted"
            )}
            role="option"
            aria-selected={index === activeIndex}
            onMouseEnter={() => onActiveIndexChange(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(member)}
          >
            <Avatar name={member.displayName} aria-hidden="true" className="size-7" />
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold">{member.displayName}</span>
          </button>
        ))}
    </div>
  )
}

function MembersPanel(props: {
  readonly channel: ChatChannel
  readonly members: ReadonlyArray<ChatChannelMember>
  readonly inviteCandidates?: ReadonlyArray<ChatChannelInviteCandidate>
  readonly currentUserId: string
  readonly loading: boolean
  readonly open: boolean
  readonly addChannelMember?: ChatDataView["addChannelMember"]
  readonly removeChannelMember?: ChatDataView["removeChannelMember"]
}) {
  const { channel, members, inviteCandidates, currentUserId, loading, open, addChannelMember, removeChannelMember } = props
  const [managing, setManaging] = useState(false)
  const currentMembership = members.find((member) => member.id === currentUserId)
  const canManage = channel.visibility === "private" && currentMembership?.role === "admin" &&
    addChannelMember !== undefined && removeChannelMember !== undefined
  return (
    <>
      <aside className={classNames("membersPanel h-full min-h-0 min-w-0 overflow-hidden border-l border-border bg-surface-canvas [grid-area:members] max-[920px]:hidden", !open && "hidden")} aria-label="Channel members">
        <div className="membersContent flex h-full min-h-0 flex-col gap-2.5 overflow-auto p-3.5" aria-busy={loading}>
          <div className="flex min-h-7 items-center justify-between gap-2">
            <p className="m-0 text-xs font-bold leading-tight text-foreground-subtle">Online -- {loading ? "" : members.length}</p>
            {canManage
              ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Manage channel members"
                  title="Manage channel members"
                  aria-haspopup="dialog"
                  aria-expanded={managing}
                  onClick={() => setManaging(true)}
                >
                  <UserRoundCog aria-hidden="true" />
                </Button>
              )
              : null}
          </div>
          {loading
            ? <MembersSkeleton />
            : members.length === 0
              ? <p className="m-0 text-[13px] leading-[1.4] text-foreground-muted">No members yet</p>
              : (
              <ol className={memberListClassName}>
                {members.map((member) => (
                  <li key={member.id} className={memberItemClassName}>
                    <Avatar name={member.displayName} aria-hidden="true" />
                    <div className="min-w-0">
                      <strong className={memberNameClassName}>{member.displayName}</strong>
                      <span className={memberRoleClassName}>
                        {channel.visibility === "private"
                          ? member.role === undefined
                            ? member.id === currentUserId ? "You" : "Member"
                            : `${member.role === "admin" ? "Admin" : member.role === "guest" ? "Guest" : "Member"}${member.id === currentUserId ? " · You" : ""}`
                          : member.id === currentUserId ? "You" : "Member"}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
        </div>
      </aside>
      {managing && canManage
        ? (
          <MemberManagementDialog
            channel={channel}
            members={members}
            inviteCandidates={inviteCandidates}
            currentUserId={currentUserId}
            addChannelMember={addChannelMember}
            removeChannelMember={removeChannelMember}
            onClose={() => setManaging(false)}
          />
        )
        : null}
    </>
  )
}

function MemberManagementDialog(props: {
  readonly channel: ChatChannel
  readonly members: ReadonlyArray<ChatChannelMember>
  readonly inviteCandidates?: ReadonlyArray<ChatChannelInviteCandidate>
  readonly currentUserId: string
  readonly addChannelMember: NonNullable<ChatDataView["addChannelMember"]>
  readonly removeChannelMember: NonNullable<ChatDataView["removeChannelMember"]>
  readonly onClose: () => void
}) {
  const { channel, members, inviteCandidates, currentUserId, addChannelMember, removeChannelMember, onClose } = props
  const [pending, setPending] = useState<{ readonly action: "add" | "remove"; readonly userId: string } | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<ChatChannelMember | null>(null)
  const [error, setError] = useState<string | null>(null)
  const adminCount = members.filter((member) => member.role === "admin").length
  const operationPending = pending !== null

  const runAdd = (candidate: ChatChannelInviteCandidate) => {
    if (operationPending) return
    setPending({ action: "add", userId: candidate.id })
    setError(null)
    void addChannelMember({ channelId: channel.id, userId: candidate.id })
      .catch(() => setError(`Could not add ${candidate.displayName}. Try again.`))
      .finally(() => setPending(null))
  }

  const confirmRemoval = () => {
    const member = pendingRemoval
    if (member === null || operationPending) return
    setPending({ action: "remove", userId: member.id })
    setError(null)
    void removeChannelMember({ channelId: channel.id, userId: member.id })
      .then(() => {
        setPendingRemoval(null)
      })
      .catch(() => setError(`Could not remove ${member.displayName}. Try again.`))
      .finally(() => setPending(null))
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && !operationPending) onClose()
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="memberManagementDialog max-w-[460px]">
        {pendingRemoval === null
          ? (
            <>
              <DialogTitle className="sr-only">Manage #{channel.name}</DialogTitle>
              <div className="grid max-h-[min(520px,70vh)] gap-4 overflow-y-auto pr-1">
                <section aria-labelledby="current-channel-members-title">
                  <h3 id="current-channel-members-title" className="mb-2 mt-0 text-xs font-bold uppercase text-foreground-subtle">Current members</h3>
                  <ol className="m-0 grid list-none gap-1 p-0">
                    {members.map((member) => {
                      const isLastAdmin = member.role === "admin" && adminCount === 1
                      return (
                        <li key={member.id} className="flex min-h-11 items-center gap-2 border-b border-border py-1.5 last:border-b-0">
                          <Avatar name={member.displayName} aria-hidden="true" className="size-8" />
                          <span className="min-w-0 flex-1">
                            <strong className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm">{member.displayName}</strong>
                            <span className="block text-xs text-foreground-subtle">
                              {member.role === "admin" ? "Admin" : member.role === "guest" ? "Guest" : "Member"}
                              {member.id === currentUserId ? " · You" : ""}
                            </span>
                          </span>
                          {isLastAdmin
                            ? <span className="text-xs text-foreground-subtle">Last admin</span>
                            : (
                              <Button
                                type="button"
                                variant="secondary"
                                size="icon"
                                aria-label={`Remove ${member.displayName}`}
                                title={`Remove ${member.displayName}`}
                                disabled={operationPending}
                                onClick={() => setPendingRemoval(member)}
                              >
                                <UserMinus aria-hidden="true" />
                              </Button>
                            )}
                        </li>
                      )
                    })}
                  </ol>
                </section>
                <section aria-labelledby="eligible-channel-members-title">
                  <h3 id="eligible-channel-members-title" className="mb-2 mt-0 text-xs font-bold uppercase text-foreground-subtle">Eligible invitees</h3>
                  {inviteCandidates === undefined
                    ? <p className="m-0 py-2 text-sm text-foreground-subtle" role="status">Loading eligible members...</p>
                    : inviteCandidates.length === 0
                      ? <p className="m-0 py-2 text-sm text-foreground-subtle">No eligible members to add.</p>
                      : (
                        <ol className="m-0 grid list-none gap-1 p-0">
                          {inviteCandidates.map((candidate) => {
                            const adding = pending?.action === "add" && pending.userId === candidate.id
                            return (
                              <li key={candidate.id} className="flex min-h-11 items-center gap-2 border-b border-border py-1.5 last:border-b-0">
                                <Avatar name={candidate.displayName} aria-hidden="true" className="size-8" />
                                <strong className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm">{candidate.displayName}</strong>
                                <Button type="button" variant="secondary" size="sm" disabled={operationPending} onClick={() => runAdd(candidate)}>
                                  {adding ? "Adding..." : "Add"}
                                </Button>
                              </li>
                            )
                          })}
                        </ol>
                      )}
                </section>
              </div>
              {error === null
                ? null
                : <p className="mb-0 mt-3 text-xs text-destructive-text" role="alert">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="secondary" size="sm" disabled={operationPending} onClick={onClose}>Done</Button>
              </DialogFooter>
            </>
          )
          : (
            <>
              <DialogTitle>Remove {pendingRemoval.displayName}?</DialogTitle>
              <DialogDescription>
                {pendingRemoval.id === currentUserId
                  ? "Your access ends immediately. You will be moved to an accessible channel."
                  : "Their access ends immediately, including this channel's messages and member list."}
              </DialogDescription>
              {error === null
                ? null
                : <p className="mb-0 mt-3 text-xs text-destructive-text" role="alert">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="secondary" size="sm" disabled={operationPending} onClick={() => {
                  setPendingRemoval(null)
                  setError(null)
                }}>Cancel</Button>
                <Button type="button" variant="danger" size="sm" disabled={operationPending} onClick={confirmRemoval}>
                  {operationPending ? "Removing..." : pendingRemoval.id === currentUserId ? "Leave channel" : "Remove member"}
                </Button>
              </DialogFooter>
            </>
          )}
      </DialogContent>
    </Dialog>
  )
}

function MembersSkeleton() {
  return (
    <ol className={memberListClassName} aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <li key={index} className={memberItemClassName}>
          <span className={classNames(skeletonBlockClassName, "size-9 rounded-card")} />
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className={classNames(skeletonBlockClassName, "h-[13px] w-[min(130px,80%)]")} />
            <span className={classNames(skeletonBlockClassName, "h-[11px] w-[min(74px,55%)]")} />
          </span>
        </li>
      ))}
    </ol>
  )
}

function MessageContextMenu(props: {
  readonly message: ChatMessage
  readonly selected: boolean
  readonly x: number
  readonly y: number
  readonly onToggle: () => void
  readonly onCopy: () => void
  readonly onEdit: () => void
  readonly onReply: () => void
  readonly onDelete: () => void
  readonly canEdit: boolean
  readonly canDelete: boolean
  readonly onClose: () => void
}) {
  const { message, selected, x, y, onToggle, onCopy, onEdit, onReply, onDelete, canEdit, canDelete, onClose } = props
  const SelectIcon = selected ? Square : SquareCheck
  const itemClassName =
    "min-h-[34px] w-full justify-start rounded-none border-0 border-b border-surface-rail bg-surface-raised px-2.5 text-left text-foreground last:border-b-0 hover:bg-surface-muted"
  return (
    <div
      className="messageContextMenu fixed z-20 flex min-w-[170px] flex-col overflow-hidden rounded-panel border border-border-strong bg-surface-raised shadow-popover"
      role="menu"
      aria-label={`Context menu for message from ${message.authorDisplayName}`}
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      <Button
        type="button"
        variant="ghost"
        className={itemClassName}
        role="menuitem"
        onClick={() => {
          onToggle()
          onClose()
        }}
      >
        <SelectIcon className={iconClassName} aria-hidden="true" />
        <span>{selected ? "Deselect" : "Select"}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={itemClassName}
        role="menuitem"
        onClick={() => {
          onCopy()
          onClose()
        }}
      >
        <Copy className={iconClassName} aria-hidden="true" />
        <span>Copy message</span>
      </Button>
      {canEdit
        ? (
          <Button
            type="button"
            variant="ghost"
            className={itemClassName}
            role="menuitem"
            onClick={() => {
              onEdit()
              onClose()
            }}
          >
            <Pencil className={iconClassName} aria-hidden="true" />
            <span>Edit message</span>
          </Button>
        )
        : null}
      <Button
        type="button"
        variant="ghost"
        className={itemClassName}
        role="menuitem"
        onClick={() => {
          onReply()
          onClose()
        }}
      >
        <Reply className={iconClassName} aria-hidden="true" />
        <span>Reply</span>
      </Button>
      {canDelete
        ? (
          <Button
            type="button"
            variant="ghost"
            className={itemClassName}
            role="menuitem"
            onClick={() => {
              onDelete()
              onClose()
            }}
          >
            <Trash2 className={iconClassName} aria-hidden="true" />
            <span>Delete message</span>
          </Button>
        )
        : null}
    </div>
  )
}

function DeleteMessageDialog(props: {
  readonly authorDisplayName: string
  readonly operationError: string | null
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const { authorDisplayName, operationError, onCancel, onConfirm } = props

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) onCancel()
    }}>
      <DialogContent className="deleteMessageDialog max-w-[360px]">
        <DialogTitle id="delete-message-title">Delete Message?</DialogTitle>
        <DialogDescription id="delete-message-description" className="mt-2 text-[13px] leading-[1.45] text-foreground-muted">
          Delete this message from {authorDisplayName}? This cannot be undone.
        </DialogDescription>
        {operationError === null
          ? null
          : <p className="mb-0 mt-3 text-[13px] leading-[1.35] text-destructive-text" role="status">{operationError}</p>}
        <DialogFooter className="deleteMessageActions">
          <Button type="button" variant="secondary" onClick={onCancel} autoFocus>Cancel</Button>
          <Button type="button" variant="danger" onClick={onConfirm}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const classNames = cn
