import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip"
import { type ComponentProps } from "react"
import { cn } from "../lib/cn"

export const TooltipProvider = BaseTooltip.Provider
export const Tooltip = BaseTooltip.Root
export const TooltipTrigger = BaseTooltip.Trigger

export type TooltipContentProps = ComponentProps<typeof BaseTooltip.Popup> & {
  readonly sideOffset?: ComponentProps<typeof BaseTooltip.Positioner>["sideOffset"]
  readonly side?: ComponentProps<typeof BaseTooltip.Positioner>["side"]
  readonly align?: ComponentProps<typeof BaseTooltip.Positioner>["align"]
}

export function TooltipContent({ className, sideOffset = 8, side, align, ...props }: TooltipContentProps) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner sideOffset={sideOffset} side={side} align={align}>
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
