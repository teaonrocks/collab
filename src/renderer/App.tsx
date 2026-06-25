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
  SendHorizontal,
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
import { cn } from "./lib/cn"
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  Textarea
} from "./ui"

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
const chatTimelineClassName =
  "chatTimeline flex min-h-0 list-none flex-col gap-0.5 overflow-auto px-4 pb-[18px] pt-3.5 [--chat-timeline-x:16px] [--message-avatar-column:40px] [--message-column-gap:10px] [--message-group-x:10px] [--message-row-left-bleed:calc(var(--chat-timeline-x)+var(--message-group-x)+var(--message-avatar-column)+var(--message-column-gap))] [--message-row-right-bleed:calc(var(--chat-timeline-x)+var(--message-group-x))]"
const channelMessageGroupClassName =
  "channelMessageGroup grid min-w-0 grid-cols-[var(--message-avatar-column)_minmax(0,1fr)] items-start justify-start gap-[var(--message-column-gap)] px-[var(--message-group-x)]"
const channelMessageClassName =
  "channelMessage group/message relative grid min-w-0 w-[calc(100%+var(--message-row-left-bleed)+var(--message-row-right-bleed))] -ml-[var(--message-row-left-bleed)] grid-cols-[minmax(0,1fr)] items-start justify-start gap-2.5 border border-transparent bg-transparent py-2 pl-[var(--message-row-left-bleed)] pr-[var(--message-row-right-bleed)] hover:bg-surface-muted focus-within:bg-surface-muted"
const messageContentClassName =
  "messageContent min-w-0 max-w-[820px]"
const messageBodyClassName =
  "mb-0 mt-[3px] text-sm leading-[1.42] text-foreground [overflow-wrap:anywhere]"
const messageActionButtonClassName =
  "size-[34px] min-h-[30px] rounded-none border-0 border-l border-surface-rail bg-surface-raised text-foreground-muted first:border-l-0 hover:bg-surface-muted hover:text-foreground"
const loadingShellClassName =
  "loadingShell grid min-h-screen w-full place-items-center overflow-hidden bg-surface-canvas p-6 font-sans text-foreground"
const appShellClassName =
  "appShell grid h-full min-h-0 w-full overflow-hidden bg-surface-canvas font-sans text-foreground [grid-template-areas:'rail_sidebar_header_header'_'rail_sidebar_chat_members'] [grid-template-columns:56px_minmax(200px,236px)_minmax(360px,1fr)_minmax(280px,320px)] [grid-template-rows:56px_minmax(0,1fr)] [&_*]:box-border max-[920px]:[grid-template-areas:'rail_header'_'rail_chat'] max-[920px]:[grid-template-columns:56px_minmax(0,1fr)]"
const appShellMembersCollapsedClassName =
  "membersCollapsed [grid-template-areas:'rail_sidebar_header'_'rail_sidebar_chat'] [grid-template-columns:56px_minmax(200px,236px)_minmax(360px,1fr)] max-[920px]:[grid-template-areas:'rail_header'_'rail_chat'] max-[920px]:[grid-template-columns:56px_minmax(0,1fr)]"
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

