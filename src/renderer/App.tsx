import { Result } from "@effect-atom/atom"
import { useAtomSet, useAtomValue } from "@effect-atom/atom-react"
import { Cause } from "effect"
import {
  Copy,
  Ellipsis,
  Hash,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  Square,
  SquareCheck,
  Trash2,
  Users
} from "lucide-react"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import type { Channel, ChannelId, ChannelMessage, ChannelMessageId } from "../shared/collab-rpc"
import "./App.css"
import type {
  ChatDataModel,
  ChatDataView,
  ChatMessageGuard,
  ChatOperationErrorMessage,
  SelectChatChannel
} from "./chat-data"
import * as atoms from "./collab-atoms"
import {
  type MessageRowState,
  useMessageInteractions
} from "./message-interactions"

type ChannelIndicator = "unread" | "mentioned"

type ChannelMember = {
  readonly id: string
  readonly displayName: string
}

type ChannelViewModel = {
  readonly members: ReadonlyArray<ChannelMember>
  readonly channelIndicator: ChannelIndicator | null
}

type ChannelMessageGroup = {
  readonly id: ChannelMessageId
  readonly authorType: ChannelMessage["authorType"]
  readonly authorId: string
  readonly authorDisplayName: string
  readonly messages: ReadonlyArray<ChannelMessage>
}

export type ProfileMenuAction = {
  readonly label: string
  readonly onSelect: () => void
}

const MESSAGE_CONTEXT_MENU_WIDTH = 170
const MESSAGE_CONTEXT_MENU_OFFSET = 6
const COMPOSER_MIN_HEIGHT = 22
const COMPOSER_MAX_HEIGHT = 140
const MESSAGE_EDIT_MAX_HEIGHT = 180

export function App() {
  const snapshot = useAtomValue(atoms.snapshot)
  const createChannelMessage = useAtomSet(atoms.createChannelMessage, { mode: "promise" })
  const deleteChannelMessage = useAtomSet(atoms.deleteChannelMessage, { mode: "promise" })

  return Result.builder(snapshot)
    .onInitial(() => <main className="loadingShell"><p>Loading...</p></main>)
    .onFailure((cause) => <main className="loadingShell"><p className="errorText">{Cause.pretty(cause)}</p></main>)
    .onSuccess((model) => (
      <WorkspaceChat
        model={model}
        createChannelMessage={createChannelMessage}
        deleteChannelMessage={deleteChannelMessage}
      />
    ))
    .orNull()
}

