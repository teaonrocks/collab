import { Result } from "@effect-atom/atom"
import { useAtomSet, useAtomValue } from "@effect-atom/atom-react"
import { Cause } from "effect"
import { type FormEvent, useEffect, useRef, useState } from "react"
import type { ChannelId, ChannelMessage, ChannelMessageId, CollabSnapshot } from "../shared/collab-rpc"
import "./App.css"
import * as atoms from "./collab-atoms"

type ChannelIndicator = "unread" | "mentioned"

type ChannelMember = {
  readonly id: string
  readonly displayName: string
}

type MessageMenuState = {
  readonly messageId: ChannelMessageId
  readonly x: number
  readonly y: number
} | null

type ChannelViewModel = {
  readonly selectedMessageIds: ReadonlyArray<ChannelMessageId>
  readonly selectedMessageIdSet: ReadonlySet<ChannelMessageId>
  readonly members: ReadonlyArray<ChannelMember>
  readonly channelIndicator: ChannelIndicator | null
  readonly topSelectedMessageId: ChannelMessageId | null
  readonly menuMessage: ChannelMessage | null
}

type CreateChannelMessage = (input: {
  readonly channelId: ChannelId
  readonly body: string
}) => Promise<unknown>

type DeleteChannelMessage = (input: {
  readonly channelId: ChannelId
  readonly messageId: ChannelMessageId
}) => Promise<unknown>

type EditChannelMessage = (input: {
  readonly channelId: ChannelId
  readonly messageId: ChannelMessageId
  readonly body: string
}) => Promise<unknown>

