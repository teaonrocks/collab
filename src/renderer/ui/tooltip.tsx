import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip"
import { type ComponentProps } from "react"
import { cn } from "../lib/cn"

export const TooltipProvider = BaseTooltip.Provider
export const Tooltip = BaseTooltip.Root
export const TooltipTrigger = BaseTooltip.Trigger

export type TooltipContentProps = ComponentProps<typeof BaseTooltip.Popup> & {
  readonly sideOffset?: ComponentProps<typeof BaseTooltip.Positioner>["sideOffset"]
}

export function TooltipContent({ className, sideOffset = 8, ...props }: TooltipContentProps) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner sideOffset={sideOffset}>
        <BaseTooltip.Popup
          className={cn(
            "z-50 rounded-control bg-foreground px-2.5 py-1.5 text-xs font-semibold text-foreground-inverse shadow-popover",
            className
          )}
          {...props}
        />
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
}