export function WorkspaceChat(props: {
  readonly model: ChatDataModel
  readonly createChannelMessage: ChatDataView["createChannelMessage"]
  readonly deleteChannelMessage: ChatDataView["deleteChannelMessage"]
  readonly createChannel?: ChatDataView["createChannel"]
  readonly selectChannel?: SelectChatChannel
  readonly editChannelMessage?: ChatDataView["editChannelMessage"]
  readonly canDeleteMessages?: boolean
  readonly canDeleteMessage?: ChatMessageGuard
  readonly canEditMessage?: ChatMessageGuard
  readonly operationErrorMessage?: ChatOperationErrorMessage
  readonly profileMenuActions?: ReadonlyArray<ProfileMenuAction>
}) {
  const {
    model,
    createChannel,
    selectChannel,
    createChannelMessage,
    deleteChannelMessage,
    editChannelMessage,
    canDeleteMessages = true,
    canDeleteMessage,
    canEditMessage,
    operationErrorMessage,
    profileMenuActions = []
  } = props
  const [messageDraft, setMessageDraft] = useState("")
  const [operationError, setOperationError] = useState<string | null>(null)
  const [channelOperationError, setChannelOperationError] = useState<string | null>(null)
  const [membersOpen, setMembersOpen] = useState(true)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const view = useMemo(() => createChannelViewModel(model), [model])
  const messageGroups = useMemo(
    () => groupConsecutiveMessages(model.channelMessages),
    [model.channelMessages]
  )
  const channelMessagesLoading = model.channelMessagesLoading === true
  const [directMessageMembers, setDirectMessageMembers] = useState<ReadonlyArray<ChannelMember>>([])
  const messageInteractions = useMessageInteractions({
    channelId: model.channel.id,
    messages: model.channelMessages,
    deleteChannelMessage,
    editChannelMessage,
    operationErrorMessage,
    setOperationError
  })

  useEffect(() => {
    setMessageDraft("")
    setOperationError(null)
    setChannelOperationError(null)
  }, [model.channel.id])

  useEffect(() => {
    if (channelMessagesLoading) return
    setDirectMessageMembers((members) => mergeChannelMembers(members, view.members))
  }, [channelMessagesLoading, view.members])

  useEffect(() => {
    if (!profileMenuOpen) return
    const closeMenu = () => setProfileMenuOpen(false)
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu()
    }
    window.addEventListener("click", closeMenu)
    window.addEventListener("keydown", closeMenuOnEscape)
    return () => {
      window.removeEventListener("click", closeMenu)
      window.removeEventListener("keydown", closeMenuOnEscape)
    }
  }, [profileMenuOpen])

  const copyMessage = (message: ChannelMessage) => {
    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
      void navigator.clipboard.writeText(message.body).catch(() => {})
    }
  }

  const sendChannelMessage = () => {
    if (channelMessagesLoading) return
    const body = messageDraft.trim()
    if (body.length === 0) return
    setOperationError(null)
    void createChannelMessage({
      channelId: model.channel.id,
      body
    })
      .then(() => setMessageDraft(""))
      .catch((cause) => {
        if (operationErrorMessage !== undefined) setOperationError(operationErrorMessage("send", cause))
      })
  }

  const messageCanDelete = (message: ChannelMessage): boolean =>
    canDeleteMessages && (canDeleteMessage?.(message) ?? true)

  const messageCanEdit = (message: ChannelMessage): boolean =>
    editChannelMessage !== undefined && (canEditMessage?.(message) ?? true)

  const menuMessage = messageInteractions.menuMessage
  const messageMenu = messageInteractions.messageMenu
  const pendingDeleteMessage = messageInteractions.pendingDeleteMessage

  return (
    <main className={classNames("appShell", !membersOpen && "membersCollapsed")}>
      <WorkspaceRail
        workspaceName={model.workspace.name}
        currentUserName={model.currentUser.displayName}
        members={directMessageMembers}
        profileMenuOpen={profileMenuOpen}
        profileMenuActions={profileMenuActions}
        onToggleProfileMenu={() => setProfileMenuOpen((open) => !open)}
        onCloseProfileMenu={() => setProfileMenuOpen(false)}
      />

      <ChannelSidebar
        workspaceName={model.workspace.name}
        channels={model.channels}
        activeChannelId={model.channel.id}
        channelName={model.channel.name}
        channelVisibility={model.channel.visibility}
        channelIndicator={view.channelIndicator}
        channelOperationError={channelOperationError}
        createChannel={createChannel}
        onSelectChannel={selectChannel}
        onChannelOperationError={setChannelOperationError}
      />

      <ChannelHeader
        channelName={model.channel.name}
        membersOpen={membersOpen}
        onToggleMembers={() => setMembersOpen((open) => !open)}
      />

      <ChatPane
        channelName={model.channel.name}
        messageGroups={messageGroups}
        loading={channelMessagesLoading}
        messageDraft={messageDraft}
        operationError={operationError}
        onMessageDraftChange={setMessageDraft}
        onSendMessage={sendChannelMessage}
        onToggleMessage={messageInteractions.toggleMessageSelection}
        onCopyMessage={copyMessage}
        onStartEditMessage={messageInteractions.startEditingMessage}
        onEditDraftChange={messageInteractions.setEditingDraft}
        onCancelEditMessage={messageInteractions.cancelEditingMessage}
        onSaveEditMessage={messageInteractions.saveEditingMessage}
        onDeleteMessage={messageInteractions.requestDeleteMessage}
        canDeleteMessage={messageCanDelete}
        canEditMessage={messageCanEdit}
        getMessageRowState={messageInteractions.getRowState}
        onOpenMessageMenu={messageInteractions.openMessageMenu}
      />

      <MembersPanel
        members={view.members}
        currentUserId={model.currentUser.id}
        loading={channelMessagesLoading}
      />

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
  readonly members: ReadonlyArray<ChannelMember>
  readonly profileMenuOpen: boolean
  readonly profileMenuActions: ReadonlyArray<ProfileMenuAction>
  readonly onToggleProfileMenu: () => void
  readonly onCloseProfileMenu: () => void
}) {
  const {
    workspaceName,
    currentUserName,
    members,
    profileMenuOpen,
    profileMenuActions,
    onToggleProfileMenu,
    onCloseProfileMenu
  } = props
  const hasProfileActions = profileMenuActions.length > 0
  return (
    <aside className="workspaceRail" aria-label="Global navigation">
      <nav className="railGroup" aria-label="Workspaces">
        <button type="button" className="workspaceRailItem active" aria-label={workspaceName}>
          {initials(workspaceName)}
          <span className="railTooltip" role="tooltip">{workspaceName}</span>
        </button>
      </nav>
      <div className="railDivider" role="separator" aria-label="Direct messages" />
      <nav className="railGroup" aria-label="Direct messages">
        {members.map((member) => (
          <button
            key={member.id}
            type="button"
            className="dmRailItem"
            aria-label={member.displayName}
          >
            {initials(member.displayName)}
            <span className="railTooltip" role="tooltip">{member.displayName}</span>
          </button>
        ))}
      </nav>
      <div className="railSpacer" />
      <div className="railProfile">
        <button
          type="button"
          className="railUser"
          title={currentUserName}
          aria-label={hasProfileActions ? `Open profile menu for ${currentUserName}` : currentUserName}
          aria-haspopup={hasProfileActions ? "menu" : undefined}
          aria-expanded={hasProfileActions ? profileMenuOpen : undefined}
          disabled={!hasProfileActions}
          onClick={(event) => {
            event.stopPropagation()
            if (hasProfileActions) onToggleProfileMenu()
          }}
        >
          {initials(currentUserName)}
        </button>
        {profileMenuOpen && hasProfileActions
          ? (
            <div className="profileMenu" role="menu" aria-label="Profile settings" onClick={(event) => event.stopPropagation()}>
              <div className="profileMenuHeader">
                <strong>{currentUserName}</strong>
              </div>
              {profileMenuActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onCloseProfileMenu()
                    action.onSelect()
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )
          : null}
      </div>
    </aside>
  )
}

function ChannelSidebar(props: {
  readonly workspaceName: string
  readonly channels: ReadonlyArray<Channel>
  readonly activeChannelId: ChannelId
  readonly channelName: string
  readonly channelVisibility: Channel["visibility"]
  readonly channelIndicator: ChannelIndicator | null
  readonly channelOperationError: string | null
  readonly createChannel?: ChatDataView["createChannel"]
  readonly onSelectChannel?: SelectChatChannel
  readonly onChannelOperationError: (message: string | null) => void
}) {
  const {
    workspaceName,
    channels,
    activeChannelId,
    channelName,
    channelVisibility,
    channelIndicator,
    channelOperationError,
    createChannel,
    onSelectChannel,
    onChannelOperationError
  } = props
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const showAgentParkedPanel = import.meta.env.VITE_AETHER_SHOW_AGENT_UI === "true"
  const canCreate = createChannel !== undefined
  const closeCreateDialog = () => {
    if (saving) return
    setCreating(false)
    setDraft("")
    onChannelOperationError(null)
  }
  const submitChannel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = draft.trim()
    if (createChannel === undefined || name.length === 0 || saving) return
    setSaving(true)
    onChannelOperationError(null)
    void createChannel({ name })
      .then(() => {
        setDraft("")
        setCreating(false)
      })
      .catch(() => onChannelOperationError("Could not create channel. Check your connection and try again."))
      .finally(() => setSaving(false))
  }

  return (
    <>
      <aside className="channelSidebar" aria-label="Workspace navigation">
        <header className="workspaceHeader">
          <h1>{workspaceName}</h1>
        </header>

        <nav className="sidebarSection" aria-label="Channels">
          <div className="sidebarHeaderRow">
            <span>Channels</span>
            <button
              type="button"
              aria-label="Add channel"
              aria-haspopup="dialog"
              aria-expanded={creating}
              disabled={!canCreate}
              onClick={() => {
                setCreating(true)
                onChannelOperationError(null)
              }}
            >
              <Plus className="buttonIcon" aria-hidden="true" />
            </button>
          </div>
          {channels.map((channel) => {
            const active = channel.id === activeChannelId
            return (
              <button
                key={channel.id}
                type="button"
                className={classNames("channelNavItem", active && "active")}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (!active) onSelectChannel?.(channel.id)
                }}
              >
                <span className="channelNavMain">
                  <span className="channelNavName">
                    <ChannelGlyph visibility={channel.visibility} />
                    <span className="channelNavText">{channel.name}</span>
                  </span>
                </span>
                {active && channelIndicator !== null
                  ? (
                    <span
                      className={`channelIndicator ${channelIndicator}`}
                      aria-label={channelIndicator === "mentioned" ? "Mentioned" : "Unread messages"}
                    />
                  )
                  : null}
              </button>
            )
          })}
          {channels.length === 0
            ? (
              <button type="button" className="channelNavItem active" aria-current="page">
                <span className="channelNavMain">
                  <span className="channelNavName">
                    <ChannelGlyph visibility={channelVisibility} />
                    <span className="channelNavText">{channelName}</span>
                  </span>
                </span>
              </button>
            )
            : null}
        </nav>

        {showAgentParkedPanel
          ? (
            <section className="laterPanel" aria-label="Later integrations">
              <strong>Agents later</strong>
              <p>Chat stays first. The existing RPC agent plumbing is parked behind the product surface for the next phase.</p>
            </section>
          )
          : null}
      </aside>

      {creating
        ? (
          <CreateChannelDialog
            draft={draft}
            saving={saving}
            error={channelOperationError}
            onDraftChange={setDraft}
            onSubmit={submitChannel}
            onCancel={closeCreateDialog}
          />
        )
        : null}
    </>
  )
}

