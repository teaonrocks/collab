import { Button as BaseButton } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { forwardRef, type ComponentPropsWithoutRef, type ForwardedRef } from "react"
import { cn } from "../lib/cn"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-55 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border border-foreground bg-foreground text-foreground-inverse hover:bg-foreground-muted",
        secondary: "border border-border-strong bg-surface-raised text-foreground hover:bg-surface-muted",
        ghost: "border border-transparent bg-transparent text-foreground-muted hover:bg-surface-muted hover:text-foreground",
        link: "h-auto border border-transparent bg-transparent p-0 text-foreground-muted underline decoration-foreground-subtle underline-offset-4 hover:text-foreground hover:decoration-foreground",
        danger: "border border-destructive bg-destructive text-foreground-inverse hover:bg-destructive-hover"
      },
      size: {
        sm: "h-control-sm px-3 text-xs",
        default: "h-control px-3.5",
        lg: "h-control-lg px-4",
        icon: "size-icon-control p-0"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
)

export type ButtonProps =
  & ComponentPropsWithoutRef<typeof BaseButton>
  & VariantProps<typeof buttonVariants>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <BaseButton
      ref={ref as ForwardedRef<HTMLElement>}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
)

Button.displayName = "Button"
