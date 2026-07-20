import {
  Bell,
  BellOff,
  Ellipsis,
  File as FileIcon,
  Hash,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  Search,
  SendHorizontal,
  Trash2,
  UserRoundCog,
  X,
  Users
} from "lucide-react"
import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import "./App.css"
import { MESSAGE_ATTACHMENT_POLICY } from "../shared/attachment-policy"
import { MESSAGE_REACTION_EMOJIS } from "../shared/reaction-policy"
import { useAttachmentDraft } from "./attachment-draft"
import type {
  ChatChannel,
  ChatChannelId,
  ChatChannelIndicator,
  ChatChannelInviteCandidate,
  ChatChannelMember,
  ChatConversationNotificationPreference,
  ChatConversationNotificationMode,
  ChatDataView,
  ChatMessage,
  ChatMessageAttachment,
  ChatMessageId,
  SelectChatChannel
} from "./chat-data"
import { activeConversationId, activeConversationName } from "./chat-data"
import { useMessageInteractions } from "./message-interactions"
import { MembersPanel } from "./workspace-chat/members-panel"
import { DeleteMessageDialog, MessageContextMenu } from "./workspace-chat/message-action-overlays"
import { ChannelMessageSearch } from "./workspace-chat/message-search"
import { DirectMessageSettingsDialog, type ProfileMenuAction, WorkspaceRail } from "./workspace-chat/navigation-rail"
export type { ProfileMenuAction } from "./workspace-chat/navigation-rail"
import {
  type ChannelMessageGroup,
  type ChannelMessageSearchState,
  createChannelViewModel,
  filterMentionMembers,
  formatClockPart,
  formatDatePart,
  formatTime,
  getMentionRequest,
  groupConsecutiveMessages,
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
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  Radio,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TooltipProvider,
  Textarea
} from "./ui"

type ChannelNameValidation =
  { readonly valid: true; readonly name: string } | { readonly valid: false; readonly message: string }

type ChannelCapabilities = NonNullable<ChatDataView["channels"]>
type NotificationCapabilities = NonNullable<ChatDataView["notifications"]>

const MESSAGE_CONTEXT_MENU_WIDTH = 170
const MESSAGE_CONTEXT_MENU_OFFSET = 6
const COMPOSER_MIN_HEIGHT = 44
const COMPOSER_MAX_HEIGHT = 140
const MESSAGE_EDIT_MAX_HEIGHT = 180
const pointAnchor = (x: number, y: number) => ({
  getBoundingClientRect: () => new DOMRect(x, y, 0, 0)
})
const normalizeChannelName = (name: string): string => name.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase()

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
const channelMessageGroupClassName = "channelMessageGroup min-w-0"
const channelMessageClassName =
  "channelMessage group/message relative grid min-w-0 grid-cols-[var(--message-avatar-column)_minmax(0,1fr)] items-start gap-[var(--message-column-gap)] border border-transparent bg-transparent px-[var(--message-group-x)] py-2 hover:bg-surface-muted has-[:focus-visible]:bg-surface-muted"
const messageContentClassName = "messageContent min-w-0 w-full"
const messageBodyClassName = "mb-0 mt-[3px] w-full text-sm leading-[1.42] text-foreground break-words"
const iconClassName = "size-4 [stroke-width:2]"
const messageActionButtonClassName =
  "size-[34px] min-h-[30px] rounded-none border-0 border-l border-surface-rail bg-surface-raised text-foreground-muted first:border-l-0 hover:bg-surface-muted hover:text-foreground"
const appShellClassName =
  "appShell grid h-full min-h-0 w-full overflow-hidden bg-surface-canvas font-sans text-foreground [grid-template-areas:'rail_sidebar_header_header'_'rail_sidebar_chat_members'] [grid-template-columns:56px_minmax(200px,236px)_minmax(360px,1fr)_minmax(280px,320px)] [grid-template-rows:56px_minmax(0,1fr)] [&_*]:box-border max-[920px]:[grid-template-areas:'rail_header'_'rail_chat'] max-[920px]:[grid-template-columns:56px_minmax(0,1fr)]"
const appShellMembersCollapsedClassName =
  "membersCollapsed [grid-template-areas:'rail_sidebar_header'_'rail_sidebar_chat'] [grid-template-columns:56px_minmax(200px,236px)_minmax(360px,1fr)] max-[920px]:[grid-template-areas:'rail_header'_'rail_chat'] max-[920px]:[grid-template-columns:56px_minmax(0,1fr)]"
const appShellDirectConversationClassName =
  "directConversation [grid-template-areas:'rail_header'_'rail_chat'] [grid-template-columns:56px_minmax(0,1fr)]"
const channelNavItemClassName =
  "channelNavItem group/channel flex min-h-[34px] w-full items-center justify-between gap-2 rounded-none border-0 bg-transparent px-5 py-[7px] text-left font-[inherit] text-foreground-muted hover:bg-surface-muted-hover"
const skeletonBlockClassName =
  "block overflow-hidden rounded-panel bg-[linear-gradient(90deg,var(--aether-color-surface-muted-hover)_0%,var(--aether-color-surface-shimmer)_48%,var(--aether-color-surface-muted-hover)_100%)] bg-[length:220%_100%] motion-safe:animate-[skeletonPulse_1.15s_ease-in-out_infinite]"

const channelIndicatorDescription = (indicator: ChatChannelIndicator, channelName: string): string =>
  indicator === "mentioned"
    ? `Mention in #${channelName} since you last opened it. No native push is sent.`
    : `Unread messages in #${channelName} since you last opened it. No native push is sent.`

export type WorkspaceChatProps = ChatDataView & {
  readonly profileMenuActions?: ReadonlyArray<ProfileMenuAction>
}