type MessageActionGuard = (message: ChannelMessage) => boolean

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
  readonly model: CollabSnapshot
  readonly createChannelMessage: CreateChannelMessage
  readonly deleteChannelMessage: DeleteChannelMessage
  readonly editChannelMessage?: EditChannelMessage
  readonly canDeleteMessages?: boolean
  readonly canDeleteMessage?: MessageActionGuard
  readonly canEditMessage?: MessageActionGuard
  readonly profileMenuActions?: ReadonlyArray<ProfileMenuAction>
}) {
  const {
    model,
    createChannelMessage,
    deleteChannelMessage,
    editChannelMessage,
    canDeleteMessages = true,
    canDeleteMessage,
    canEditMessage,
    profileMenuActions = []
  } = props
  const [messageDraft, setMessageDraft] = useState("")
  const [selectedMessageIds, setSelectedMessageIds] = useState<ReadonlyArray<ChannelMessageId>>([])
  const [editingMessage, setEditingMessage] = useState<{
    readonly messageId: ChannelMessageId
    readonly draft: string
    readonly saving: boolean
  } | null>(null)
  const [pendingDeleteMessageId, setPendingDeleteMessageId] = useState<ChannelMessageId | null>(null)
  const [membersOpen, setMembersOpen] = useState(true)
  const [messageMenu, setMessageMenu] = useState<MessageMenuState>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const view = createChannelViewModel(model, selectedMessageIds, messageMenu)
  const menuMessage = view.menuMessage
  const pendingDeleteMessage = pendingDeleteMessageId === null
    ? null
    : model.channelMessages.find((message) => message.id === pendingDeleteMessageId && message.deletedAt === null) ?? null

  useEffect(() => {
    setSelectedMessageIds((ids) => pruneSelectedMessageIds(ids, model.channelMessages))
  }, [model.channelMessages])

  useEffect(() => {
    if (editingMessage === null) return
    const message = model.channelMessages.find((item) => item.id === editingMessage.messageId)
    if (message === undefined || message.deletedAt !== null) setEditingMessage(null)
  }, [editingMessage, model.channelMessages])

  useEffect(() => {
    if (pendingDeleteMessageId !== null && pendingDeleteMessage === null) setPendingDeleteMessageId(null)
  }, [pendingDeleteMessage, pendingDeleteMessageId])

  useEffect(() => {
    if (messageMenu === null) return
    const closeMenu = () => setMessageMenu(null)
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu()
    }
    window.addEventListener("click", closeMenu)
    window.addEventListener("keydown", closeMenuOnEscape)
    return () => {
      window.removeEventListener("click", closeMenu)
      window.removeEventListener("keydown", closeMenuOnEscape)
    }
  }, [messageMenu])

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

  const toggleMessageSelection = (messageId: ChannelMessageId) => {
    setSelectedMessageIds((ids) => toggleMessageId(ids, messageId))
  }

  const copyMessage = (message: ChannelMessage) => {
    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
      void navigator.clipboard.writeText(message.body).catch(() => {})
    }
  }

  const sendChannelMessage = () => {
    const body = messageDraft.trim()
    if (body.length === 0) return
    void createChannelMessage({
      channelId: model.channel.id,
      body
    })
      .then(() => setMessageDraft(""))
      .catch(() => {})
  }

  const requestDeleteMessage = (messageId: ChannelMessageId) => {
    setPendingDeleteMessageId(messageId)
    setMessageMenu(null)
  }

  const confirmDeleteMessage = () => {
    if (pendingDeleteMessage === null) return
    const messageId = pendingDeleteMessage.id
    void deleteChannelMessage({
      channelId: model.channel.id,
      messageId
    })
      .then(() => {
        setSelectedMessageIds((ids) => ids.filter((id) => id !== messageId))
        setEditingMessage((editing) => editing?.messageId === messageId ? null : editing)
        setPendingDeleteMessageId(null)
        setMessageMenu(null)
      })
      .catch(() => {})
  }

  const startEditingMessage = (message: ChannelMessage) => {
    setEditingMessage({ messageId: message.id, draft: message.body, saving: false })
    setMessageMenu(null)
  }

  const saveEditingMessage = () => {
    if (editingMessage === null || editChannelMessage === undefined || editingMessage.saving) return
    const body = editingMessage.draft.trim()
    if (body.length === 0) return

    setEditingMessage({ ...editingMessage, saving: true })
    void editChannelMessage({
      channelId: model.channel.id,
      messageId: editingMessage.messageId,
      body
    })
      .then(() => setEditingMessage(null))
      .catch(() => setEditingMessage((editing) => editing === null ? null : { ...editing, saving: false }))
  }

  const openMessageMenu = (messageId: ChannelMessageId, x: number, y: number) => {
    setMessageMenu({ messageId, x, y })
  }

  const messageCanDelete = (message: ChannelMessage): boolean =>
    canDeleteMessages && (canDeleteMessage?.(message) ?? true)

  const messageCanEdit = (message: ChannelMessage): boolean =>
    editChannelMessage !== undefined && (canEditMessage?.(message) ?? true)

  return (
    <main className={classNames("appShell", !membersOpen && "membersCollapsed")}>
      <WorkspaceRail
        workspaceName={model.workspace.name}
        currentUserName={model.currentUser.displayName}
        members={view.members}
        profileMenuOpen={profileMenuOpen}
        profileMenuActions={profileMenuActions}
        onToggleProfileMenu={() => setProfileMenuOpen((open) => !open)}
        onCloseProfileMenu={() => setProfileMenuOpen(false)}
      />

      <ChannelSidebar
        workspaceName={model.workspace.name}
        channelName={model.channel.name}
        channelIndicator={view.channelIndicator}
      />

      <ChannelHeader
        channelName={model.channel.name}
        channelVisibility={model.channel.visibility}
        membersOpen={membersOpen}
        onToggleMembers={() => setMembersOpen((open) => !open)}
      />

      <ChatPane
        channelName={model.channel.name}
        messages={model.channelMessages}
        selectedMessageIds={view.selectedMessageIds}
        selectedMessageIdSet={view.selectedMessageIdSet}
        topSelectedMessageId={view.topSelectedMessageId}
        messageDraft={messageDraft}
        onMessageDraftChange={setMessageDraft}
        onSendMessage={sendChannelMessage}
        onToggleMessage={toggleMessageSelection}
        onCopyMessage={copyMessage}
        onStartEditMessage={startEditingMessage}
        onEditDraftChange={(draft) => setEditingMessage((editing) => editing === null ? null : { ...editing, draft })}
        onCancelEditMessage={() => setEditingMessage(null)}
        onSaveEditMessage={saveEditingMessage}
        onDeleteMessage={requestDeleteMessage}
        canDeleteMessage={messageCanDelete}
        canEditMessage={messageCanEdit}
        editingMessage={editingMessage}
        onOpenMessageMenu={openMessageMenu}
      />

      <MembersPanel
        members={view.members}
        currentUserId={model.currentUser.id}
      />

      {menuMessage === null || messageMenu === null
        ? null
        : (
          <MessageContextMenu
            message={menuMessage}
            selected={view.selectedMessageIdSet.has(menuMessage.id)}
            x={messageMenu.x}
            y={messageMenu.y}
            onToggle={() => toggleMessageSelection(menuMessage.id)}
            onCopy={() => copyMessage(menuMessage)}
            onEdit={() => startEditingMessage(menuMessage)}
            onDelete={() => requestDeleteMessage(menuMessage.id)}
            canEdit={messageCanEdit(menuMessage)}
            canDelete={messageCanDelete(menuMessage)}
            onClose={() => setMessageMenu(null)}
          />
        )}

      {pendingDeleteMessage === null
        ? null
        : (
          <DeleteMessageDialog
            authorDisplayName={pendingDeleteMessage.authorDisplayName}
            onCancel={() => setPendingDeleteMessageId(null)}
            onConfirm={confirmDeleteMessage}
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
  readonly channelName: string
  readonly channelIndicator: ChannelIndicator | null
}) {
  const { workspaceName, channelName, channelIndicator } = props
  const showAgentParkedPanel = import.meta.env.VITE_AETHER_SHOW_AGENT_UI === "true"
  return (
    <aside className="channelSidebar" aria-label="Workspace navigation">
      <header className="workspaceHeader">
        <h1>{workspaceName}</h1>
      </header>

      <nav className="sidebarSection" aria-label="Channels">
        <div className="sidebarHeaderRow">
          <span>Channels</span>
          <button type="button" aria-label="Add channel" disabled>+</button>
        </div>
        <button type="button" className="channelNavItem active" aria-current="page">
          <span>#{channelName}</span>
          {channelIndicator === null
            ? null
            : (
              <span
                className={`channelIndicator ${channelIndicator}`}
                aria-label={channelIndicator === "mentioned" ? "Mentioned" : "Unread messages"}
              />
            )}
        </button>
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
  )
}

function ChannelHeader(props: {
  readonly channelName: string
  readonly channelVisibility: string
  readonly membersOpen: boolean
  readonly onToggleMembers: () => void
}) {
  const { channelName, channelVisibility, membersOpen, onToggleMembers } = props
  return (
    <header className="chatHeader">
      <div className="channelTitle">
        <span aria-hidden="true">#</span>
        <div>
          <h2>{channelName}</h2>
          <p>{channelVisibility} channel</p>
        </div>
      </div>
      <div className="chatHeaderActions" aria-label="Channel actions">
        <button type="button" onClick={onToggleMembers}>
          {membersOpen ? "Hide members" : "Show members"}
        </button>
      </div>
    </header>
  )
}

function ChatPane(props: {
  readonly channelName: string
  readonly messages: ReadonlyArray<ChannelMessage>
  readonly selectedMessageIds: ReadonlyArray<ChannelMessageId>
  readonly selectedMessageIdSet: ReadonlySet<ChannelMessageId>
  readonly topSelectedMessageId: ChannelMessageId | null
  readonly messageDraft: string
  readonly onMessageDraftChange: (draft: string) => void
  readonly onSendMessage: () => void
  readonly onToggleMessage: (messageId: ChannelMessageId) => void
  readonly onCopyMessage: (message: ChannelMessage) => void
  readonly onStartEditMessage: (message: ChannelMessage) => void
  readonly onEditDraftChange: (draft: string) => void
  readonly onCancelEditMessage: () => void
  readonly onSaveEditMessage: () => void
  readonly onDeleteMessage: (messageId: ChannelMessageId) => void
  readonly canDeleteMessage: MessageActionGuard
  readonly canEditMessage: MessageActionGuard
  readonly editingMessage: {
    readonly messageId: ChannelMessageId
    readonly draft: string
    readonly saving: boolean
  } | null
  readonly onOpenMessageMenu: (messageId: ChannelMessageId, x: number, y: number) => void
}) {
  const {
    channelName,
    messages,
    selectedMessageIds,
    selectedMessageIdSet,
    topSelectedMessageId,
    messageDraft,
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
    editingMessage,
    onOpenMessageMenu
  } = props
  const selectionMode = selectedMessageIds.length > 0

  return (
    <section className="chatPane" aria-label={`#${channelName} chat`}>
      <ol className="chatTimeline" aria-label="Channel messages">
        {messages.map((message) => {
          const actionsPinned = selectionMode && message.id === topSelectedMessageId
          return (
            <li key={message.id}>
              <ChannelMessageRow
                message={message}
                selected={selectedMessageIdSet.has(message.id)}
                selectionMode={selectionMode}
                actionsPinned={actionsPinned}
                actionsAvailable={!selectionMode || actionsPinned}
                onToggle={() => onToggleMessage(message.id)}
                onCopy={() => onCopyMessage(message)}
                onEdit={() => onStartEditMessage(message)}
                onEditDraftChange={onEditDraftChange}
                onCancelEdit={onCancelEditMessage}
                onSaveEdit={onSaveEditMessage}
                onDelete={() => onDeleteMessage(message.id)}
                canEdit={canEditMessage(message)}
                canDelete={canDeleteMessage(message)}
                editingDraft={editingMessage?.messageId === message.id ? editingMessage.draft : null}
                editSaving={editingMessage?.messageId === message.id && editingMessage.saving}
                onOpenMenu={(x, y) => onOpenMessageMenu(message.id, x, y)}
              />
            </li>
          )
        })}
      </ol>

      <MessageComposer
        channelName={channelName}
        draft={messageDraft}
        onDraftChange={onMessageDraftChange}
        onSend={onSendMessage}
      />
    </section>
  )
}

function ChannelMessageRow(props: {
  readonly message: ChannelMessage
  readonly selected: boolean
  readonly selectionMode: boolean
  readonly actionsPinned: boolean
  readonly actionsAvailable: boolean
  readonly onToggle: () => void
  readonly onCopy: () => void
  readonly onEdit: () => void
  readonly onEditDraftChange: (draft: string) => void
  readonly onCancelEdit: () => void
  readonly onSaveEdit: () => void
  readonly onDelete: () => void
  readonly canEdit: boolean
  readonly canDelete: boolean
  readonly editingDraft: string | null
  readonly editSaving: boolean
  readonly onOpenMenu: (x: number, y: number) => void
}) {
  const {
    message,
    selected,
    selectionMode,
    actionsPinned,
    actionsAvailable,
    onToggle,
    onCopy,
    onEdit,
    onEditDraftChange,
    onCancelEdit,
    onSaveEdit,
    onDelete,
    canEdit,
    canDelete,
    editingDraft,
    editSaving,
    onOpenMenu
  } = props
  const deleted = message.deletedAt !== null
  const editing = editingDraft !== null
  const className = classNames(
    "channelMessage",
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
      <div className="messageAvatar" aria-hidden="true">{initials(message.authorDisplayName)}</div>
      <div className="messageContent">
        <div className="messageMeta">
          <strong>{message.authorDisplayName}</strong>
          <time dateTime={toIso(message.createdAt)}>{formatTime(message.createdAt)}</time>
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
              aria-pressed={selected}
              aria-label={`${selected ? "Deselect" : "Select"} message from ${message.authorDisplayName}`}
              onClick={onToggle}
            >
              Select
            </button>
            <button type="button" aria-label={`Copy message from ${message.authorDisplayName}`} onClick={onCopy}>
              Copy
            </button>
            {canEdit
              ? (
                <button type="button" aria-label={`Edit message from ${message.authorDisplayName}`} onClick={onEdit}>
                  Edit
                </button>
              )
              : null}
            {canDelete
              ? (
                <button type="button" aria-label={`Delete message from ${message.authorDisplayName}`} onClick={onDelete}>
                  Delete
                </button>
              )
              : null}
            <button
              type="button"
              aria-label={`More actions for message from ${message.authorDisplayName}`}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                const x = Math.max(MESSAGE_CONTEXT_MENU_OFFSET, rect.right - MESSAGE_CONTEXT_MENU_WIDTH)
                onOpenMenu(x, rect.bottom + MESSAGE_CONTEXT_MENU_OFFSET)
              }}
            >
              More
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
  readonly onDraftChange: (draft: string) => void
  readonly onSend: () => void
}) {
  const { channelName, draft, onDraftChange, onSend } = props
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    resizeTextarea(textareaRef.current, COMPOSER_MIN_HEIGHT, COMPOSER_MAX_HEIGHT)
  }, [draft])

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSend()
  }

  return (
    <div className="composerDock">
      <form className="composer" onSubmit={onSubmit} aria-label="Channel message composer">
        <button type="button" className="composerAddButton" aria-label="Add attachment">+</button>
        <label className="srOnly" htmlFor="channel-message">Message</label>
        <textarea
          ref={textareaRef}
          id="channel-message"
          rows={1}
          value={draft}
          placeholder={`Message #${channelName}`}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              onSend()
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
}) {
  const { members, currentUserId } = props
  return (
    <aside className="membersPanel" aria-label="Channel members">
      <div className="membersContent">
        <p className="memberGroupLabel">Online -- {members.length}</p>
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
      </div>
    </aside>
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
        {selected ? "Deselect" : "Select"}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onCopy()
          onClose()
        }}
      >
        Copy message
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
            Edit message
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
            Delete message
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