function CreateChannelDialog(props: {
  readonly draft: string
  readonly saving: boolean
  readonly error: string | null
  readonly onDraftChange: (draft: string) => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
  readonly onCancel: () => void
}) {
  const { draft, saving, error, onDraftChange, onSubmit, onCancel } = props
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [onCancel])

  return (
    <div className="dialogScrim" role="presentation" onClick={onCancel}>
      <section
        className="channelCreateDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-channel-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="create-channel-title">Create Channel</h2>
        <form className="channelCreateForm" aria-label="Create channel" onSubmit={onSubmit}>
          <label htmlFor="new-channel-name">Channel name</label>
          <input
            ref={inputRef}
            id="new-channel-name"
            value={draft}
            placeholder="new-channel"
            disabled={saving}
            onChange={(event) => onDraftChange(event.target.value)}
          />
          {error === null
            ? null
            : <p className="channelCreateError" role="status">{error}</p>}
          <div className="channelCreateActions">
            <button type="button" disabled={saving} onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" disabled={draft.trim().length === 0 || saving}>
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ChannelGlyph(props: { readonly visibility?: Channel["visibility"] }) {
  return (
    <span className={classNames("channelGlyph", props.visibility === "private" && "private")} aria-hidden="true">
      <Hash className="channelHashIcon buttonIcon" />
      {props.visibility === "private"
        ? <Lock className="channelLockBadge" />
        : null}
    </span>
  )
}

function ChannelHeader(props: {
  readonly channelName: string
  readonly membersOpen: boolean
  readonly onToggleMembers: () => void
}) {
  const { channelName, membersOpen, onToggleMembers } = props
  const membersToggleLabel = membersOpen ? "Hide members" : "Show members"
  return (
    <header className="chatHeader">
      <div className="channelTitle">
        <Hash className="channelHashIcon buttonIcon" aria-hidden="true" />
        <h2>{channelName}</h2>
      </div>
      <div className="chatHeaderActions" aria-label="Channel actions">
        <button
          type="button"
          className={classNames("membersToggle", membersOpen && "active")}
          aria-label={membersToggleLabel}
          aria-pressed={membersOpen}
          title={membersToggleLabel}
          onClick={onToggleMembers}
        >
          <Users className="buttonIcon" aria-hidden="true" />
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
  readonly operationError: string | null
  readonly onMessageDraftChange: (draft: string) => void
  readonly onSendMessage: () => void
  readonly onToggleMessage: (messageId: ChannelMessageId) => void
  readonly onCopyMessage: (message: ChannelMessage) => void
  readonly onStartEditMessage: (message: ChannelMessage) => void
  readonly onEditDraftChange: (draft: string) => void
  readonly onCancelEditMessage: () => void
  readonly onSaveEditMessage: () => void
  readonly onDeleteMessage: (messageId: ChannelMessageId) => void
  readonly canDeleteMessage: ChatMessageGuard
  readonly canEditMessage: ChatMessageGuard
  readonly getMessageRowState: (message: ChannelMessage) => MessageRowState
  readonly onOpenMessageMenu: (messageId: ChannelMessageId, x: number, y: number) => void
}) {
  const {
    channelName,
    messageGroups,
    loading,
    messageDraft,
    operationError,
    onMessageDraftChange,
    onSendMessage,
    onToggleMessage,
    onCopyMessage,
    onStartEditMessage,
    onEditDraftChange,
    onCancelEditMessage,
    onSaveEditMessage,
    onDeleteMessage,
    canDeleteMessage,
    canEditMessage,
    getMessageRowState,
    onOpenMessageMenu
  } = props

  return (
    <section className="chatPane" aria-label={`${channelName} chat`}>
      <ol className="chatTimeline" aria-label="Channel messages" aria-busy={loading}>
        {loading
          ? <ChannelMessagesSkeleton />
          : null}
        {!loading && messageGroups.length === 0
          ? (
            <li className="chatEmptyState">
              <strong>No messages yet</strong>
              <span className="chatEmptyChannel">
                Start the conversation in
                <Hash className="channelHashIcon buttonIcon" aria-hidden="true" />
                <span>{channelName}.</span>
              </span>
            </li>
          )
          : null}
        {!loading && messageGroups.map((group) => (
          <li key={group.id} className="channelMessageGroup">
            <div className="messageAvatar messageRunAvatar" aria-hidden="true">{initials(group.authorDisplayName)}</div>
            <div className="messageRun">
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
        onDraftChange={onMessageDraftChange}
        onSend={onSendMessage}
      />
    </section>
  )
}

function ChannelMessagesSkeleton() {
  return (
    <>
      {Array.from({ length: 7 }, (_, index) => (
        <li key={index} className="channelMessageSkeleton" aria-hidden="true">
          <span className="skeletonAvatar" />
          <span className="skeletonMessageContent">
            <span className="skeletonLine meta" />
            <span className={classNames("skeletonLine body", index % 3 === 0 && "short", index % 3 === 1 && "medium")} />
          </span>
        </li>
      ))}
    </>
  )
}

function ChannelMessageRow(props: {
  readonly message: ChannelMessage
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
    onOpenMenu
  } = props
  const deleted = message.deletedAt !== null
  const editing = editingDraft !== null
  const className = classNames(
    "channelMessage",
    !startsAuthorRun && "compact",
    deleted && "deleted",
    editing && "editing",
    selected && "selected",
    selectionMode && !deleted && "selecting"
  )

  return (
    <article
      className={className}
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
          <input
            className="messageCheckbox"
            type="checkbox"
            checked={selected}
            aria-label={`${selected ? "Deselect" : "Select"} message from ${message.authorDisplayName}`}
            onChange={onToggle}
            onClick={(event) => event.stopPropagation()}
          />
        )
        : null}
      <div className="messageContent">
        <div className="messageMeta">
          {startsAuthorRun
            ? <strong>{message.authorDisplayName}</strong>
            : null}
          <time
            className={classNames("messageTimestamp", !startsAuthorRun && "hidden")}
            dateTime={toIso(message.createdAt)}
          >
            {formatTime(message.createdAt)}
          </time>
          {message.editedAt === null || !startsAuthorRun
            ? null
            : <span className="messageEdited" title={`Edited ${formatTime(message.editedAt)}`}>edited</span>}
        </div>
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
          : <p>{deleted ? "Message deleted" : message.body}</p>}
      </div>
      {message.editedAt === null || startsAuthorRun
        ? null
        : <span className="messageEdited compactEdited" title={`Edited ${formatTime(message.editedAt)}`}>edited</span>}
      {deleted || editing || !actionsAvailable
        ? null
        : (
          <div
            className={classNames("messageActions", actionsPinned && "visible")}
            aria-label={`Message actions for ${message.authorDisplayName}`}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              aria-label={`More actions for message from ${message.authorDisplayName}`}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                const x = Math.max(MESSAGE_CONTEXT_MENU_OFFSET, rect.right - MESSAGE_CONTEXT_MENU_WIDTH)
                onOpenMenu(x, rect.bottom + MESSAGE_CONTEXT_MENU_OFFSET)
              }}
            >
              <Ellipsis className="buttonIcon" aria-hidden="true" />
            </button>
          </div>
        )}
    </article>
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
    <form className="messageEditForm" aria-label={`Edit message from ${authorDisplayName}`} onSubmit={submit} onClick={(event) => event.stopPropagation()}>
      <textarea
        ref={textareaRef}
        rows={2}
        value={draft}
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
      <div className="messageEditActions">
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" disabled={!canSave}>{saving ? "Saving..." : "Save"}</button>
      </div>
    </form>
  )
}

