import { Check, Plus } from "lucide-react"
import { Fragment, useEffect, useRef, useState } from "react"
import type {
  ChatChannelId,
  ChatChannelIndicator,
  ChatChannelMember,
  ChatDataView,
  ChatDirectConversation,
  ChatDirectMessageProfile,
  ChatIncomingFriendRequest
} from "../chat-data"
import { cn } from "../lib/cn"
import { initials } from "../lib/initials"
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Input,
  Radio,
  RadioGroup,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../ui"

type DirectMessageCapabilities = NonNullable<ChatDataView["directMessages"]>

export type ProfileMenuAction = {
  readonly id?: string
  readonly label: string
  readonly detail?: string
  readonly selected?: boolean
  readonly separatorBefore?: boolean
  readonly tone?: "default" | "destructive"
  readonly onSelect: () => void
}

const iconClassName = "size-4 [stroke-width:2]"
const railItemClassName =
  "group/rail relative grid size-9 cursor-pointer place-items-center rounded-card border-0 bg-surface-muted text-[13px] font-extrabold text-foreground transition-colors hover:bg-surface-muted-hover active:bg-surface-rail"
const selectedRailItemClassName =
  "active bg-surface-canvas outline-2 outline-border hover:bg-surface-canvas active:bg-surface-muted"

const directConversationIndicatorDescription = (indicator: ChatChannelIndicator, recipientName: string): string =>
  indicator === "mentioned"
    ? `Mention in direct message with ${recipientName} since you last opened it.`
    : `Unread direct messages with ${recipientName} since you last opened it.`

const directConversationButtonLabel = (recipientName: string, indicator: ChatChannelIndicator | undefined): string =>
  indicator === undefined
    ? recipientName
    : `${recipientName}, ${directConversationIndicatorDescription(indicator, recipientName)}`

