import { cva, type VariantProps } from "class-variance-authority"
import { type ComponentPropsWithoutRef } from "react"
import { cn } from "../lib/cn"

const badgeVariants = cva(
  "inline-flex max-w-full items-center rounded-badge border px-1.5 py-0.5 text-xs leading-none font-semibold",
  {
    variants: {
      variant: {
        default: "border-border bg-surface-muted text-foreground",
        muted: "border-transparent bg-surface-muted-hover text-foreground-subtle",
        danger: "border-destructive-border bg-destructive-surface text-destructive-text"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
)

export type BadgeProps = ComponentPropsWithoutRef<"span"> & VariantProps<typeof badgeVariants>

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