export function App() {
  const snapshot = useAtomValue(atoms.snapshot)
  const createChannelMessage = useAtomSet(atoms.createChannelMessage, { mode: "promise" })
  const deleteChannelMessage = useAtomSet(atoms.deleteChannelMessage, { mode: "promise" })

  return Result.builder(snapshot)
    .onInitial(() => <main className={loadingShellClassName}><p>Loading...</p></main>)
    .onFailure((cause) => (
      <main className={loadingShellClassName}>
        <p className="errorText max-w-[min(720px,calc(100vw-48px))] [overflow-wrap:anywhere] text-destructive-text">
          {Cause.pretty(cause)}
        </p>
      </main>
    ))
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
    <main className={classNames(appShellClassName, !membersOpen && appShellMembersCollapsedClassName)}>
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
        open={membersOpen}
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
        {members.map((member) => (
          <button
            key={member.id}
            type="button"
            className={classNames(railItemClassName, "dmRailItem rounded-full hover:bg-surface-canvas hover:outline-2 hover:outline-border focus-visible:bg-surface-canvas focus-visible:outline-2 focus-visible:outline-border")}
            aria-label={member.displayName}
          >
            {initials(member.displayName)}
            <span className={railTooltipClassName} role="tooltip">{member.displayName}</span>
          </button>
        ))}
      </nav>
      <div className="railSpacer flex-1" />
      <div className="railProfile relative">
        <button
          type="button"
          className="railUser grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-surface-muted p-0 text-[11px] font-extrabold text-foreground disabled:cursor-default"
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
            <div className="profileMenu absolute bottom-0 left-[calc(100%+10px)] z-40 w-[180px] overflow-hidden rounded-panel border border-border-strong bg-surface-canvas shadow-popover" role="menu" aria-label="Profile settings" onClick={(event) => event.stopPropagation()}>
              <div className="profileMenuHeader border-b border-surface-rail p-2.5">
                <strong className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] leading-tight text-foreground">{currentUserName}</strong>
              </div>
              {profileMenuActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  className="min-h-9 w-full border-0 bg-surface-canvas px-2.5 text-left font-[inherit] text-[13px] font-bold text-foreground hover:bg-surface-muted focus-visible:bg-surface-muted"
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
              <Plus className="buttonIcon" aria-hidden="true" />
            </button>
          </div>
          {channels.map((channel) => {
            const active = channel.id === activeChannelId
            return (
              <button
                key={channel.id}
                type="button"
                className={classNames(channelNavItemClassName, active && "active bg-surface-rail")}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (!active) onSelectChannel?.(channel.id)
                }}
              >
                <span className="channelNavMain min-w-0 flex flex-col gap-[3px]">
                  <span className="channelNavName flex min-w-0 items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap font-bold">
                    <ChannelGlyph visibility={channel.visibility} />
                    <span className="channelNavText min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{channel.name}</span>
                  </span>
                </span>
                {active && channelIndicator !== null
                  ? (
                    <span
                      className={classNames(
                        "channelIndicator size-2 shrink-0 rounded-full",
                        channelIndicator === "mentioned" ? "mentioned bg-signal-mentioned" : "unread bg-signal-unread"
                      )}
                      aria-label={channelIndicator === "mentioned" ? "Mentioned" : "Unread messages"}
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

  const handleOpenChange = (open: boolean) => {
    if (!open) onCancel()
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="channelCreateDialog max-w-[380px]">
        <DialogTitle id="create-channel-title">Create Channel</DialogTitle>
        <DialogDescription id="create-channel-description" className="srOnly">
          Name the channel to add it to this workspace.
        </DialogDescription>
        <form className="mt-3 flex flex-col gap-2.5" aria-label="Create channel" onSubmit={onSubmit}>
          <label className="text-[13px] font-bold text-foreground-muted" htmlFor="new-channel-name">
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
            onChange={(event) => onDraftChange(event.target.value)}
          />
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
            <Button type="submit" size="sm" disabled={draft.trim().length === 0 || saving}>
              {saving ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ChannelGlyph(props: { readonly visibility?: Channel["visibility"] }) {
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
  readonly membersOpen: boolean
  readonly onToggleMembers: () => void
}) {
  const { channelName, membersOpen, onToggleMembers } = props
  const membersToggleLabel = membersOpen ? "Hide members" : "Show members"
  return (
    <header className="chatHeader flex min-h-0 min-w-0 items-center justify-between gap-3 border-b border-border bg-surface-canvas px-4 py-2 [grid-area:header]">
      <div className="channelTitle flex min-w-0 items-center gap-2">
        <Hash className="channelHashIcon buttonIcon shrink-0 text-foreground-subtle" aria-hidden="true" />
        <h2 className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-lg leading-tight tracking-normal text-foreground">{channelName}</h2>
      </div>
      <div className="chatHeaderActions flex items-center justify-end gap-2 text-xs text-foreground-subtle" aria-label="Channel actions">
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
    <section className="chatPane grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] bg-surface-canvas [grid-area:chat]" aria-label={`${channelName} chat`}>
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
                <Hash className="channelHashIcon buttonIcon" aria-hidden="true" />
                <span>{channelName}.</span>
              </span>
            </li>
          )
          : null}
        {!loading && messageGroups.map((group) => (
          <li key={group.id} className={channelMessageGroupClassName}>
            <Avatar
              name={group.authorDisplayName}
              className="messageAvatar messageRunAvatar sticky top-3.5 z-10 mt-2"
              aria-hidden="true"
            />
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
        <li
          key={index}
          className="channelMessageSkeleton grid min-w-0 grid-cols-[40px_minmax(0,760px)] items-start gap-2.5 px-2.5 py-2"
          aria-hidden="true"
        >
          <span className="skeletonAvatar" />
          <span className="skeletonMessageContent flex min-w-0 flex-col gap-2 pt-[3px]">
            <span className="skeletonLine meta h-3 w-[min(220px,45%)]" />
            <span
              className={classNames(
                "skeletonLine body h-3.5 w-[min(680px,88%)]",
                index % 3 === 0 && "short w-[min(420px,58%)]",
                index % 3 === 1 && "medium w-[min(560px,72%)]"
              )}
            />
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
    channelMessageClassName,
    !startsAuthorRun && "compact",
    deleted && "deleted text-foreground-placeholder",
    editing && "editing bg-surface-muted",
    selected && "selected border-border bg-surface-muted",
    selectionMode && !deleted && "selecting grid-cols-[20px_minmax(0,1fr)] cursor-pointer"
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
            className="messageCheckbox mt-2.5 size-4 cursor-pointer accent-foreground-subtle"
            type="checkbox"
            checked={selected}
            aria-label={`${selected ? "Deselect" : "Select"} message from ${message.authorDisplayName}`}
            onChange={onToggle}
            onClick={(event) => event.stopPropagation()}
          />
        )
        : null}
      <div className={messageContentClassName}>
        <div
          className={classNames(
            "messageMeta flex min-w-0 items-baseline gap-2",
            !startsAuthorRun && "pointer-events-none absolute left-[calc(var(--chat-timeline-x)+var(--message-group-x))] top-2.5 w-[var(--message-avatar-column)] justify-center"
          )}
        >
          {startsAuthorRun
            ? <strong className="min-w-0 text-sm font-bold text-foreground [overflow-wrap:anywhere]">{message.authorDisplayName}</strong>
            : null}
          <time
            className={classNames(
              "messageTimestamp whitespace-nowrap text-xs text-foreground-subtle",
              !startsAuthorRun && "hidden [display:inline] opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100"
            )}
            dateTime={toIso(message.createdAt)}
          >
            {formatTime(message.createdAt)}
          </time>
          {message.editedAt === null || !startsAuthorRun
            ? null
            : <span className="messageEdited whitespace-nowrap text-xs text-foreground-subtle" title={`Edited ${formatTime(message.editedAt)}`}>edited</span>}
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
          : <p className={classNames(messageBodyClassName, deleted && "text-foreground-placeholder italic")}>{deleted ? "Message deleted" : message.body}</p>}
      </div>
      {message.editedAt === null || startsAuthorRun
        ? null
        : (
          <span
            className="messageEdited compactEdited absolute right-[var(--message-row-right-bleed)] top-2.5 whitespace-nowrap text-xs text-foreground-subtle"
            title={`Edited ${formatTime(message.editedAt)}`}
          >
            edited
          </span>
        )}
      {deleted || editing || !actionsAvailable
        ? null
        : (
          <div
            className={classNames(
              "messageActions pointer-events-none absolute right-3 top-[-14px] z-10 flex overflow-hidden rounded-panel border border-border-strong bg-surface-raised opacity-0 shadow-floating group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100",
              actionsPinned && "visible pointer-events-auto opacity-100"
            )}
            aria-label={`Message actions for ${message.authorDisplayName}`}
            onClick={(event) => event.stopPropagation()}
          >
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
              <Ellipsis className="buttonIcon" aria-hidden="true" />
            </Button>
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
  readonly onDraftChange: (draft: string) => void
  readonly onSend: () => void
}) {
  const { channelName, draft, operationError, disabled, onDraftChange, onSend } = props
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const canSend = draft.trim().length > 0 && !disabled

  useEffect(() => {
    resizeTextarea(textareaRef.current, COMPOSER_MIN_HEIGHT, COMPOSER_MAX_HEIGHT)
  }, [draft])

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled) return
    onSend()
  }

  return (
    <div className="composerDock border-t border-border bg-surface-canvas px-4 pb-3 pt-2.5">
      {operationError === null
        ? null
        : <p className="composerError mb-2 mt-0 text-[13px] leading-[1.35] text-destructive-text" role="status">{operationError}</p>}
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
          disabled={disabled}
        >
          <Paperclip className="buttonIcon" aria-hidden="true" />
        </Button>
        <label className="srOnly" htmlFor="channel-message">Message</label>
        <Textarea
          ref={textareaRef}
          id="channel-message"
          rows={1}
          value={draft}
          disabled={disabled}
          className="h-[22px] min-h-[22px] max-h-[140px] resize-none overflow-hidden rounded-none border-0 bg-surface-canvas px-3 py-0 text-sm leading-[1.42] focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0 disabled:bg-surface-sunken"
          placeholder={`Message ${channelName}`}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              if (!disabled) onSend()
            }
          }}
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          className="h-full min-h-11 w-11 rounded-none border-0 border-l border-border text-foreground-muted hover:bg-surface-muted hover:text-foreground"
          aria-label="Send message"
          disabled={!canSend}
        >
          <SendHorizontal className="buttonIcon" aria-hidden="true" />
        </Button>
      </form>
    </div>
  )
}

function MembersPanel(props: {
  readonly members: ReadonlyArray<ChannelMember>
  readonly currentUserId: string
  readonly loading: boolean
  readonly open: boolean
}) {
  const { members, currentUserId, loading, open } = props
  return (
    <aside className={classNames("membersPanel h-full min-h-0 min-w-0 overflow-hidden border-l border-border bg-surface-canvas [grid-area:members] max-[920px]:hidden", !open && "hidden")} aria-label="Channel members">
      <div className="membersContent flex h-full min-h-0 flex-col gap-2.5 overflow-auto p-3.5" aria-busy={loading}>
        <p className="m-0 text-xs font-bold leading-tight text-foreground-subtle">Online -- {loading ? "" : members.length}</p>
        {loading
          ? <MembersSkeleton />
          : (
            <ol className={memberListClassName}>
              {members.map((member) => (
                <li key={member.id} className={memberItemClassName}>
                  <Avatar name={member.displayName} aria-hidden="true" />
                  <div className="min-w-0">
                    <strong className={memberNameClassName}>{member.displayName}</strong>
                    <span className={memberRoleClassName}>{member.id === currentUserId ? "You" : "Member"}</span>
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
        <SelectIcon className="buttonIcon" aria-hidden="true" />
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
        <Copy className="buttonIcon" aria-hidden="true" />
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
            <Pencil className="buttonIcon" aria-hidden="true" />
            <span>Edit message</span>
          </Button>
        )
        : null}
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
            <Trash2 className="buttonIcon" aria-hidden="true" />
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

const classNames = cn