function MessageComposer(props: {
  readonly channelName: string
  readonly draft: string
  readonly operationError: string | null
  readonly disabled: boolean
  readonly onDraftChange: (draft: string) => void
  readonly onSend: () => void
}) {
  const { channelName, draft, operationError, disabled, onDraftChange, onSend } = props
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    resizeTextarea(textareaRef.current, COMPOSER_MIN_HEIGHT, COMPOSER_MAX_HEIGHT)
  }, [draft])

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled) return
    onSend()
  }

  return (
    <div className="composerDock">
      {operationError === null
        ? null
        : <p className="composerError" role="status">{operationError}</p>}
      <form className={classNames("composer", disabled && "disabled")} onSubmit={onSubmit} aria-label="Channel message composer">
        <button type="button" className="composerAddButton" aria-label="Add attachment" disabled={disabled}>
          <Paperclip className="buttonIcon" aria-hidden="true" />
        </button>
        <label className="srOnly" htmlFor="channel-message">Message</label>
        <textarea
          ref={textareaRef}
          id="channel-message"
          rows={1}
          value={draft}
          disabled={disabled}
          placeholder={`Message ${channelName}`}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              if (!disabled) onSend()
            }
          }}
        />
      </form>
    </div>
  )
}

function MembersPanel(props: {
  readonly members: ReadonlyArray<ChannelMember>
  readonly currentUserId: string
  readonly loading: boolean
}) {
  const { members, currentUserId, loading } = props
  return (
    <aside className="membersPanel" aria-label="Channel members">
      <div className="membersContent" aria-busy={loading}>
        <p className="memberGroupLabel">Online -- {loading ? "" : members.length}</p>
        {loading
          ? <MembersSkeleton />
          : (
            <ol className="memberList">
              {members.map((member) => (
            <li key={member.id}>
              <span className="memberAvatar" aria-hidden="true">{initials(member.displayName)}</span>
              <div>
                <strong>{member.displayName}</strong>
                <span>{member.id === currentUserId ? "You" : "Member"}</span>
              </div>
            </li>
              ))}
            </ol>
          )}
      </div>
    </aside>
  )
}