const createChannelViewModel = (
  model: CollabSnapshot,
  selectedMessageIds: ReadonlyArray<ChannelMessageId>,
  messageMenu: MessageMenuState
): ChannelViewModel => {
  const liveMessages = model.channelMessages.filter(isLiveMessage)
  const liveMessageIds = new Set(liveMessages.map((message) => message.id))
  const visibleSelectedMessageIds = selectedMessageIds.filter((id) => liveMessageIds.has(id))
  const selectedMessageIdSet = new Set(visibleSelectedMessageIds)
  const topSelectedMessageId = liveMessages.find((message) => selectedMessageIdSet.has(message.id))?.id ?? null

  return {
    selectedMessageIds: visibleSelectedMessageIds,
    selectedMessageIdSet,
    members: uniqueMembers(model.channelMessages),
    channelIndicator: getChannelIndicator(liveMessages, model.currentUser.id, model.currentUser.displayName),
    topSelectedMessageId,
    menuMessage: messageMenu === null
      ? null
      : liveMessages.find((message) => message.id === messageMenu.messageId) ?? null
  }
}

const isLiveMessage = (message: ChannelMessage): boolean => message.deletedAt === null

const toggleMessageId = (
  messageIds: ReadonlyArray<ChannelMessageId>,
  messageId: ChannelMessageId
): ReadonlyArray<ChannelMessageId> =>
  messageIds.includes(messageId)
    ? messageIds.filter((id) => id !== messageId)
    : [...messageIds, messageId]

const pruneSelectedMessageIds = (
  selectedMessageIds: ReadonlyArray<ChannelMessageId>,
  messages: ReadonlyArray<ChannelMessage>
): ReadonlyArray<ChannelMessageId> => {
  if (selectedMessageIds.length === 0) return selectedMessageIds
  const liveMessageIds = new Set(messages.filter(isLiveMessage).map((message) => message.id))
  const nextSelectedMessageIds = selectedMessageIds.filter((id) => liveMessageIds.has(id))
  return nextSelectedMessageIds.length === selectedMessageIds.length
    ? selectedMessageIds
    : nextSelectedMessageIds
}

const uniqueMembers = (messages: ReadonlyArray<ChannelMessage>): ReadonlyArray<ChannelMember> => {
  const members = new Map<string, ChannelMember>()
  messages.forEach((message) => {
    members.set(message.authorId, { id: message.authorId, displayName: message.authorDisplayName })
  })
  return Array.from(members.values())
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

const formatTime = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp))

const toIso = (timestamp: number): string => new Date(timestamp).toISOString()

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
