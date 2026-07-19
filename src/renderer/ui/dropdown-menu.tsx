import { Menu as BaseMenu } from "@base-ui/react/menu"
import { type ComponentProps } from "react"
import { cn } from "../lib/cn"

export const DropdownMenu = BaseMenu.Root
export const DropdownMenuTrigger = BaseMenu.Trigger
const DropdownMenuPortal = BaseMenu.Portal
export const DropdownMenuGroup = BaseMenu.Group

export type DropdownMenuContentProps = ComponentProps<typeof BaseMenu.Popup> & {
  readonly keepMounted?: ComponentProps<typeof BaseMenu.Portal>["keepMounted"]
  readonly sideOffset?: ComponentProps<typeof BaseMenu.Positioner>["sideOffset"]
  readonly side?: ComponentProps<typeof BaseMenu.Positioner>["side"]
  readonly align?: ComponentProps<typeof BaseMenu.Positioner>["align"]
  readonly anchor?: ComponentProps<typeof BaseMenu.Positioner>["anchor"]
  readonly positionMethod?: ComponentProps<typeof BaseMenu.Positioner>["positionMethod"]
}

export function DropdownMenuContent({ className, keepMounted, sideOffset = 6, side, align, anchor, positionMethod, ...props }: DropdownMenuContentProps) {
  return (
    <DropdownMenuPortal keepMounted={keepMounted}>
      <BaseMenu.Positioner
        sideOffset={sideOffset}
        side={side}
        align={align}
        anchor={anchor}
        positionMethod={positionMethod}
        className="z-50 outline-none"
      >
        <BaseMenu.Popup
          className={cn(
            "z-50 min-w-40 overflow-hidden rounded-panel border border-border-strong bg-surface-raised p-1 text-sm text-foreground shadow-popover focus-visible:outline-none",
            className
          )}
          {...props}
        />
      </BaseMenu.Positioner>
    </DropdownMenuPortal>
  )
}

export type DropdownMenuItemProps = ComponentProps<typeof BaseMenu.Item>

export function DropdownMenuItem({ className, ...props }: DropdownMenuItemProps) {
  return (
    <BaseMenu.Item
      className={cn(
        "flex min-h-control-sm cursor-default select-none items-center gap-2 rounded-control px-2 text-foreground outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-muted",
        className
      )}
      {...props}
    />
  )
}

export type DropdownMenuLabelProps = ComponentProps<typeof BaseMenu.GroupLabel>

export function DropdownMenuLabel({ className, ...props }: DropdownMenuLabelProps) {
  return <BaseMenu.GroupLabel className={cn("px-2 py-1 text-xs font-bold text-foreground-subtle", className)} {...props} />
}

export type DropdownMenuSeparatorProps = ComponentProps<typeof BaseMenu.Separator>

export function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return <BaseMenu.Separator className={cn("-mx-1 my-1 h-px bg-surface-rail", className)} {...props} />
}