function MembersSkeleton() {
  return (
    <ol className="memberList" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <li key={index} className="memberSkeleton">
          <span className="skeletonAvatar small" />
          <span>
            <span className="skeletonLine memberName" />
            <span className="skeletonLine memberRole" />
          </span>
        </li>
      ))}
    </ol>
  )
}

function MessageContextMenu(props: {
  readonly message: ChannelMessage
  readonly selected: boolean
  readonly x: number
  readonly y: number
  readonly onToggle: () => void
  readonly onCopy: () => void
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly canEdit: boolean
  readonly canDelete: boolean
  readonly onClose: () => void
}) {
  const { message, selected, x, y, onToggle, onCopy, onEdit, onDelete, canEdit, canDelete, onClose } = props
  const SelectIcon = selected ? Square : SquareCheck
  return (
    <div
      className="messageContextMenu"
      role="menu"
      aria-label={`Context menu for message from ${message.authorDisplayName}`}
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onToggle()
          onClose()
        }}
      >
        <SelectIcon className="buttonIcon" aria-hidden="true" />
        <span>{selected ? "Deselect" : "Select"}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onCopy()
          onClose()
        }}
      >
        <Copy className="buttonIcon" aria-hidden="true" />
        <span>Copy message</span>
      </button>
      {canEdit
        ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onEdit()
              onClose()
            }}
          >
            <Pencil className="buttonIcon" aria-hidden="true" />
            <span>Edit message</span>
          </button>
        )
        : null}
      {canDelete
        ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDelete()
              onClose()
            }}
          >
            <Trash2 className="buttonIcon" aria-hidden="true" />
            <span>Delete message</span>
          </button>
        )
        : null}
    </div>
  )
}

