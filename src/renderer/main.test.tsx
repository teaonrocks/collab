// @vitest-environment happy-dom
import { cleanup, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
  vi.resetModules()
  vi.unstubAllEnvs()
})

describe("renderer bootstrap", () => {
  it("does not mount the local JSON chat when dogfood configuration is missing", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "")
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "")
    vi.stubEnv("VITE_WORKOS_REDIRECT_URI", "")
    document.body.innerHTML = `<div id="root"></div>`

    await import("./main")

    expect(await screen.findByText("Dogfood configuration required")).toBeTruthy()
    expect(screen.queryByText("Aether Labs")).toBeNull()
  })
})
