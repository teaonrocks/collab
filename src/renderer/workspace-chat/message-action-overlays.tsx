import { Copy, Pencil, Reply, Square, SquareCheck, Trash2 } from "lucide-react"
import type { ChatMessage } from "../chat-data"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem
} from "../ui"

const iconClassName = "size-4 [stroke-width:2]"
const pointAnchor = (x: number, y: number) => ({
  getBoundingClientRect: () => new DOMRect(x, y, 0, 0)
})

export function MessageContextMenu(props: {
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
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      modal={false}
    >
      <DropdownMenuContent
        className="messageContextMenu min-w-[170px] p-0"
        aria-label={`Context menu for message from ${message.authorDisplayName}`}
        anchor={() => pointAnchor(x, y)}
        positionMethod="fixed"
        side="right"
        align="start"
        sideOffset={0}
      >
        <DropdownMenuItem
          className={itemClassName}
          onClick={() => {
            onToggle()
            onClose()
          }}
        >
          <SelectIcon className={iconClassName} aria-hidden="true" />
          <span>{selected ? "Deselect" : "Select"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClassName}
          onClick={() => {
            onCopy()
            onClose()
          }}
        >
          <Copy className={iconClassName} aria-hidden="true" />
          <span>Copy message</span>
        </DropdownMenuItem>
        {canEdit ? (
          <DropdownMenuItem
            className={itemClassName}
            onClick={() => {
              onEdit()
              onClose()
            }}
          >
            <Pencil className={iconClassName} aria-hidden="true" />
            <span>Edit message</span>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          className={itemClassName}
          onClick={() => {
            onReply()
            onClose()
          }}
        >
          <Reply className={iconClassName} aria-hidden="true" />
          <span>Reply</span>
        </DropdownMenuItem>
        {canDelete ? (
          <DropdownMenuItem
            className={itemClassName}
            onClick={() => {
              onDelete()
              onClose()
            }}
          >
            <Trash2 className={iconClassName} aria-hidden="true" />
            <span>Delete message</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DeleteMessageDialog(props: {
  readonly authorDisplayName: string
  readonly operationError: string | null
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const { authorDisplayName, operationError, onCancel, onConfirm } = props

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent className="deleteMessageDialog max-w-[360px]">
        <DialogTitle id="delete-message-title">Delete Message?</DialogTitle>
        <DialogDescription
          id="delete-message-description"
          className="mt-2 text-[13px] leading-[1.45] text-foreground-muted"
        >
          Delete this message from {authorDisplayName}? This cannot be undone.
        </DialogDescription>
        {operationError === null ? null : (
          <p className="mt-3 mb-0 text-[13px] leading-[1.35] text-destructive-text" role="status">
            {operationError}
          </p>
        )}
        <DialogFooter className="deleteMessageActions">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