function DeleteMessageDialog(props: {
  readonly authorDisplayName: string
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const { authorDisplayName, onCancel, onConfirm } = props
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    cancelButtonRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [onCancel])

  return (
    <div className="dialogScrim" role="presentation" onClick={onCancel}>
      <section
        className="deleteMessageDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-message-title"
        aria-describedby="delete-message-description"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="delete-message-title">Delete Message?</h2>
        <p id="delete-message-description">Delete this message from {authorDisplayName}? This cannot be undone.</p>
        <div className="deleteMessageActions">
          <button ref={cancelButtonRef} type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="danger" onClick={onConfirm}>Delete</button>
        </div>
      </section>
    </div>
  )
}

const createChannelViewModel = (model: ChatDataModel): ChannelViewModel => {
  const liveMessages = model.channelMessages.filter((message) => message.deletedAt === null)
  return {
    members: uniqueMembers(model.channelMessages),
    channelIndicator: getChannelIndicator(liveMessages, model.currentUser.id, model.currentUser.displayName)
  }
}

const uniqueMembers = (messages: ReadonlyArray<ChannelMessage>): ReadonlyArray<ChannelMember> => {
  const members = new Map<string, ChannelMember>()
  messages.forEach((message) => {
    members.set(message.authorId, { id: message.authorId, displayName: message.authorDisplayName })
  })
  return Array.from(members.values())
}

