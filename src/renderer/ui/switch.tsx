import { Switch as BaseSwitch } from "@base-ui/react/switch"
import { forwardRef, type ComponentPropsWithoutRef } from "react"
import { cn } from "../lib/cn"

export type SwitchProps = ComponentPropsWithoutRef<typeof BaseSwitch.Root>

export const Switch = forwardRef<HTMLElement, SwitchProps>(
  ({ className, ...props }, ref) => (
    <BaseSwitch.Root
      ref={ref}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-foreground data-unchecked:bg-border-strong",
        className
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-surface-raised shadow-floating ring-0 transition-transform data-checked:translate-x-4 data-unchecked:translate-x-0"
        )}
      />
    </BaseSwitch.Root>
  )
)

Switch.displayName = "Switch"
