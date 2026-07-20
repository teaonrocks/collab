import { Combobox as BaseCombobox } from "@base-ui/react/combobox"
import { forwardRef, type ComponentProps } from "react"
import { cn } from "../lib/cn"

export const Combobox = BaseCombobox.Root
const ComboboxPortal = BaseCombobox.Portal
const ComboboxPositioner = BaseCombobox.Positioner

export type ComboboxInputProps = ComponentProps<typeof BaseCombobox.Input>

export const ComboboxInput = forwardRef<HTMLInputElement, ComboboxInputProps>(({ className, ...props }, ref) => (
  <BaseCombobox.Input
    ref={ref}
    className={cn(
      "flex h-control w-full rounded-control border border-border-strong bg-surface-raised px-3 text-sm text-foreground transition-colors outline-none placeholder:text-foreground-placeholder focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-foreground-placeholder",
      className
    )}
    {...props}
  />
))

ComboboxInput.displayName = "ComboboxInput"

export type ComboboxContentProps = ComponentProps<typeof BaseCombobox.Popup> & {
  readonly sideOffset?: ComponentProps<typeof BaseCombobox.Positioner>["sideOffset"]
}

export function ComboboxContent({ className, sideOffset = 8, ...props }: ComboboxContentProps) {
  return (
    <ComboboxPortal>
      <ComboboxPositioner side="bottom" align="start" sideOffset={sideOffset} className="z-50">
        <BaseCombobox.Popup
          className={cn(
            "min-w-[var(--anchor-width)] overflow-hidden rounded-panel border border-border-strong bg-surface-raised p-2 text-sm text-foreground shadow-popover focus-visible:outline-none",
            className
          )}
          {...props}
        />
      </ComboboxPositioner>
    </ComboboxPortal>
  )
}

export type ComboboxListProps = ComponentProps<typeof BaseCombobox.List>

export function ComboboxList({ className, ...props }: ComboboxListProps) {
  return <BaseCombobox.List className={cn("flex max-h-[220px] flex-col gap-1 overflow-auto", className)} {...props} />
}

export type ComboboxItemProps = ComponentProps<typeof BaseCombobox.Item> & {
  readonly id?: string
}

export function ComboboxItem({ className, ...props }: ComboboxItemProps) {
  return (
    <BaseCombobox.Item
      className={cn(
        "cursor-default rounded-control border border-transparent outline-none data-[highlighted]:border-border data-[highlighted]:bg-surface-muted data-[selected]:border-border-strong",
        className
      )}
      {...props}
    />
  )
}
