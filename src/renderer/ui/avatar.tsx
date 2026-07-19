import { Avatar as BaseAvatar } from "@base-ui/react/avatar"
import { type ComponentPropsWithoutRef } from "react"
import { cn } from "../lib/cn"
import { initials } from "../lib/initials"

export type AvatarProps = Omit<ComponentPropsWithoutRef<typeof BaseAvatar.Root>, "children"> & {
  readonly name: string
  readonly src?: string
  readonly alt?: string
}

export function Avatar({ name, src, alt, className, ...props }: AvatarProps) {
  const hidden = props["aria-hidden"] === true || props["aria-hidden"] === "true"
  return (
    <BaseAvatar.Root
      aria-label={src === undefined && !hidden ? name : undefined}
      className={cn(
        "inline-grid size-9 shrink-0 place-items-center overflow-hidden rounded-card bg-surface-rail text-xs font-extrabold text-foreground",
        className
      )}
      {...props}
    >
      {src === undefined ? null : <BaseAvatar.Image className="size-full object-cover" src={src} alt={alt ?? name} />}
      <BaseAvatar.Fallback>{initials(name)}</BaseAvatar.Fallback>
    </BaseAvatar.Root>
  )
}
