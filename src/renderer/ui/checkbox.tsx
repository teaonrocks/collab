import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox"
import { Check } from "lucide-react"
import { forwardRef, type ComponentPropsWithoutRef } from "react"
import { cn } from "../lib/cn"

export type CheckboxProps = ComponentPropsWithoutRef<typeof BaseCheckbox.Root>

export const Checkbox = forwardRef<HTMLElement, CheckboxProps>(
  ({ className, ...props }, ref) => (
    <BaseCheckbox.Root
      ref={ref}
      className={cn(
        "inline-grid size-4 shrink-0 cursor-pointer place-items-center rounded-[3px] border border-border-strong bg-surface-canvas text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-checked:border-foreground data-checked:bg-foreground data-checked:text-foreground-inverse data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <BaseCheckbox.Indicator className="grid place-items-center">
        <Check aria-hidden="true" className="size-3 [stroke-width:3]" />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  )
)

Checkbox.displayName = "Checkbox"