export function WorkspaceRail(props: {
  readonly workspaceName: string
  readonly workspaceActive: boolean
  readonly currentUserName: string
  readonly conversations: ReadonlyArray<ChatDirectConversation>
  readonly indicators: ReadonlyMap<ChatChannelId, ChatChannelIndicator>
  readonly activeConversationId: ChatChannelId | null
  readonly onSelectWorkspace: () => void
  readonly onSelectConversation?: ChatDataView["navigation"]["selectDirectConversation"]
  readonly conversationsLoading: boolean
  readonly onStartConversation?: DirectMessageCapabilities["startConversation"]
  readonly onSearchConversationCandidates?: DirectMessageCapabilities["searchCandidates"]
  readonly onSendFriendRequest?: DirectMessageCapabilities["sendFriendRequest"] | undefined
  readonly profileMenuActions: ReadonlyArray<ProfileMenuAction>
}) {
  const {
    workspaceName,
    workspaceActive,
    currentUserName,
    conversations,
    indicators,
    activeConversationId,
    onSelectWorkspace,
    onSelectConversation,
    conversationsLoading,
    onStartConversation,
    onSearchConversationCandidates,
    onSendFriendRequest,
    profileMenuActions
  } = props
  const hasProfileActions = profileMenuActions.length > 0
  const [startOpen, setStartOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const profileButtonRef = useRef<HTMLButtonElement>(null)
  return (
    <aside
      className="workspaceRail flex h-full min-h-0 min-w-0 flex-col items-center gap-3 border-r border-border bg-surface-rail px-2 py-3 [grid-area:rail]"
      aria-label="Global navigation"
    >
      <nav className="railGroup flex w-full flex-col items-center gap-2" aria-label="Workspaces">
        <Tooltip>
          <TooltipTrigger
            render={<Button variant={null} size="icon" />}
            className={cn(
              railItemClassName,
              workspaceActive && selectedRailItemClassName,
              workspaceActive &&
                "before:absolute before:-left-2 before:h-6 before:w-[3px] before:rounded-r-[3px] before:bg-foreground"
            )}
            aria-label={workspaceName}
            aria-current={workspaceActive ? "page" : undefined}
            onClick={onSelectWorkspace}
          >
            {initials(workspaceName)}
          </TooltipTrigger>
          <TooltipContent side="right">{workspaceName}</TooltipContent>
        </Tooltip>
      </nav>
      <div className="railDivider h-px w-8 shrink-0 bg-border-strong" role="separator" aria-label="Direct messages" />
      <nav className="railGroup flex w-full flex-col items-center gap-2" aria-label="Direct messages">
        {onStartConversation === undefined || onSearchConversationCandidates === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              ref={addButtonRef}
              render={<Button variant={null} size="icon" />}
              className={cn(railItemClassName, "rounded-full text-foreground-muted")}
              aria-label="Start direct message"
              onClick={() => setStartOpen(true)}
            >
              <Plus className={iconClassName} aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="right">Start direct message</TooltipContent>
          </Tooltip>
        )}
        {conversationsLoading && conversations.length === 0 ? (
          <span className="sr-only" role="status">
            Loading direct messages...
          </span>
        ) : conversations.length === 0 ? (
          <span className="sr-only">No direct messages yet.</span>
        ) : null}
        {conversations.map((conversation) => {
          const indicator = conversation.id === activeConversationId ? undefined : indicators.get(conversation.id)
          const indicatorDescription =
            indicator === undefined
              ? undefined
              : directConversationIndicatorDescription(indicator, conversation.otherUser.displayName)
          return (
            <Tooltip key={conversation.id}>
              <TooltipTrigger
                render={<Button variant={null} size="icon" />}
                className={cn(
                  railItemClassName,
                  "dmRailItem rounded-full",
                  conversation.id === activeConversationId && selectedRailItemClassName
                )}
                aria-label={directConversationButtonLabel(conversation.otherUser.displayName, indicator)}
                aria-current={conversation.id === activeConversationId ? "page" : undefined}
                onClick={() => onSelectConversation?.(conversation.id)}
              >
                {initials(conversation.otherUser.displayName)}
                {indicator === undefined ? null : (
                  <span
                    className={cn(
                      "absolute top-0 right-0 size-2 rounded-full",
                      indicator === "mentioned" ? "bg-signal-mentioned" : "bg-signal-unread"
                    )}
                    title={indicatorDescription}
                  />
                )}
              </TooltipTrigger>
              <TooltipContent side="right">{conversation.otherUser.displayName}</TooltipContent>
            </Tooltip>
          )
        })}
      </nav>
      <div className="railSpacer flex-1" />
      <DropdownMenu open={profileOpen} onOpenChange={setProfileOpen} modal={false}>
        <Button
          ref={profileButtonRef}
          type="button"
          variant={null}
          size="icon"
          className={cn(
            railItemClassName,
            "railProfile railUser size-8 rounded-full p-0 text-[11px] disabled:cursor-default",
            profileOpen && selectedRailItemClassName
          )}
          title={currentUserName}
          aria-label={hasProfileActions ? `Profile menu for ${currentUserName}` : currentUserName}
          aria-haspopup={hasProfileActions ? "menu" : undefined}
          aria-expanded={hasProfileActions ? profileOpen : undefined}
          disabled={!hasProfileActions}
          onClick={() => setProfileOpen((open) => !open)}
        >
          {initials(currentUserName)}
        </Button>
        <DropdownMenuContent
          sideOffset={10}
          side="right"
          align="end"
          anchor={profileButtonRef}
          finalFocus={profileButtonRef}
          className="profileMenu flex max-h-[calc(100dvh-24px)] w-[248px] flex-col p-0"
          aria-label="Profile settings"
        >
          <DropdownMenuGroup className="flex min-h-0 flex-1 flex-col" aria-label="Accounts and profile actions">
            <DropdownMenuLabel className="profileMenuHeader shrink-0 border-b border-surface-rail p-2.5">
              <strong className="block min-w-0 overflow-hidden text-[13px] leading-tight text-ellipsis whitespace-nowrap text-foreground">
                {currentUserName}
              </strong>
            </DropdownMenuLabel>
            <div className="profileMenuActions min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {profileMenuActions.map((action) => (
                <Fragment key={action.id ?? action.label}>
                  {action.separatorBefore ? <DropdownMenuSeparator className="m-0" /> : null}
                  <DropdownMenuItem
                    className={cn(
                      "relative grid min-h-9 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-1.5 rounded-none bg-surface-canvas px-2.5 py-2 text-left text-[13px] text-foreground",
                      action.tone === "destructive" && "text-destructive-text"
                    )}
                    onClick={action.onSelect}
                  >
                    <span className="grid size-[18px] place-items-center" aria-hidden="true">
                      {action.selected === true ? <Check className="size-3.5 [stroke-width:2.25]" /> : null}
                    </span>
                    <span className="min-w-0">
                      <strong className="block overflow-hidden text-[13px] leading-tight text-ellipsis whitespace-nowrap">
                        {action.label}
                      </strong>
                      {action.detail === undefined ? null : (
                        <span className="mt-0.5 block overflow-hidden text-[11px] leading-tight font-normal text-ellipsis whitespace-nowrap text-foreground-subtle">
                          {action.detail}
                        </span>
                      )}
                    </span>
                  </DropdownMenuItem>
                </Fragment>
              ))}
            </div>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {startOpen && onStartConversation !== undefined && onSearchConversationCandidates !== undefined ? (
        <StartDirectMessageDialog
          onStart={onStartConversation}
          onSearch={onSearchConversationCandidates}
          onSendFriendRequest={onSendFriendRequest}
          onClose={() => {
            setStartOpen(false)
            window.setTimeout(() => addButtonRef.current?.focus(), 0)
          }}
        />
      ) : null}
    </aside>
  )
}

