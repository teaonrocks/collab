import { forwardRef, type ComponentPropsWithoutRef } from "react"
import { cn } from "../lib/cn"

export type InputProps = ComponentPropsWithoutRef<"input">

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-control w-full rounded-control border border-border-strong bg-surface-raised px-3 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-placeholder focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-foreground-placeholder",
        className
      )}
      {...props}
    />
  )
)

Input.displayName = "Input"
