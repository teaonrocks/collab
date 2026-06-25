import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { type ComponentProps } from "react"
import { cn } from "../lib/cn"

export const Dialog = BaseDialog.Root
export const DialogTrigger = BaseDialog.Trigger
export const DialogPortal = BaseDialog.Portal
export const DialogClose = BaseDialog.Close

export type DialogBackdropProps = ComponentProps<typeof BaseDialog.Backdrop>

export function DialogBackdrop({ className, ...props }: DialogBackdropProps) {
  return (
    <BaseDialog.Backdrop
      className={cn("fixed inset-0 z-50 bg-overlay", className)}
      {...props}
    />
  )
}

export type DialogContentProps = ComponentProps<typeof BaseDialog.Popup>

export function DialogContent({ className, children, ...props }: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogBackdrop />
      <BaseDialog.Viewport className="fixed inset-0 z-50 grid place-items-center p-4">
        <BaseDialog.Popup
          className={cn(
            "relative w-full max-w-md rounded-card border border-border-strong bg-surface-raised p-4 text-foreground shadow-dialog focus-visible:outline-none",
            className
          )}
          {...props}
        >
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </DialogPortal>
  )
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid gap-1", className)} {...props} />
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-4 flex justify-end gap-2", className)} {...props} />
}

export type DialogTitleProps = ComponentProps<typeof BaseDialog.Title>

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <BaseDialog.Title
      className={cn("m-0 text-base font-bold leading-tight text-foreground", className)}
      {...props}
    />
  )
}

export type DialogDescriptionProps = ComponentProps<typeof BaseDialog.Description>

export function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return (
    <BaseDialog.Description
      className={cn("m-0 text-sm leading-5 text-foreground-subtle", className)}
      {...props}
    />
  )
}

export function DialogCloseButton({ className, ...props }: ComponentProps<typeof BaseDialog.Close>) {
  return (
    <BaseDialog.Close
      aria-label="Close dialog"
      className={cn(
        "absolute right-2 top-2 inline-grid size-icon-control place-items-center rounded-control text-foreground-subtle hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      {...props}
    >
      <X aria-hidden="true" className="size-4" />
    </BaseDialog.Close>
  )
}
