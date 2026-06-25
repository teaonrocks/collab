export function TailwindPipelineProbe() {
  return (
    <span
      aria-hidden="true"
      className="hidden h-control rounded-card border border-border bg-surface-canvas text-foreground shadow-popover"
      data-tailwind-pipeline="ready"
    />
  )
}