export function WorkspaceChat(props: WorkspaceChatProps) {
  const { model, navigation, channels, directMessages, notifications, messages, profileMenuActions = [] } = props
  const { selectChannel, selectDirectConversation } = navigation
  const createChannel = channels?.create
  const editChannel = channels?.edit
  const deleteChannel = channels?.delete
  const addChannelMember = channels?.addMember
  const removeChannelMember = channels?.removeMember
  const startDirectConversation = directMessages?.startConversation
  const searchDirectConversationCandidates = directMessages?.searchCandidates
  const sendFriendRequest = directMessages?.sendFriendRequest
  const updateDirectMessageProfile = directMessages?.updateProfile
  const respondToFriendRequest = directMessages?.respondToFriendRequest
  const updateNotificationPreference = notifications?.updatePreference
  const createChannelMessage = messages.create
  const uploadMessageAttachment = messages.upload
  const discardMessageAttachment = messages.discard
  const deleteChannelMessage = messages.delete
  const editChannelMessage = messages.edit
  const toggleMessageReaction = messages.toggleReaction
  const searchChannelHistory = messages.search
  const loadOlderChannelMessages = messages.loadOlder
  const canDeleteMessages = messages.canDeleteMessages
  const canDeleteMessage = messages.canDelete
  const canEditMessage = messages.canEdit
  const operationErrorMessage = messages.errorMessage
  const activeConversation =
    model.activeConversation.kind === "channel"
      ? { kind: "channel" as const, channel: model.channel }
      : model.activeConversation
  const activeId = activeConversationId(activeConversation)
  const activeName = activeConversationName(activeConversation)
  const activeChannel = activeConversation.kind === "channel" ? activeConversation.channel : null
  const [messageDraft, setMessageDraft] = useState("")
  const [operationError, setOperationError] = useState<string | null>(null)
  const [channelOperationError, setChannelOperationError] = useState<string | null>(null)
  const [membersOpen, setMembersOpen] = useState(true)
  const [directMessageSettingsOpen, setDirectMessageSettingsOpen] = useState(false)
  const notificationPreference = useNotificationPreferenceController(activeId, updateNotificationPreference)
  const [replyParent, setReplyParent] = useState<ChatMessage | null>(null)
  const attachmentDraft = useAttachmentDraft({
    channelId: activeId,
    ...(uploadMessageAttachment === undefined ? {} : { upload: uploadMessageAttachment }),
    ...(discardMessageAttachment === undefined ? {} : { discard: discardMessageAttachment }),
    ...(operationErrorMessage === undefined ? {} : { operationErrorMessage }),
    reportError: setOperationError
  })
  const view = useMemo(() => createChannelViewModel(model), [model])
  const channelMessages = useMemo(
    () => (model.conversation.messages.status === "ready" ? model.conversation.messages.data : []),
    [model.conversation.messages]
  )
  const channelMembers = "data" in model.conversation.members ? model.conversation.members.data : undefined
  const messageSearch = useMessageSearchController(activeId, channelMessages, searchChannelHistory)
  const displayedMessages = useMemo(() => {
    if (
      messageSearch.activeMessage === undefined ||
      channelMessages.some((message) => message.id === messageSearch.activeMessage?.id)
    ) {
      return channelMessages
    }
    return [...channelMessages, messageSearch.activeMessage].sort((left, right) => left.createdAt - right.createdAt)
  }, [messageSearch.activeMessage, channelMessages])
  const messageGroups = useMemo(() => groupConsecutiveMessages(displayedMessages), [displayedMessages])
  const channelMessagesLoading = model.conversation.messages.status === "loading"
  const channelMembersLoading =
    channelMembers === undefined ? channelMessagesLoading : model.conversation.members.status === "loading"
  const [directMessageMembers, setDirectMessageMembers] = useState<ReadonlyArray<ChatChannelMember>>([])
  const visibleMembers = channelMembers ?? directMessageMembers
  const messageInteractions = useMessageInteractions({
    channelId: activeId,
    messages: channelMessages,
    deleteChannelMessage,
    ...(editChannelMessage === undefined ? {} : { editChannelMessage }),
    ...(operationErrorMessage === undefined ? {} : { operationErrorMessage }),
    setOperationError
  })

  useEffect(() => {
    setMessageDraft("")
    setOperationError(null)
    setChannelOperationError(null)
    setReplyParent(null)
  }, [activeId])

  useEffect(() => {
    if (replyParent === null) return
    const latestParent = channelMessages.find((message) => message.id === replyParent.id)
    if (latestParent === undefined || latestParent.deletedAt !== null) setReplyParent(null)
  }, [channelMessages, replyParent])

  useEffect(() => {
    if (channelMessagesLoading) return
    setDirectMessageMembers((members) => mergeChannelMembers(members, view.members))
  }, [channelMessagesLoading, view.members])

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
    void attachmentDraft
      .send((attachments) =>
        createChannelMessage({
          channelId: activeId,
          body,
          parentMessageId: replyParent?.id ?? null,
          ...(attachments.length === 0 ? {} : { attachments })
        })
      )
      .then((result) => {
        if (result !== "success") return
        setMessageDraft("")
        setReplyParent(null)
      })
  }

  const messageCanDelete = (message: ChatMessage): boolean => canDeleteMessages && (canDeleteMessage?.(message) ?? true)

  const messageCanEdit = (message: ChatMessage): boolean =>
    editChannelMessage !== undefined && (canEditMessage?.(message) ?? true)

  const menuMessage = messageInteractions.menuMessage
  const messageMenu = messageInteractions.messageMenu
  const pendingDeleteMessage = messageInteractions.pendingDeleteMessage

  return (
    <TooltipProvider delay={500}>
      <main
        className={cn(
          appShellClassName,
          activeConversation.kind === "direct"
            ? appShellDirectConversationClassName
            : !membersOpen && appShellMembersCollapsedClassName
        )}
      >
        <WorkspaceRail
          workspaceName={model.workspace.name}
          workspaceActive={activeConversation.kind === "channel"}
          currentUserName={model.currentUser.displayName}
          conversations={"data" in model.directMessages.conversations ? model.directMessages.conversations.data : []}
          indicators={
            new Map(
              "data" in model.indicators ? model.indicators.data.map((state) => [state.channelId, state.indicator]) : []
            )
          }
          activeConversationId={activeConversation.kind === "direct" ? activeId : null}
          onSelectWorkspace={() => selectChannel?.(model.channel.id)}
          onSelectConversation={selectDirectConversation}
          conversationsLoading={model.directMessages.conversations.status !== "ready"}
          onStartConversation={startDirectConversation}
          onSearchConversationCandidates={searchDirectConversationCandidates}
          onSendFriendRequest={sendFriendRequest}
          profileMenuActions={
            !("data" in model.directMessages.profile) || updateDirectMessageProfile === undefined
              ? profileMenuActions
              : [{ label: "DM settings", onSelect: () => setDirectMessageSettingsOpen(true) }, ...profileMenuActions]
          }
        />
        {directMessageSettingsOpen &&
        "data" in model.directMessages.profile &&
        updateDirectMessageProfile !== undefined ? (
          <DirectMessageSettingsDialog
            profile={model.directMessages.profile.data}
            incomingFriendRequests={
              "data" in model.directMessages.incomingFriendRequests
                ? model.directMessages.incomingFriendRequests.data
                : []
            }
            onSave={updateDirectMessageProfile}
            onRespondToFriendRequest={respondToFriendRequest}
            onClose={() => setDirectMessageSettingsOpen(false)}
          />
        ) : null}

        {activeConversation.kind === "direct" ? null : (
          <ChannelSidebar
            workspaceName={model.workspace.name}
            channels={model.channels}
            activeChannelId={activeChannel?.id ?? null}
            channelName={activeChannel?.name ?? ""}
            channelVisibility={activeChannel?.visibility ?? "private"}
            channelIndicators={view.channelIndicators}
            channelOperationError={channelOperationError}
            createChannelInviteCandidates={
              "data" in model.channelCreation.inviteCandidates ? model.channelCreation.inviteCandidates.data : undefined
            }
            createChannel={createChannel}
            editChannel={editChannel}
            deleteChannel={deleteChannel}
            onSelectChannel={selectChannel}
            onManageChannel={(channelId) => {
              selectChannel?.(channelId)
              setMembersOpen(true)
            }}
            onChannelOperationError={setChannelOperationError}
          />
        )}

        <ChannelHeader
          channelName={activeName}
          direct={activeConversation.kind === "direct"}
          notificationPreference={
            "data" in model.conversation.notificationPreference
              ? model.conversation.notificationPreference.data
              : undefined
          }
          notificationPreferenceSaving={notificationPreference.saving}
          notificationPreferenceError={notificationPreference.error}
          onNotificationPreferenceChange={notificationPreference.save}
          searchOpen={messageSearch.open}
          membersOpen={membersOpen}
          onToggleSearch={messageSearch.toggle}
          onToggleMembers={() => {
            if (activeChannel !== null) setMembersOpen((open) => !open)
          }}
        />

        <ChatPane
          conversationId={activeId}
          channelName={activeName}
          messageGroups={messageGroups}
          loading={channelMessagesLoading}
          messageDraft={messageDraft}
          search={messageSearch}
          operationError={operationError}
          hasMoreMessages={model.conversation.messages.status === "ready" && model.conversation.messages.hasMore}
          loadingMoreMessages={
            model.conversation.messages.status === "ready" && model.conversation.messages.loadingMore
          }
          onLoadOlderMessages={loadOlderChannelMessages}
          onMessageDraftChange={setMessageDraft}
          onSendMessage={sendChannelMessage}
          messageInteractions={messageInteractions}
          replyParent={replyParent}
          attachmentDraft={attachmentDraft}
          onCancelReply={() => setReplyParent(null)}
          onToggleReaction={toggleMessageReaction === undefined ? undefined : toggleReaction}
          mentionMembers={visibleMembers}
          mentionMembersLoading={channelMembersLoading}
        />

        {activeChannel === null ? null : (
          <MembersPanel
            channel={activeChannel}
            members={visibleMembers}
            inviteCandidates={
              "data" in model.conversation.memberInviteCandidates
                ? model.conversation.memberInviteCandidates.data
                : undefined
            }
            currentUserId={model.currentUser.id}
            loading={channelMembersLoading}
            open={membersOpen}
            addChannelMember={addChannelMember}
            removeChannelMember={removeChannelMember}
          />
        )}

        {menuMessage === null || messageMenu === null ? null : (
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

        {pendingDeleteMessage === null ? null : (
          <DeleteMessageDialog
            authorDisplayName={pendingDeleteMessage.authorDisplayName}
            operationError={operationError}
            onCancel={messageInteractions.cancelDeleteMessage}
            onConfirm={messageInteractions.confirmDeleteMessage}
          />
        )}
      </main>
    </TooltipProvider>
  )
}

function useNotificationPreferenceController(
  activeId: ChatChannelId,
  updatePreference: NotificationCapabilities["updatePreference"] | undefined
) {
  const activeIdRef = useRef(activeId)
  const [status, setStatus] = useState({ saving: false, error: null as string | null })
  activeIdRef.current = activeId

  useEffect(() => setStatus({ saving: false, error: null }), [activeId])

  return {
    ...status,
    save:
      updatePreference === undefined
        ? undefined
        : (mode: ChatConversationNotificationMode) => {
            const channelId = activeId
            setStatus({ saving: true, error: null })
            void updatePreference({ channelId, mode })
              .then(() => {
                if (activeIdRef.current === channelId) setStatus({ saving: false, error: null })
              })
              .catch(() => {
                if (activeIdRef.current === channelId) {
                  setStatus({ saving: false, error: "Could not save notification preference." })
                }
              })
          }
  } as const
}

function useMessageSearchController(
  activeId: ChatChannelId,
  messages: ReadonlyArray<ChatMessage>,
  searchHistory: ChatDataView["messages"]["search"]
) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeMessageId, setActiveMessageId] = useState<ChatMessageId | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const localState = useMemo(() => searchChannelMessages(messages, query), [messages, query])
  const [remoteState, setRemoteState] = useState<ChannelMessageSearchState>({ status: "idle" })
  const state = searchHistory === undefined ? localState : remoteState
  const activeMessage =
    state.status === "results"
      ? state.results.find((result) => result.message.id === activeMessageId)?.message
      : undefined

  useEffect(() => {
    setOpen(false)
    setQuery("")
    setActiveMessageId(null)
  }, [activeId])

  useEffect(() => {
    if (searchHistory === undefined) return
    const normalizedQuery = query.trim()
    if (normalizedQuery.length === 0) {
      setRemoteState({ status: "idle" })
      return
    }
    if (normalizedQuery.length > MESSAGE_SEARCH_MAX_QUERY_LENGTH) {
      setRemoteState({
        status: "error",
        message: `Search is limited to ${MESSAGE_SEARCH_MAX_QUERY_LENGTH} characters.`
      })
      return
    }

    let cancelled = false
    setRemoteState({ status: "loading" })
    const timeout = window.setTimeout(() => {
      void searchHistory({ channelId: activeId, query: normalizedQuery })
        .then((results) => {
          if (cancelled) return
          setRemoteState(
            results.length === 0
              ? { status: "empty" }
              : { status: "results", results: results.map((message) => ({ message, bodyPreview: message.body })) }
          )
        })
        .catch(() => {
          if (!cancelled) setRemoteState({ status: "error", message: "Could not search messages." })
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [activeId, query, searchHistory])

  useEffect(() => {
    const openSearchOnHotkey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "f") return
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      event.preventDefault()
      if (!open) {
        setOpen(true)
      } else if (document.activeElement === inputRef.current) {
        setOpen(false)
        setActiveMessageId(null)
      } else {
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", openSearchOnHotkey)
    return () => window.removeEventListener("keydown", openSearchOnHotkey)
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeSearchOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      if (document.activeElement === inputRef.current) {
        setOpen(false)
        setActiveMessageId(null)
      } else if (activeMessageId !== null) {
        inputRef.current?.focus()
      } else {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", closeSearchOnEscape, true)
    return () => window.removeEventListener("keydown", closeSearchOnEscape, true)
  }, [activeMessageId, open])

  return {
    open,
    inputRef,
    query,
    state,
    activeMessageId,
    activeMessage,
    toggle: () =>
      setOpen((current) => {
        if (current) setActiveMessageId(null)
        return !current
      }),
    setQuery: (nextQuery: string) => {
      setQuery(nextQuery)
      setActiveMessageId(null)
    },
    selectResult: (messageId: ChatMessageId) =>
      setActiveMessageId((current) => (current === messageId ? null : messageId)),
    nextResult: () => {
      if (state.status !== "results" || state.results.length === 0) return
      const currentIndex = state.results.findIndex((result) => result.message.id === activeMessageId)
      const nextResult = state.results[(currentIndex + 1) % state.results.length]
      if (nextResult !== undefined) setActiveMessageId(nextResult.message.id)
    }
  } as const
}

function ChannelSidebar(props: {
  readonly workspaceName: string
  readonly channels: ReadonlyArray<ChatChannel>
  readonly activeChannelId: ChatChannelId | null
  readonly channelName: string
  readonly channelVisibility: ChatChannel["visibility"]
  readonly channelIndicators: ReadonlyMap<ChatChannelId, ChatChannelIndicator>
  readonly channelOperationError: string | null
  readonly createChannelInviteCandidates?: ReadonlyArray<ChatChannelInviteCandidate> | undefined
  readonly createChannel?: ChannelCapabilities["create"] | undefined
  readonly editChannel?: ChannelCapabilities["edit"] | undefined
  readonly deleteChannel?: ChannelCapabilities["delete"] | undefined
  readonly onSelectChannel?: SelectChatChannel | undefined
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
  const [channelMenu, setChannelMenu] = useState<{
    readonly channel: ChatChannel
    readonly x: number
    readonly y: number
  } | null>(null)
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
      <aside
        className="channelSidebar flex h-full min-h-0 min-w-0 flex-col gap-[18px] overflow-hidden border-r border-border bg-surface-muted pb-3 [grid-area:sidebar] max-[920px]:hidden"
        aria-label="Workspace navigation"
      >
        <header className="workspaceHeader flex min-h-14 items-center border-b border-border px-4">
          <h1 className="m-0 min-w-0 overflow-hidden text-base leading-tight tracking-normal text-ellipsis whitespace-nowrap text-foreground">
            {workspaceName}
          </h1>
        </header>

        <nav className="sidebarSection flex min-w-0 flex-col p-0" aria-label="Channels">
          <div className="sidebarHeaderRow flex min-h-6 items-center justify-between gap-2 px-5 text-xs font-bold text-foreground-subtle uppercase">
            <span>Channels</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-mr-1 size-6 rounded-[4px] text-foreground-subtle enabled:hover:bg-surface-muted-hover enabled:hover:text-foreground enabled:focus-visible:bg-surface-muted-hover enabled:focus-visible:text-foreground"
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
            </Button>
          </div>
          {channels.map((channel) => {
            const active = channel.id === activeChannelId
            const channelIndicator = active ? null : (channelIndicators.get(channel.id) ?? null)
            const indicatorLabel =
              channelIndicator === null ? null : channelIndicatorDescription(channelIndicator, channel.name)
            return (
              <Button
                key={channel.id}
                type="button"
                variant="ghost"
                className={cn(channelNavItemClassName, active && "active bg-surface-rail")}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (!active) onSelectChannel?.(channel.id)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setChannelMenu({ channel, x: event.clientX, y: event.clientY })
                }}
              >
                <span className="channelNavMain flex min-w-0 flex-col gap-[3px]">
                  <span className="channelNavName flex min-w-0 items-center gap-1 overflow-hidden font-bold text-ellipsis whitespace-nowrap">
                    <ChannelGlyph visibility={channel.visibility} />
                    <span className="channelNavText min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                      {channel.name}
                    </span>
                  </span>
                </span>
                {!active && channelIndicator !== null ? (
                  <span
                    className={cn(
                      "channelIndicator size-2 shrink-0 rounded-full",
                      channelIndicator === "mentioned" ? "mentioned bg-signal-mentioned" : "unread bg-signal-unread"
                    )}
                    aria-label={indicatorLabel ?? undefined}
                    title={indicatorLabel ?? undefined}
                  />
                ) : null}
              </Button>
            )
          })}
          {channels.length === 0 ? (
            <Button
              type="button"
              variant="ghost"
              className={cn(channelNavItemClassName, "active bg-surface-rail")}
              aria-current="page"
            >
              <span className="channelNavMain flex min-w-0 flex-col gap-[3px]">
                <span className="channelNavName flex min-w-0 items-center gap-1 overflow-hidden font-bold text-ellipsis whitespace-nowrap">
                  <ChannelGlyph visibility={channelVisibility} />
                  <span className="channelNavText min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {channelName}
                  </span>
                </span>
              </span>
            </Button>
          ) : null}
        </nav>

        {showAgentParkedPanel ? (
          <section
            className="laterPanel mx-3 mt-auto rounded-panel border border-border bg-surface-canvas p-3"
            aria-label="Later integrations"
          >
            <strong className="mb-[5px] block text-[13px] text-foreground">Agents later</strong>
            <p className="m-0 text-xs leading-[1.4] text-foreground-subtle">
              Chat stays first. The existing RPC agent plumbing is parked behind the product surface for the next phase.
            </p>
          </section>
        ) : null}
      </aside>

      {creating ? (
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
      ) : null}
      {channelMenu === null ? null : (
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
      {editingChannel === null || editChannel === undefined ? null : (
        <EditChannelDialog
          channel={editingChannel}
          editChannel={editChannel}
          onClose={() => setEditingChannel(null)}
          onError={onChannelOperationError}
        />
      )}
      {deletingChannel === null || deleteChannel === undefined ? null : (
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
  const itemClassName =
    "min-h-[34px] w-full justify-start rounded-none border-0 border-b border-surface-rail bg-surface-raised px-2.5 text-left text-foreground last:border-b-0 hover:bg-surface-muted"
  const select = (action: () => void) => {
    action()
    onClose()
  }
  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      modal={false}
    >
      <DropdownMenuContent
        className="channelContextMenu min-w-[170px] p-0"
        aria-label={`Context menu for #${channel.name}`}
        anchor={() => pointAnchor(x, y)}
        positionMethod="fixed"
        side="right"
        align="start"
        sideOffset={0}
      >
        <DropdownMenuItem className={itemClassName} disabled={!canEdit} onClick={() => select(onEdit)}>
          <Pencil className={iconClassName} aria-hidden="true" />
          <span>Edit</span>
        </DropdownMenuItem>
        <DropdownMenuItem className={itemClassName} disabled={!canDelete} onClick={() => select(onDelete)}>
          <Trash2 className={iconClassName} aria-hidden="true" />
          <span>Delete</span>
        </DropdownMenuItem>
        <DropdownMenuItem className={itemClassName} onClick={() => select(onManage)}>
          <UserRoundCog className={iconClassName} aria-hidden="true" />
          <span>Manage</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EditChannelDialog(props: {
  readonly channel: ChatChannel
  readonly editChannel: NonNullable<ChannelCapabilities["edit"]>
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent className="max-w-[400px]">
        <DialogTitle>Edit channel</DialogTitle>
        <DialogDescription className="sr-only">Rename #{channel.name}.</DialogDescription>
        <form className="mt-3 flex flex-col gap-3" aria-label="Edit channel" onSubmit={submit}>
          <Input
            value={draft}
            disabled={saving}
            aria-label="Channel name"
            onChange={(event) => setDraft(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteChannelDialog(props: {
  readonly channel: ChatChannel
  readonly deleteChannel: NonNullable<ChannelCapabilities["delete"]>
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !deleting) onClose()
      }}
    >
      <DialogContent className="max-w-[400px]">
        <DialogTitle>Delete #{channel.name}?</DialogTitle>
        <DialogDescription>
          This removes the channel from the workspace. This action cannot be undone.
        </DialogDescription>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={deleting} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="danger" disabled={deleting} onClick={confirm}>
            {deleting ? "Deleting..." : "Delete channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateChannelDialog(props: {
  readonly draft: string
  readonly visibility: ChatChannel["visibility"]
  readonly inviteSearch: string
  readonly inviteCandidates?: ReadonlyArray<ChatChannelInviteCandidate> | undefined
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
  const visibleInviteCandidates = inviteCandidates?.filter(
    (candidate) =>
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
            aria-describedby="create-channel-error"
            aria-invalid={error !== null}
            onChange={(event) => {
              onDraftChange(event.target.value)
            }}
          />
          <fieldset
            className="m-0 grid grid-cols-2 gap-1 rounded-control border border-border bg-surface-muted p-1"
            disabled={saving}
          >
            <legend className="sr-only">Channel visibility</legend>
            <RadioGroup
              name="channel-visibility"
              value={visibility}
              disabled={saving}
              className="contents"
              onValueChange={onVisibilityChange}
            >
              {(["public", "private"] as const).map((option) => (
                <label
                  key={option}
                  className={cn(
                    "cursor-pointer rounded-[5px] px-2.5 py-2 text-left text-xs text-foreground-subtle focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1",
                    visibility === option && "bg-surface-canvas font-bold text-foreground shadow-sm"
                  )}
                >
                  <Radio value={option} className="sr-only" />
                  <span className="block capitalize">{option}</span>
                  <span className="mt-0.5 block leading-[1.35] font-normal">
                    {option === "public"
                      ? "Anyone in the workspace can join."
                      : "Only invited members can find and open it."}
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          {visibility === "private" ? (
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
              <div
                className="max-h-36 overflow-y-auto rounded-control border border-border bg-surface-canvas p-1"
                aria-label="Eligible members"
              >
                {inviteCandidates === undefined ? (
                  <p className="m-0 px-2 py-2 text-xs text-foreground-subtle" role="status">
                    Loading members...
                  </p>
                ) : inviteCandidates.length === 0 ? (
                  <p className="m-0 px-2 py-2 text-xs text-foreground-subtle">
                    No other eligible members yet. You can create this channel for yourself.
                  </p>
                ) : visibleInviteCandidates?.length === 0 ? (
                  <p className="m-0 px-2 py-2 text-xs text-foreground-subtle">No matching members.</p>
                ) : (
                  visibleInviteCandidates?.map((candidate) => {
                    const selected = selectedInviteeIds.has(candidate.id)
                    return (
                      <label
                        key={candidate.id}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-[5px] border-0 bg-transparent px-2 py-1.5 text-left text-sm text-foreground hover:bg-surface-muted-hover focus-visible:bg-surface-muted-hover"
                      >
                        <Checkbox
                          checked={selected}
                          disabled={saving}
                          onCheckedChange={() => onToggleInvitee(candidate.id)}
                        />
                        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                          {candidate.displayName}
                        </span>
                      </label>
                    )
                  })
                )}
              </div>
              {inviteCandidates !== undefined && inviteCandidates.length > 0 ? (
                <p className="m-0 text-xs text-foreground-subtle" aria-live="polite">
                  {selectedInviteeIds.size} of {inviteCandidates.length} selected
                </p>
              ) : null}
            </section>
          ) : null}
          <p
            id="create-channel-error"
            className={cn(
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
            <Button
              type="submit"
              size="sm"
              disabled={normalizeChannelName(draft).length === 0 || saving || privateCandidatesLoading}
            >
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
      className={cn(
        "channelGlyph relative inline-flex size-[18px] shrink-0 items-center justify-center text-foreground-subtle",
        props.visibility === "private" && "private w-[21px]"
      )}
      aria-hidden="true"
    >
      <Hash className="channelHashIcon size-[18px]" />
      {props.visibility === "private" ? (
        <Lock className="channelLockBadge absolute -top-px -right-px size-[9px] rounded-[2px] bg-surface-muted [stroke-width:4] p-px text-foreground-subtle group-hover/channel:bg-surface-muted-hover group-[.active]/channel:bg-surface-rail" />
      ) : null}
    </span>
  )
}

function ChannelHeader(props: {
  readonly channelName: string
  readonly direct?: boolean
  readonly notificationPreference?: ChatConversationNotificationPreference | undefined
  readonly notificationPreferenceSaving: boolean
  readonly notificationPreferenceError: string | null
  readonly onNotificationPreferenceChange?: ((mode: ChatConversationNotificationMode) => void) | undefined
  readonly searchOpen: boolean
  readonly membersOpen: boolean
  readonly onToggleSearch: () => void
  readonly onToggleMembers: () => void
}) {
  const {
    channelName,
    direct = false,
    notificationPreference,
    notificationPreferenceSaving,
    notificationPreferenceError,
    onNotificationPreferenceChange,
    searchOpen,
    membersOpen,
    onToggleSearch,
    onToggleMembers
  } = props
  const searchToggleLabel = searchOpen ? "Hide search" : "Show search"
  const membersToggleLabel = membersOpen ? "Hide members" : "Show members"
  return (
    <header className="chatHeader flex min-h-0 min-w-0 items-center justify-between gap-3 border-b border-border bg-surface-canvas px-4 py-2 [grid-area:header]">
      <div className="channelTitle flex min-w-0 items-center gap-2">
        {direct ? null : (
          <Hash className={cn("channelHashIcon shrink-0 text-foreground-subtle", iconClassName)} aria-hidden="true" />
        )}
        <h2 className="m-0 min-w-0 overflow-hidden text-lg leading-tight tracking-normal text-ellipsis whitespace-nowrap text-foreground">
          {channelName}
        </h2>
      </div>
      <div
        className="chatHeaderActions flex items-center justify-end gap-2 text-xs text-foreground-subtle"
        aria-label="Conversation actions"
      >
        <Select<ChatConversationNotificationMode>
          value={notificationPreference?.mode ?? null}
          disabled={
            notificationPreference === undefined ||
            notificationPreferenceSaving ||
            onNotificationPreferenceChange === undefined
          }
          onValueChange={(mode) => {
            if (mode !== null) onNotificationPreferenceChange?.(mode)
          }}
        >
          <SelectTrigger
            className="max-w-44 gap-1.5 bg-surface-canvas px-2 text-xs text-foreground-subtle"
            aria-label={`Notifications for ${channelName}`}
            title={notificationPreferenceError ?? "Notification preference"}
          >
            {notificationPreference?.mode === "off" ? (
              <BellOff className={iconClassName} aria-hidden="true" />
            ) : (
              <Bell className={iconClassName} aria-hidden="true" />
            )}
            <SelectValue>
              {notificationPreference === undefined ? "Loading..." : notificationModeLabel(notificationPreference.mode)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {notificationPreference?.options.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {notificationModeLabel(mode)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {notificationPreferenceError === null ? null : (
          <span className="sr-only" role="alert">
            {notificationPreferenceError}
          </span>
        )}
        {direct ? null : (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className={cn(
              "searchToggle grid size-control! cursor-pointer place-items-center rounded-control border border-border-strong bg-surface-canvas p-0 font-[inherit] text-ring hover:border-ring hover:bg-surface-muted hover:text-foreground-subtle focus-visible:border-ring focus-visible:bg-surface-muted focus-visible:text-foreground-subtle",
              searchOpen && "active text-foreground hover:text-foreground focus-visible:text-foreground"
            )}
            aria-label={searchToggleLabel}
            aria-pressed={searchOpen}
            title={searchToggleLabel}
            onClick={onToggleSearch}
          >
            <Search className={iconClassName} aria-hidden="true" />
          </Button>
        )}
        {direct ? null : (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className={cn(
              "membersToggle grid size-control! cursor-pointer place-items-center rounded-control border border-border-strong bg-surface-canvas p-0 font-[inherit] text-ring hover:border-ring hover:bg-surface-muted hover:text-foreground-subtle focus-visible:border-ring focus-visible:bg-surface-muted focus-visible:text-foreground-subtle",
              membersOpen && "active text-foreground hover:text-foreground focus-visible:text-foreground"
            )}
            aria-label={membersToggleLabel}
            aria-pressed={membersOpen}
            title={membersToggleLabel}
            onClick={onToggleMembers}
          >
            <Users className={iconClassName} aria-hidden="true" />
          </Button>
        )}
      </div>
    </header>
  )
}

const notificationModeLabel = (mode: ChatConversationNotificationMode): string => {
  switch (mode) {
    case "all":
      return "All messages"
    case "mentions":
      return "Mentions only"
    case "off":
      return "Muted"
  }
}

function ChatPane(props: {
  readonly conversationId: ChatChannelId
  readonly channelName: string
  readonly messageGroups: ReadonlyArray<ChannelMessageGroup>
  readonly loading: boolean
  readonly messageDraft: string
  readonly search: ReturnType<typeof useMessageSearchController>
  readonly operationError: string | null
  readonly hasMoreMessages: boolean
  readonly loadingMoreMessages: boolean
  readonly onLoadOlderMessages?: (() => void) | undefined
  readonly attachmentDraft: ReturnType<typeof useAttachmentDraft>
  readonly messageInteractions: ReturnType<typeof useMessageInteractions>
  readonly onMessageDraftChange: (draft: string) => void
  readonly onSendMessage: () => void
  readonly replyParent: ChatMessage | null
  readonly onCancelReply: () => void
  readonly onToggleReaction?: ((message: ChatMessage, emoji: string) => Promise<void>) | undefined
  readonly mentionMembers: ReadonlyArray<ChatChannelMember>
  readonly mentionMembersLoading: boolean
}) {
  const {
    conversationId,
    channelName,
    messageGroups,
    loading,
    messageDraft,
    search,
    operationError,
    hasMoreMessages,
    loadingMoreMessages,
    onLoadOlderMessages,
    attachmentDraft,
    messageInteractions,
    onMessageDraftChange,
    onSendMessage,
    replyParent,
    onCancelReply,
    onToggleReaction,
    mentionMembers,
    mentionMembersLoading
  } = props
  const timelineRef = useRef<HTMLOListElement>(null)
  const bottomAlignedConversationIdRef = useRef<ChatChannelId | null>(null)
  const messageRowRefs = useRef(new Map<ChatMessageId, HTMLElement>())

  useLayoutEffect(() => {
    if (loading || bottomAlignedConversationIdRef.current === conversationId) return
    const timeline = timelineRef.current
    if (timeline === null) return
    timeline.scrollTop = timeline.scrollHeight
    bottomAlignedConversationIdRef.current = conversationId
  }, [conversationId, loading, messageGroups])

  useEffect(() => {
    if (search.activeMessageId === null) return
    const row = messageRowRefs.current.get(search.activeMessageId)
    row?.scrollIntoView?.({ block: "center" })
    row?.focus({ preventScroll: true })
  }, [search.activeMessageId])

  return (
    <section
      className="chatPane grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-surface-canvas [grid-area:chat]"
      aria-label={`${channelName} chat`}
    >
      <ChannelMessageSearch
        channelName={channelName}
        open={search.open}
        inputRef={search.inputRef}
        query={search.query}
        state={search.state}
        activeSearchMessageId={search.activeMessageId}
        disabled={loading}
        onQueryChange={search.setQuery}
        onSelectResult={search.selectResult}
      />
      <ol ref={timelineRef} className={chatTimelineClassName} aria-label="Channel messages" aria-busy={loading}>
        {loading ? <ChannelMessagesSkeleton /> : null}
        {!loading && messageGroups.length === 0 ? (
          <li className="chatEmptyState grid flex-1 place-content-center justify-items-center gap-1.5 px-5 py-8 text-center text-sm text-foreground-subtle">
            <strong className="text-[15px] text-foreground">No messages yet</strong>
            <span className="chatEmptyChannel inline-flex items-center justify-center gap-1">
              Start the conversation in
              <Hash className={cn("channelHashIcon", iconClassName)} aria-hidden="true" />
              <span>{channelName}.</span>
            </span>
          </li>
        ) : null}
        {!loading && hasMoreMessages && onLoadOlderMessages !== undefined ? (
          <li className="flex justify-center px-4 py-2">
            <Button type="button" variant="secondary" disabled={loadingMoreMessages} onClick={onLoadOlderMessages}>
              {loadingMoreMessages ? "Loading older messages..." : "Load older messages"}
            </Button>
          </li>
        ) : null}
        {!loading &&
          messageGroups.map((group) => (
            <li key={group.id} className={channelMessageGroupClassName}>
              <div className="messageRun flex min-w-0 flex-col gap-0.5">
                {group.messages.map((message, index) => {
                  const rowState = messageInteractions.getRowState(message)
                  return (
                    <ChannelMessageRow
                      key={message.id}
                      message={message}
                      startsAuthorRun={index === 0}
                      selected={rowState.selected}
                      selectionMode={rowState.selectionMode}
                      actionsPinned={rowState.actionsPinned}
                      actionsAvailable={rowState.actionsAvailable}
                      onToggle={() => messageInteractions.toggleMessageSelection(message.id)}
                      onEditDraftChange={messageInteractions.setEditingDraft}
                      onCancelEdit={messageInteractions.cancelEditingMessage}
                      onSaveEdit={messageInteractions.saveEditingMessage}
                      editingDraft={rowState.editingDraft}
                      editSaving={rowState.editSaving}
                      onOpenMenu={(x, y) => messageInteractions.openMessageMenu(message.id, x, y)}
                      onFocusParent={(messageId) => {
                        const row = messageRowRefs.current.get(messageId)
                        row?.scrollIntoView?.({ block: "center" })
                        row?.focus({ preventScroll: true })
                      }}
                      onToggleReaction={
                        onToggleReaction === undefined ? undefined : (emoji) => onToggleReaction(message, emoji)
                      }
                      highlighted={search.activeMessageId === message.id}
                      onNextSearchResult={search.nextResult}
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
        attachments={attachmentDraft.attachments}
        attachmentUploadAvailable={attachmentDraft.uploadAvailable}
        uploadingAttachment={attachmentDraft.uploading}
        members={mentionMembers}
        membersLoading={mentionMembersLoading}
        onDraftChange={onMessageDraftChange}
        onSend={onSendMessage}
        onChooseAttachments={attachmentDraft.choose}
        onRemoveAttachment={attachmentDraft.remove}
        onCancelReply={onCancelReply}
      />
    </section>
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
          <span className={cn(skeletonBlockClassName, "mx-auto size-9 rounded-card")} />
          <span className="flex min-w-0 flex-col gap-2 pt-[3px]">
            <span className={cn(skeletonBlockClassName, "h-3 w-[min(220px,45%)]")} />
            <span
              className={cn(
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
  readonly onToggleReaction?: ((emoji: string) => Promise<void>) | undefined
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
  const className = cn(
    channelMessageClassName,
    !startsAuthorRun && "compact items-center",
    deleted && "deleted text-foreground-placeholder",
    editing && "editing bg-surface-muted",
    highlighted && "searchHighlighted border-border-strong bg-surface-muted",
    selected && "selected border-border bg-surface-muted",
    selectionMode && !deleted && "selecting cursor-pointer grid-cols-[20px_var(--message-avatar-column)_minmax(0,1fr)]"
  )

  return (
    <div
      ref={refCallback}
      className={className}
      role={(selectionMode && !deleted) || highlighted ? "button" : undefined}
      aria-label={(selectionMode && !deleted) || highlighted ? `Message from ${message.authorDisplayName}` : undefined}
      tabIndex={selectionMode && !deleted ? 0 : highlighted ? -1 : undefined}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
        if (highlighted && event.key === "Enter") {
          event.preventDefault()
          onNextSearchResult()
        } else if (selectionMode && !deleted && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault()
          onToggle()
        }
      }}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("button, input, textarea, select, a, [role='checkbox']")
        )
          return
        if (selectionMode && !deleted) onToggle()
      }}
      onContextMenu={(event) => {
        if (deleted) return
        event.preventDefault()
        onOpenMenu(event.clientX, event.clientY)
      }}
    >
      {selectionMode && !deleted ? (
        <span
          className={cn(
            "messageCheckbox relative grid size-4 cursor-pointer place-items-center",
            startsAuthorRun ? "mt-2.5" : "mt-[5px]"
          )}
        >
          <Checkbox
            checked={selected}
            aria-label={`${selected ? "Deselect" : "Select"} message from ${message.authorDisplayName}`}
            onCheckedChange={onToggle}
          />
        </span>
      ) : null}
      <div className="messageAvatarCell flex min-w-0 justify-center">
        {startsAuthorRun ? (
          <Avatar
            name={message.authorDisplayName}
            className="messageAvatar messageRunAvatar sticky top-3.5 z-10"
            aria-hidden="true"
          />
        ) : (
          <time
            className="messageTimestamp mt-[3px] inline-flex flex-col items-center text-[11px] leading-tight whitespace-nowrap text-foreground-subtle opacity-0 group-hover/message:opacity-100 group-has-[:focus-visible]/message:opacity-100"
            dateTime={toIso(displayTimestamp)}
            title={edited ? `Edited ${formatTime(displayTimestamp)}` : undefined}
            aria-label={`${formatTime(displayTimestamp)}${edited ? " edited" : ""}`}
          >
            <span>{formatDatePart(displayTimestamp)}</span>
            <span>
              {formatClockPart(displayTimestamp)}
              {edited ? "*" : ""}
            </span>
          </time>
        )}
      </div>
      <div className={messageContentClassName}>
        {startsAuthorRun ? (
          <div className="messageMeta flex min-w-0 items-baseline gap-2">
            <strong className="min-w-0 text-sm font-bold [overflow-wrap:anywhere] text-foreground">
              {message.authorDisplayName}
            </strong>
            <time
              className="messageTimestamp text-xs whitespace-nowrap text-foreground-subtle"
              dateTime={toIso(displayTimestamp)}
              title={edited ? `Edited ${formatTime(displayTimestamp)}` : undefined}
            >
              {formatTime(displayTimestamp)}
              {edited ? "*" : ""}
            </time>
          </div>
        ) : null}
        {message.parentMessageId !== null && message.parentMessage !== null ? (
          <MessageParentPreview parent={message.parentMessage} onFocusParent={onFocusParent} />
        ) : message.parentMessageId !== null ? (
          <MessageParentUnavailable />
        ) : null}
        {editing ? (
          <MessageEditForm
            authorDisplayName={message.authorDisplayName}
            draft={editingDraft}
            saving={editSaving}
            onDraftChange={onEditDraftChange}
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
          />
        ) : deleted ? (
          <p className={cn(messageBodyClassName, "text-foreground-placeholder italic")}>Message deleted</p>
        ) : (
          <>
            {message.body.trim().length === 0 ? null : <p className={messageBodyClassName}>{message.body}</p>}
            {message.attachments.length === 0 ? null : <MessageAttachmentList attachments={message.attachments} />}
            {message.reactions.length === 0 && onToggleReaction === undefined ? null : (
              <MessageReactions message={message} onToggleReaction={onToggleReaction} />
            )}
          </>
        )}
      </div>
      {deleted || editing || (onToggleReaction === undefined && !actionsAvailable) ? null : (
        <div
          className={cn(
            "messageActions pointer-events-none absolute top-[-14px] right-3 z-10 flex overflow-hidden rounded-panel border border-border-strong bg-surface-raised opacity-0 shadow-floating group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-has-[:focus-visible]/message:pointer-events-auto group-has-[:focus-visible]/message:opacity-100",
            actionsPinned && "pointer-events-auto visible opacity-100"
          )}
          aria-label={`Message actions for ${message.authorDisplayName}`}
        >
          {onToggleReaction === undefined ? null : (
            <MessageReactionPicker message={message} onToggleReaction={onToggleReaction} />
          )}
          {actionsAvailable ? (
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
          ) : null}
        </div>
      )}
    </div>
  )
}

function MessageParentPreview(props: {
  readonly parent: NonNullable<ChatMessage["parentMessage"]>
  readonly onFocusParent: (messageId: ChatMessageId) => void
}) {
  const { parent, onFocusParent } = props
  if (parent.deleted) return <MessageParentUnavailable />
  return (
    <Button
      type="button"
      variant="ghost"
      className="replyParentPreview mt-1 inline-grid h-auto max-w-[min(520px,100%)] min-w-0 grid-cols-[2px_auto_minmax(0,1fr)] items-center justify-start gap-1.5 rounded-none border-0 bg-transparent p-0 text-left text-xs leading-tight font-normal whitespace-normal text-foreground-muted hover:bg-transparent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      aria-label={`Reply to ${parent.authorDisplayName}: ${parent.bodyPreview}`}
      onClick={(event) => {
        event.stopPropagation()
        onFocusParent(parent.id)
      }}
    >
      <span className="h-3.5 rounded-full bg-border-strong" aria-hidden="true" />
      <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-foreground">
        {parent.authorDisplayName}
      </strong>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{parent.bodyPreview}</span>
    </Button>
  )
}

function MessageParentUnavailable() {
  return (
    <div className="replyParentPreview unavailable mt-1 inline-grid max-w-[min(520px,100%)] min-w-0 grid-cols-[2px_auto_minmax(0,1fr)] items-center gap-1.5 text-left text-xs leading-tight text-foreground-subtle">
      <span className="h-3.5 rounded-full bg-border-strong" aria-hidden="true" />
      <strong className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-foreground-muted">
        Original unavailable
      </strong>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        The parent message was deleted or cannot be shown.
      </span>
    </div>
  )
}

function MessageAttachmentList(props: { readonly attachments: ReadonlyArray<ChatMessageAttachment> }) {
  return (
    <div className="messageAttachments mt-2 flex min-w-0 flex-col gap-2" aria-label="Message attachments">
      {props.attachments.map((attachment) => (
        <MessageAttachment key={attachment.id} attachment={attachment} />
      ))}
    </div>
  )
}

function MessageAttachment(props: { readonly attachment: ChatMessageAttachment }) {
  const { attachment } = props
  const url = safeAttachmentUrl(attachment.url)
  const size = formatAttachmentSize(attachment.size)
  const isImage =
    attachment.kind === "image" && attachment.contentType.toLowerCase().startsWith("image/") && url !== null

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
      <span
        className="grid size-8 shrink-0 place-items-center rounded-control bg-surface-canvas text-foreground-subtle"
        aria-hidden="true"
      >
        <FileIcon className={iconClassName} />
      </span>
      <span className="min-w-0">
        <span className="block min-w-0 overflow-hidden text-sm font-bold text-ellipsis whitespace-nowrap text-foreground">
          {attachment.name}
        </span>
        <span className="block text-xs text-foreground-subtle">
          {attachment.contentType || "file"} - {size}
        </span>
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
    <div
      className="messageReactionPicker flex min-w-0 items-center"
      aria-label={`Add a reaction to message from ${message.authorDisplayName}`}
    >
      {MESSAGE_REACTION_EMOJIS.map((emoji) => (
        <Button
          key={emoji}
          type="button"
          variant="ghost"
          className="messageReactionPickerButton inline-flex size-[34px] min-h-[30px] items-center justify-center rounded-none border-0 border-l border-surface-rail bg-surface-raised px-1.5 text-xs leading-none text-foreground-muted first:border-l-0 hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          aria-label={`Add ${emoji} reaction to message from ${message.authorDisplayName}`}
          onClick={(event) => {
            event.stopPropagation()
            void onToggleReaction(emoji)
          }}
        >
          <span aria-hidden="true">{emoji}</span>
        </Button>
      ))}
    </div>
  )
}

function MessageReactions(props: {
  readonly message: ChatMessage
  readonly onToggleReaction?: ((emoji: string) => Promise<void>) | undefined
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

  const visibleEmojis = Array.from(
    new Set([...message.reactions.map((reaction) => reaction.emoji), ...Object.keys(optimisticState)])
  )
  if (visibleEmojis.length === 0) return null

  return (
    <div
      className="messageReactions mt-1.5 flex min-w-0 flex-wrap items-center gap-1"
      aria-label={`Reactions for message from ${message.authorDisplayName}`}
    >
      {visibleEmojis.map((emoji) => {
        const reaction = reactionByEmoji.get(emoji)
        const serverActive = reaction?.reactedByCurrentUser ?? false
        const active = optimisticState[emoji] ?? serverActive
        const serverCount = reaction?.count ?? 0
        const count = serverCount + (active === serverActive ? 0 : active ? 1 : -1)
        if (count <= 0 && !active) return null
        const content = (
          <>
            <span aria-hidden="true">{emoji}</span>
            <span>{count}</span>
          </>
        )
        const className = cn(
          "messageReaction inline-flex min-h-6 items-center justify-center gap-1 rounded-control border border-border bg-surface-muted px-2 py-0.5 text-xs leading-none text-foreground-muted",
          active && "border-border-strong bg-surface-muted-hover text-foreground",
          onToggleReaction !== undefined &&
            "cursor-pointer hover:border-border-strong hover:bg-surface-rail hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        )
        return onToggleReaction === undefined ? (
          <span key={emoji} className={className}>
            {content}
          </span>
        ) : (
          <Button
            key={emoji}
            type="button"
            variant="ghost"
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
          </Button>
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
    >
      <Textarea
        ref={textareaRef}
        rows={2}
        value={draft}
        className="max-h-[180px] min-h-12 resize-none overflow-hidden bg-surface-canvas px-2.5 py-2 text-sm leading-[1.42]"
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
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSave}>
          {saving ? "Saving..." : "Save"}
        </Button>
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
  const canAttach =
    attachmentUploadAvailable &&
    !disabled &&
    !uploadingAttachment &&
    attachments.length < MESSAGE_ATTACHMENT_POLICY.maxFiles
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !disabled && !uploadingAttachment
  const mentionRequest = useMemo(() => getMentionRequest(draft, cursorIndex), [cursorIndex, draft])
  const mentionKey = mentionRequest === null ? null : `${mentionRequest.triggerIndex}:${mentionRequest.query}`
  const mentionSuggestions = useMemo(
    () => filterMentionMembers(members, mentionRequest?.query ?? ""),
    [members, mentionRequest?.query]
  )
  const mentionMenuOpen = !disabled && mentionRequest !== null && mentionKey !== dismissedMentionKey
  const activeMention = membersLoading
    ? null
    : (mentionSuggestions[activeMentionIndex] ?? mentionSuggestions[0] ?? null)

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
    <div className="composerDock row-start-3 border-t border-border bg-surface-canvas px-4 pt-2.5 pb-3">
      {operationError === null ? null : (
        <p className="composerError mt-0 mb-2 text-[13px] leading-[1.35] text-destructive-text" role="status">
          {operationError}
        </p>
      )}
      {replyParent === null ? null : (
        <div className="composerReplyPreview mb-2 flex min-w-0 items-start justify-between gap-3 rounded-panel border border-border bg-surface-muted px-3 py-2 text-xs">
          <div className="min-w-0">
            <p className="m-0 font-bold text-foreground">Replying to {replyParent.authorDisplayName}</p>
            <p className="m-0 mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-foreground-muted">
              {replyParent.body}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2" onClick={onCancelReply}>
            Cancel
          </Button>
        </div>
      )}
      {attachments.length === 0 && !uploadingAttachment ? null : (
        <div
          className="composerAttachments mb-2 flex min-w-0 flex-wrap items-center gap-1.5"
          aria-label="Selected attachments"
        >
          {attachments.map((attachment) => (
            <span
              key={attachment.id}
              className="composerAttachmentChip inline-flex max-w-full items-center gap-1.5 rounded-control border border-border bg-surface-muted px-2 py-1 text-xs text-foreground-muted"
            >
              <Paperclip className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{attachment.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="grid size-5 shrink-0 place-items-center rounded-control border-0 bg-transparent p-0 text-foreground-subtle hover:bg-surface-muted-hover hover:text-foreground"
                aria-label={`Remove attachment ${attachment.name}`}
                onClick={() => onRemoveAttachment(attachment.id)}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </span>
          ))}
          {uploadingAttachment ? (
            <span className="text-xs text-foreground-subtle" role="status">
              Uploading attachment...
            </span>
          ) : null}
        </div>
      )}
      <div className="relative">
        {mentionMenuOpen ? (
          <MentionSuggestionMenu
            members={mentionSuggestions}
            loading={membersLoading}
            activeIndex={activeMentionIndex}
            query={mentionRequest.query}
            onSelect={selectMention}
            onActiveIndexChange={setActiveMentionIndex}
          />
        ) : null}
        <form
          className={cn(
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
          <label className="sr-only" htmlFor="channel-message">
            Message
          </label>
          <div className="min-w-0">
            <Textarea
              ref={textareaRef}
              id="channel-message"
              rows={1}
              value={draft}
              disabled={disabled}
              className="block max-h-[140px] min-h-11 resize-none overflow-hidden rounded-none border-0 bg-surface-canvas px-3 py-3 text-sm leading-5 focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0 disabled:bg-surface-sunken"
              placeholder={`Message ${channelName}`}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={mentionMenuOpen}
              aria-controls={mentionMenuOpen ? "mention-suggestions" : undefined}
              aria-activedescendant={
                mentionMenuOpen && mentionSuggestions[activeMentionIndex] !== undefined
                  ? `mention-suggestion-${mentionSuggestions[activeMentionIndex].id}`
                  : undefined
              }
              onChange={(event) =>
                updateDraft(event.target.value, event.currentTarget.selectionStart ?? event.target.value.length)
              }
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
      id="mention-suggestions"
      className="mentionMenu absolute bottom-[calc(100%+6px)] left-12 z-20 w-[min(320px,calc(100vw-120px))] overflow-hidden rounded-panel border border-border-strong bg-surface-raised py-1 shadow-popover"
      role="listbox"
      aria-label="Mention suggestions"
    >
      {loading || members.length === 0 ? (
        <p className="m-0 px-3 py-2 text-[13px] leading-[1.35] text-foreground-subtle">{emptyMessage}</p>
      ) : (
        members.map((member, index) => (
          <Button
            key={member.id}
            id={`mention-suggestion-${member.id}`}
            type="button"
            variant="ghost"
            className={cn(
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
            <span className="min-w-0 overflow-hidden text-sm font-bold text-ellipsis whitespace-nowrap">
              {member.displayName}
            </span>
          </Button>
        ))
      )}
    </div>
  )
}