const mergeChannelMembers = (
  members: ReadonlyArray<ChannelMember>,
  nextMembers: ReadonlyArray<ChannelMember>
): ReadonlyArray<ChannelMember> => {
  if (nextMembers.length === 0) return members
  const byId = new Map(members.map((member) => [member.id, member]))
  let changed = false
  nextMembers.forEach((member) => {
    if (!byId.has(member.id)) {
      changed = true
      byId.set(member.id, member)
    }
  })
  return changed ? Array.from(byId.values()) : members
}

const getChannelIndicator = (
  messages: ReadonlyArray<ChannelMessage>,
  currentUserId: string,
  currentUserDisplayName: string
): ChannelIndicator | null => {
  const incomingMessages = messages.filter((message) => message.authorId !== currentUserId)
  if (incomingMessages.length === 0) return null
  const mentionNeedles = mentionCandidates(currentUserDisplayName)
  return incomingMessages.some((message) => {
    const body = message.body.toLowerCase()
    return mentionNeedles.some((needle) => body.includes(needle))
  })
    ? "mentioned"
    : "unread"
}

const mentionCandidates = (displayName: string): ReadonlyArray<string> => {
  const normalized = displayName.trim().toLowerCase()
  const firstName = normalized.split(/\s+/)[0] ?? ""
  return Array.from(new Set([`@${normalized}`, firstName.length === 0 ? "" : `@${firstName}`]))
    .filter((value) => value.length > 1)
}

const resizeTextarea = (textarea: HTMLTextAreaElement | null, minHeight: number, maxHeight: number) => {
  if (textarea === null) return
  textarea.style.height = "auto"
  const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)
  textarea.style.height = `${nextHeight}px`
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden"
}

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" })

const formatTime = (timestamp: number): string =>
  messageTimeFormatter.format(new Date(timestamp))

const toIso = (timestamp: number): string => new Date(timestamp).toISOString()

const groupConsecutiveMessages = (messages: ReadonlyArray<ChannelMessage>): ReadonlyArray<ChannelMessageGroup> => {
  const groups: Array<ChannelMessageGroup> = []

  for (const message of messages) {
    const current = groups.at(-1)
    if (current !== undefined && current.authorType === message.authorType && current.authorId === message.authorId) {
      groups[groups.length - 1] = { ...current, messages: [...current.messages, message] }
    } else {
      groups.push({
        id: message.id,
        authorType: message.authorType,
        authorId: message.authorId,
        authorDisplayName: message.authorDisplayName,
        messages: [message]
      })
    }
  }

  return groups
}

const initials = (value: string): string =>
  value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase()

const classNames = (...names: ReadonlyArray<string | false | null | undefined>): string =>
  names.filter((name): name is string => typeof name === "string" && name.length > 0).join(" ")
