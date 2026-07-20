import { Select as BaseSelect } from "@base-ui/react/select"
import { Check, ChevronDown } from "lucide-react"
import { type ComponentProps } from "react"
import { cn } from "../lib/cn"

export const Select = BaseSelect.Root
export const SelectValue = BaseSelect.Value

export type SelectTriggerProps = ComponentProps<typeof BaseSelect.Trigger>

export function SelectTrigger({ className, children, ...props }: SelectTriggerProps) {
  return (
    <BaseSelect.Trigger
      className={cn(
        "inline-flex h-control min-w-0 items-center justify-between gap-2 rounded-control border border-border-strong bg-surface-raised px-3 text-sm text-foreground transition-colors outline-none hover:bg-surface-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 data-disabled:cursor-not-allowed data-disabled:opacity-55",
        className
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon className="shrink-0 text-foreground-subtle">
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  )
}

export type SelectContentProps = ComponentProps<typeof BaseSelect.Popup> & {
  readonly sideOffset?: ComponentProps<typeof BaseSelect.Positioner>["sideOffset"]
}

export function SelectContent({ className, sideOffset = 6, ...props }: SelectContentProps) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner sideOffset={sideOffset} alignItemWithTrigger={false} className="z-50 outline-none">
        <BaseSelect.Popup
          className={cn(
            "min-w-[var(--anchor-width)] overflow-hidden rounded-panel border border-border-strong bg-surface-raised p-1 text-sm text-foreground shadow-popover outline-none",
            className
          )}
          {...props}
        />
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  )
}

export type SelectItemProps = ComponentProps<typeof BaseSelect.Item>

export function SelectItem({ className, children, ...props }: SelectItemProps) {
  return (
    <BaseSelect.Item
      className={cn(
        "grid min-h-control-sm cursor-default grid-cols-[16px_minmax(0,1fr)] items-center gap-2 rounded-control px-2 text-foreground outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-surface-muted",
        className
      )}
      {...props}
    >
      <span className="selectItemIndicatorSlot grid size-4 place-items-center" aria-hidden="true">
        <BaseSelect.ItemIndicator className="grid place-items-center">
          <Check aria-hidden="true" className="size-3.5" />
        </BaseSelect.ItemIndicator>
      </span>
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  )
}
