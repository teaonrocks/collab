import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area"
import { type ComponentProps } from "react"
import { cn } from "../lib/cn"

export type ScrollAreaProps = ComponentProps<typeof BaseScrollArea.Root>

export function ScrollArea({ className, children, ...props }: ScrollAreaProps) {
  return (
    <BaseScrollArea.Root className={cn("relative overflow-hidden", className)} {...props}>
      <BaseScrollArea.Viewport className="size-full">
        <BaseScrollArea.Content>{children}</BaseScrollArea.Content>
      </BaseScrollArea.Viewport>
      <BaseScrollArea.Scrollbar className="flex w-2 touch-none bg-transparent p-px select-none">
        <BaseScrollArea.Thumb className="relative flex-1 rounded-full bg-border-strong" />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Scrollbar
        orientation="horizontal"
        className="flex h-2 touch-none bg-transparent p-px select-none"
      >
        <BaseScrollArea.Thumb className="relative flex-1 rounded-full bg-border-strong" />
      </BaseScrollArea.Scrollbar>
      <BaseScrollArea.Corner />
    </BaseScrollArea.Root>
  )
}