export function DirectMessageSettingsDialog(props: {
  readonly profile: ChatDirectMessageProfile
  readonly incomingFriendRequests: ReadonlyArray<ChatIncomingFriendRequest>
  readonly onSave: NonNullable<DirectMessageCapabilities["updateProfile"]>
  readonly onRespondToFriendRequest?: DirectMessageCapabilities["respondToFriendRequest"] | undefined
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-[420px]">
        <DialogTitle>DM settings</DialogTitle>
        <DialogDescription>
          Set the username people use to find you and who can start a new direct message.
        </DialogDescription>
        <div className="mt-4 grid gap-4">
          <label className="grid gap-1.5 text-sm font-bold text-foreground" htmlFor="dm-username">
            Username
            <Input
              id="dm-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={saving}
              autoCapitalize="none"
            />
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-bold text-foreground">Who can start a new DM</legend>
            <RadioGroup
              name="dm-preference"
              value={preference}
              disabled={saving}
              onValueChange={(value) => setPreference(value)}
            >
              {(
                [
                  ["all", "Anyone on Aether"],
                  ["mutuals", "People who share a workspace with you"],
                  ["friends", "Accepted friends only"]
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm text-foreground">
                  <Radio value={value} />
                  {label}
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          {incomingFriendRequests.length === 0 ? null : (
            <section className="grid gap-2" aria-label="Friend requests">
              <h3 className="m-0 text-sm font-bold text-foreground">Friend requests</h3>
              {incomingFriendRequests.map((request) => (
                <div key={request.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                    <strong>{request.requester.displayName}</strong>{" "}
                    <span className="text-foreground-subtle">@{request.requester.username}</span>
                  </span>
                  <Button
                    size="sm"
                    disabled={saving || onRespondToFriendRequest === undefined}
                    onClick={() => void onRespondToFriendRequest?.({ friendRequestId: request.id, accept: true })}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={saving || onRespondToFriendRequest === undefined}
                    onClick={() => void onRespondToFriendRequest?.({ friendRequestId: request.id, accept: false })}
                  >
                    Decline
                  </Button>
                </div>
              ))}
            </section>
          )}
          {error === null ? null : (
            <p className="m-0 text-sm text-destructive-text" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StartDirectMessageDialog(props: {
  readonly onStart: NonNullable<DirectMessageCapabilities["startConversation"]>
  readonly onSearch: NonNullable<DirectMessageCapabilities["searchCandidates"]>
  readonly onSendFriendRequest?: DirectMessageCapabilities["sendFriendRequest"] | undefined
  readonly onClose: () => void
}) {
  const { onStart, onSearch, onSendFriendRequest, onClose } = props
  const search = useConversationSearchController({ onStart, onSearch, onSendFriendRequest, onClose })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="directMessageDialog max-w-[420px]">
        <DialogTitle>Start Direct Message</DialogTitle>
        <DialogDescription className="sr-only">
          Search Aether accounts by username, open a direct conversation, or send a friend request.
        </DialogDescription>
        <div className="mt-3 flex flex-col gap-2">
          <label className="sr-only" htmlFor="direct-message-member-search">
            Search usernames
          </label>
          <Input
            ref={inputRef}
            id="direct-message-member-search"
            type="search"
            value={search.query}
            placeholder="Search usernames"
            disabled={search.pendingUserId !== null}
            onChange={(event) => search.setQuery(event.target.value)}
          />
          <div
            className="max-h-60 overflow-y-auto rounded-control border border-border bg-surface-canvas p-1"
            aria-label="Aether accounts"
          >
            {search.query.trim().length === 0 ? (
              <p className="m-0 px-2 py-3 text-sm text-foreground-subtle">Search for a username to begin.</p>
            ) : search.results === undefined ? (
              <p className="m-0 px-2 py-3 text-sm text-foreground-subtle" role="status">
                Loading accounts...
              </p>
            ) : search.results.length === 0 ? (
              <p className="m-0 px-2 py-3 text-sm text-foreground-subtle">No accounts are available.</p>
            ) : (
              search.results.map((candidate) => (
                <div
                  key={candidate.id}
                  className="flex min-h-10 items-center gap-2 rounded-control px-2 text-sm text-foreground hover:bg-surface-muted"
                >
                  <Avatar name={candidate.displayName} aria-hidden="true" className="size-8" />
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                    <strong className="block">{candidate.displayName}</strong>
                    <span className="text-xs text-foreground-subtle">@{candidate.username}</span>
                  </span>
                  {search.pendingUserId === candidate.id ? (
                    <span className="text-xs text-foreground-subtle">Working...</span>
                  ) : candidate.canStartDirectMessage !== false ? (
                    <Button size="sm" aria-label={candidate.displayName} onClick={() => search.start(candidate)}>
                      Message
                    </Button>
                  ) : candidate.friendRequestDirection === "outgoing" ? (
                    <span className="text-xs text-foreground-subtle">Request sent</span>
                  ) : candidate.friendship === "accepted" ? (
                    <span className="text-xs text-foreground-subtle">Friends · DM restricted</span>
                  ) : onSendFriendRequest === undefined ? (
                    <span className="text-xs text-foreground-subtle">DM restricted</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={
                        candidate.friendRequestDirection === "incoming"
                          ? `Accept friend request from ${candidate.displayName}`
                          : undefined
                      }
                      onClick={() => search.sendFriendRequest(candidate)}
                    >
                      {candidate.friendRequestDirection === "incoming" ? "Accept request" : "Add friend"}
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
          {search.error === null ? null : (
            <p className="m-0 text-sm text-destructive-text" role="alert">
              {search.error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function useConversationSearchController(props: {
  readonly onStart: NonNullable<DirectMessageCapabilities["startConversation"]>
  readonly onSearch: NonNullable<DirectMessageCapabilities["searchCandidates"]>
  readonly onSendFriendRequest?: DirectMessageCapabilities["sendFriendRequest"] | undefined
  readonly onClose: () => void
}) {
  const { onStart, onSearch, onSendFriendRequest, onClose } = props
  const [state, setState] = useState({
    query: "",
    results: [] as ReadonlyArray<ChatChannelMember> | undefined,
    pendingUserId: null as string | null,
    error: null as string | null
  })
  const pendingRef = useRef(false)

  useEffect(() => {
    const query = state.query.trim()
    if (query.length === 0) {
      setState((current) => ({ ...current, results: [] }))
      return
    }
    let cancelled = false
    void onSearch(query)
      .then((results) => {
        if (!cancelled) setState((current) => ({ ...current, results }))
      })
      .catch(() => {
        if (!cancelled) setState((current) => ({ ...current, results: [] }))
      })
    return () => {
      cancelled = true
    }
  }, [onSearch, state.query])

  const finish = (error: string | null) => {
    pendingRef.current = false
    setState((current) => ({ ...current, pendingUserId: null, error }))
  }

  return {
    ...state,
    setQuery: (query: string) =>
      setState((current) => ({
        ...current,
        query,
        results: query.trim().length === 0 ? [] : undefined
      })),
    start: (candidate: ChatChannelMember) => {
      if (pendingRef.current) return
      pendingRef.current = true
      setState((current) => ({ ...current, pendingUserId: candidate.id, error: null }))
      void onStart(candidate.id)
        .then(onClose)
        .catch(() => finish("Could not open this direct message. Check your connection and try again."))
    },
    sendFriendRequest: (candidate: ChatChannelMember) => {
      if (pendingRef.current || onSendFriendRequest === undefined) return
      pendingRef.current = true
      setState((current) => ({ ...current, pendingUserId: candidate.id, error: null }))
      void onSendFriendRequest(candidate.id)
        .then(() => {
          pendingRef.current = false
          const query = state.query.trim()
          setState((current) => ({ ...current, pendingUserId: null, results: undefined }))
          if (query.length === 0) return
          void onSearch(query)
            .then((results) =>
              setState((current) => (current.query.trim() === query ? { ...current, results } : current))
            )
            .catch(() =>
              setState((current) => (current.query.trim() === query ? { ...current, results: [] } : current))
            )
        })
        .catch(() => finish("Could not send the friend request. Check your connection and try again."))
    }
  } as const
}
