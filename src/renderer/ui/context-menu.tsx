import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu"
import { type ComponentProps } from "react"
import { cn } from "../lib/cn"

export const ContextMenu = BaseContextMenu.Root
export const ContextMenuTrigger = BaseContextMenu.Trigger

export type ContextMenuContentProps = ComponentProps<typeof BaseContextMenu.Popup> & {
  readonly sideOffset?: ComponentProps<typeof BaseContextMenu.Positioner>["sideOffset"]
}

export function ContextMenuContent({ className, sideOffset = 4, ...props }: ContextMenuContentProps) {
  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner sideOffset={sideOffset} className="z-50 outline-none">
        <BaseContextMenu.Popup
          className={cn(
            "min-w-[170px] overflow-hidden rounded-panel border border-border-strong bg-surface-raised p-1 text-sm text-foreground shadow-popover outline-none",
            className
          )}
          {...props}
        />
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  )
}

export type ContextMenuItemProps = ComponentProps<typeof BaseContextMenu.Item>

export function ContextMenuItem({ className, ...props }: ContextMenuItemProps) {
  return (
    <BaseContextMenu.Item
      className={cn(
        "flex min-h-control-sm cursor-default select-none items-center gap-2 rounded-control px-2 text-foreground outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-surface-muted",
        className
      )}
      {...props}
    />
  )
}
