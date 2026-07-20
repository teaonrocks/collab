import { Radio as BaseRadio } from "@base-ui/react/radio"
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group"
import { type ComponentProps, type ComponentPropsWithoutRef } from "react"
import { cn } from "../lib/cn"

export type RadioGroupProps<Value = string> = ComponentProps<typeof BaseRadioGroup<Value>>

export function RadioGroup<Value = string>({ className, ...props }: RadioGroupProps<Value>) {
  return <BaseRadioGroup<Value> className={cn("grid gap-2", className)} {...props} />
}

export type RadioProps<Value = string> = ComponentPropsWithoutRef<typeof BaseRadio.Root<Value>>

export function Radio<Value = string>({ className, ...props }: RadioProps<Value>) {
  return (
    <BaseRadio.Root<Value>
      className={cn(
        "inline-grid size-4 shrink-0 cursor-pointer place-items-center rounded-full border border-border-strong bg-surface-canvas transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-checked:border-foreground data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <BaseRadio.Indicator className="size-2 rounded-full bg-foreground" />
    </BaseRadio.Root>
  )
}
