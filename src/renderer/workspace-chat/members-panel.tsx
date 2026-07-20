import { UserMinus, UserRoundCog } from "lucide-react"
import { useState } from "react"
import type { ChatChannel, ChatChannelInviteCandidate, ChatChannelMember, ChatDataView } from "../chat-data"
import { cn } from "../lib/cn"
import { Avatar, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../ui"

type ChannelCapabilities = NonNullable<ChatDataView["channels"]>

const memberListClassName = "memberList m-0 flex list-none flex-col gap-2 p-0"
const memberItemClassName = "grid min-w-0 grid-cols-[36px_minmax(0,1fr)] items-center gap-2.5"
const memberNameClassName =
  "block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold text-foreground"
const memberRoleClassName =
  "mt-0.5 block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-foreground-subtle"
const skeletonBlockClassName =
  "block overflow-hidden rounded-panel bg-[linear-gradient(90deg,var(--aether-color-surface-muted-hover)_0%,var(--aether-color-surface-shimmer)_48%,var(--aether-color-surface-muted-hover)_100%)] bg-[length:220%_100%] motion-safe:animate-[skeletonPulse_1.15s_ease-in-out_infinite]"

export function MembersPanel(props: {
  readonly channel: ChatChannel
  readonly members: ReadonlyArray<ChatChannelMember>
  readonly inviteCandidates?: ReadonlyArray<ChatChannelInviteCandidate> | undefined
  readonly currentUserId: string
  readonly loading: boolean
  readonly open: boolean
  readonly addChannelMember?: ChannelCapabilities["addMember"] | undefined
  readonly removeChannelMember?: ChannelCapabilities["removeMember"] | undefined
}) {
  const { channel, members, inviteCandidates, currentUserId, loading, open, addChannelMember, removeChannelMember } =
    props
  const [managing, setManaging] = useState(false)
  const currentMembership = members.find((member) => member.id === currentUserId)
  const canManage =
    channel.visibility === "private" &&
    currentMembership?.role === "admin" &&
    addChannelMember !== undefined &&
    removeChannelMember !== undefined

  return (
    <>
      <aside
        className={cn(
          "membersPanel h-full min-h-0 min-w-0 overflow-hidden border-l border-border bg-surface-canvas [grid-area:members] max-[920px]:hidden",
          !open && "hidden"
        )}
        aria-label="Channel members"
      >
        <div className="membersContent flex h-full min-h-0 flex-col gap-2.5 overflow-auto p-3.5" aria-busy={loading}>
          <div className="flex min-h-7 items-center justify-between gap-2">
            <p className="m-0 text-xs leading-tight font-bold text-foreground-subtle">
              Online -- {loading ? "" : members.length}
            </p>
            {canManage ? (
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
            ) : null}
          </div>
          {loading ? (
            <MembersSkeleton />
          ) : members.length === 0 ? (
            <p className="m-0 text-[13px] leading-[1.4] text-foreground-muted">No members yet</p>
          ) : (
            <ol className={memberListClassName}>
              {members.map((member) => (
                <li key={member.id} className={memberItemClassName}>
                  <Avatar name={member.displayName} aria-hidden="true" />
                  <div className="min-w-0">
                    <strong className={memberNameClassName}>{member.displayName}</strong>
                    <span className={memberRoleClassName}>
                      {channel.visibility === "private"
                        ? member.role === undefined
                          ? member.id === currentUserId
                            ? "You"
                            : "Member"
                          : `${member.role === "admin" ? "Admin" : member.role === "guest" ? "Guest" : "Member"}${member.id === currentUserId ? " · You" : ""}`
                        : member.id === currentUserId
                          ? "You"
                          : "Member"}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
      {managing && canManage ? (
        <MemberManagementDialog
          channel={channel}
          members={members}
          inviteCandidates={inviteCandidates}
          currentUserId={currentUserId}
          addChannelMember={addChannelMember}
          removeChannelMember={removeChannelMember}
          onClose={() => setManaging(false)}
        />
      ) : null}
    </>
  )
}

function MemberManagementDialog(props: {
  readonly channel: ChatChannel
  readonly members: ReadonlyArray<ChatChannelMember>
  readonly inviteCandidates?: ReadonlyArray<ChatChannelInviteCandidate> | undefined
  readonly currentUserId: string
  readonly addChannelMember: NonNullable<ChannelCapabilities["addMember"]>
  readonly removeChannelMember: NonNullable<ChannelCapabilities["removeMember"]>
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
      .then(() => setPendingRemoval(null))
      .catch(() => setError(`Could not remove ${member.displayName}. Try again.`))
      .finally(() => setPending(null))
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !operationPending) onClose()
      }}
    >
      <DialogContent className="memberManagementDialog max-w-[460px]">
        {pendingRemoval === null ? (
          <>
            <DialogTitle className="sr-only">Manage #{channel.name}</DialogTitle>
            <div className="grid max-h-[min(520px,70vh)] gap-4 overflow-y-auto pr-1">
              <section aria-labelledby="current-channel-members-title">
                <h3
                  id="current-channel-members-title"
                  className="mt-0 mb-2 text-xs font-bold text-foreground-subtle uppercase"
                >
                  Current members
                </h3>
                <ol className="m-0 grid list-none gap-1 p-0">
                  {members.map((member) => {
                    const isLastAdmin = member.role === "admin" && adminCount === 1
                    return (
                      <li
                        key={member.id}
                        className="flex min-h-11 items-center gap-2 border-b border-border py-1.5 last:border-b-0"
                      >
                        <Avatar name={member.displayName} aria-hidden="true" className="size-8" />
                        <span className="min-w-0 flex-1">
                          <strong className="block overflow-hidden text-sm text-ellipsis whitespace-nowrap">
                            {member.displayName}
                          </strong>
                          <span className="block text-xs text-foreground-subtle">
                            {member.role === "admin" ? "Admin" : member.role === "guest" ? "Guest" : "Member"}
                            {member.id === currentUserId ? " · You" : ""}
                          </span>
                        </span>
                        {isLastAdmin ? (
                          <span className="text-xs text-foreground-subtle">Last admin</span>
                        ) : (
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
                <h3
                  id="eligible-channel-members-title"
                  className="mt-0 mb-2 text-xs font-bold text-foreground-subtle uppercase"
                >
                  Eligible invitees
                </h3>
                {inviteCandidates === undefined ? (
                  <p className="m-0 py-2 text-sm text-foreground-subtle" role="status">
                    Loading eligible members...
                  </p>
                ) : inviteCandidates.length === 0 ? (
                  <p className="m-0 py-2 text-sm text-foreground-subtle">No eligible members to add.</p>
                ) : (
                  <ol className="m-0 grid list-none gap-1 p-0">
                    {inviteCandidates.map((candidate) => {
                      const adding = pending?.action === "add" && pending.userId === candidate.id
                      return (
                        <li
                          key={candidate.id}
                          className="flex min-h-11 items-center gap-2 border-b border-border py-1.5 last:border-b-0"
                        >
                          <Avatar name={candidate.displayName} aria-hidden="true" className="size-8" />
                          <strong className="min-w-0 flex-1 overflow-hidden text-sm text-ellipsis whitespace-nowrap">
                            {candidate.displayName}
                          </strong>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={operationPending}
                            onClick={() => runAdd(candidate)}
                          >
                            {adding ? "Adding..." : "Add"}
                          </Button>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </section>
            </div>
            {error === null ? null : (
              <p className="mt-3 mb-0 text-xs text-destructive-text" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="secondary" size="sm" disabled={operationPending} onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogTitle>Remove {pendingRemoval.displayName}?</DialogTitle>
            <DialogDescription>
              {pendingRemoval.id === currentUserId
                ? "Your access ends immediately. You will be moved to an accessible channel."
                : "Their access ends immediately, including this channel's messages and member list."}
            </DialogDescription>
            {error === null ? null : (
              <p className="mt-3 mb-0 text-xs text-destructive-text" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={operationPending}
                onClick={() => {
                  setPendingRemoval(null)
                  setError(null)
                }}
              >
                Cancel
              </Button>
              <Button type="button" variant="danger" size="sm" disabled={operationPending} onClick={confirmRemoval}>
                {operationPending
                  ? "Removing..."
                  : pendingRemoval.id === currentUserId
                    ? "Leave channel"
                    : "Remove member"}
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
          <span className={cn(skeletonBlockClassName, "size-9 rounded-card")} />
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className={cn(skeletonBlockClassName, "h-[13px] w-[min(130px,80%)]")} />
            <span className={cn(skeletonBlockClassName, "h-[11px] w-[min(74px,55%)]")} />
          </span>
        </li>
      ))}
    </ol>
  )
}
