import { forwardRef, type ComponentPropsWithoutRef } from "react"
import { cn } from "../lib/cn"

export type TextareaProps = ComponentPropsWithoutRef<"textarea">

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-20 w-full resize-y rounded-control border border-border-strong bg-surface-raised px-3 py-2 text-sm leading-5 text-foreground outline-none transition-colors placeholder:text-foreground-placeholder focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-foreground-placeholder",
        className
      )}
      {...props}
    />
  )
)

Textarea.displayName = "Textarea"
