import { type ComponentPropsWithoutRef } from "react"
import { cn } from "../lib/cn"

export type AvatarProps = Omit<ComponentPropsWithoutRef<"span">, "children"> & {
  readonly name: string
  readonly src?: string
  readonly alt?: string
}

export function Avatar({ name, src, alt, className, ...props }: AvatarProps) {
  return (
    <span
      aria-label={src === undefined ? name : undefined}
      className={cn(
        "inline-grid size-9 shrink-0 place-items-center overflow-hidden rounded-card bg-surface-rail text-xs font-extrabold text-foreground",
        className
      )}
      {...props}
    >
      {src === undefined
        ? initials(name)
        : <img className="size-full object-cover" src={src} alt={alt ?? name} />}
    </span>
  )
}

const initials = (value: string): string =>
  value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase()
