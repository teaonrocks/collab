import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import tailwindPostcss from "@tailwindcss/postcss"
import postcss from "postcss"
import { describe, expect, it } from "vitest"

describe("renderer Tailwind pipeline", () => {
  it("generates utilities from renderer TSX sources", async () => {
    const from = resolve("src/renderer/App.css")
    const css = await readFile(from, "utf8")
    const result = await postcss([tailwindPostcss()]).process(css, { from })

    expect(result.css).toContain(".hidden")
    expect(result.css).toContain("--color-surface-canvas: var(--aether-color-surface-canvas)")
    expect(result.css).toContain(".rounded-card")
    expect(result.css).toContain(".bg-surface-canvas")
    expect(result.css).toContain(".text-foreground")
    expect(result.css).toContain(".shadow-popover")
  })

  it("keeps migrated app-only CSS out of the renderer stylesheet", async () => {
    const css = await readFile(resolve("src/renderer/App.css"), "utf8")

    expect(css).not.toContain(".srOnly")
    expect(css).not.toContain(".buttonIcon")
    expect(css).toContain("@keyframes skeletonPulse")
  })
})
