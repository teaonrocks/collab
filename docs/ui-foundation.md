# Renderer UI Foundation

The renderer owns its UI components under `src/renderer/ui`. Feature code should import these wrappers instead of importing Base UI or raw utility helpers directly.

## Conventions

- Use `cn` from `src/renderer/lib/cn.ts` for class composition. It combines `clsx` with `tailwind-merge` so later classes can intentionally override earlier Tailwind utilities.
- Keep components app-owned and small. The wrappers should encode Aether's dense, quiet chat UI defaults while still accepting `className` for feature-specific layout.
- Use Base UI for headless accessibility where interaction semantics are easy to get wrong: dialog, dropdown menu, scroll area, and tooltip.
- Use native elements for simple controls: button, input, textarea, badge, and avatar.
- Prefer the Base UI `render` prop when composing triggers with app components. This differs from stock shadcn's `asChild` convention and matches Base UI's documented composition model.
- Keep feature migration separate. These primitives are foundation-only; later tickets should migrate one surface at a time and remove obsolete CSS as they go.

## Design Tokens

Aether tokens live in the renderer Tailwind entrypoint, `src/renderer/App.css`, because the project uses Tailwind v4's CSS-first theme setup. Token values are exposed as `--aether-*` CSS variables and mapped into Tailwind utility names with `@theme inline`.

Use token utilities in app-owned primitives and newly migrated feature UI:

- Surfaces: `bg-surface-canvas`, `bg-surface-raised`, `bg-surface-sunken`, `bg-surface-muted`, `bg-surface-muted-hover`, `bg-surface-rail`
- Text: `text-foreground`, `text-foreground-muted`, `text-foreground-subtle`, `text-foreground-placeholder`, `text-foreground-inverse`
- Structure: `border-border`, `border-border-strong`, `ring-ring`
- Signal: `bg-destructive`, `hover:bg-destructive-hover`, `text-destructive-text`, `bg-signal-unread`, `bg-signal-mentioned`
- Shape and elevation: `rounded-control`, `rounded-panel`, `rounded-card`, `rounded-badge`, `shadow-floating`, `shadow-popover`, `shadow-dialog`, `shadow-panel`
- Dense controls: `h-control-sm`, `h-control`, `h-control-lg`, `size-icon-control`

Light tokens are the default. Dark tokens are explicit behind `data-aether-theme="dark"` and are not automatically enabled by system color scheme, so migrations should not assume dark behavior changes unless a later ticket wires a theme switch.
