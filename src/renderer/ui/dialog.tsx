import { Dialog as BaseDialog } from "@base-ui/react/dialog"
import { type ComponentProps } from "react"
import { cn } from "../lib/cn"

export const Dialog = BaseDialog.Root
const DialogPortal = BaseDialog.Portal

type DialogBackdropProps = ComponentProps<typeof BaseDialog.Backdrop>

function DialogBackdrop({ className, ...props }: DialogBackdropProps) {
  return <BaseDialog.Backdrop className={cn("fixed inset-0 z-50 bg-overlay", className)} {...props} />
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

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-4 flex justify-end gap-2", className)} {...props} />
}

export type DialogTitleProps = ComponentProps<typeof BaseDialog.Title>

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <BaseDialog.Title className={cn("m-0 text-base leading-tight font-bold text-foreground", className)} {...props} />
  )
}

export type DialogDescriptionProps = ComponentProps<typeof BaseDialog.Description>

export function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return <BaseDialog.Description className={cn("m-0 text-sm leading-5 text-foreground-subtle", className)} {...props} />
}
