import { afterEach, describe, expect, it, vi } from "vitest"
import { isDogfoodAuthConfigured } from "./dogfood-config"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("dogfood auth configuration", () => {
  it("uses dogfood mode only when all required renderer env values are present", () => {
    vi.stubEnv("VITE_CONVEX_URL", "")
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "")
    vi.stubEnv("VITE_WORKOS_REDIRECT_URI", "")
    expect(isDogfoodAuthConfigured()).toBe(false)

    vi.stubEnv("VITE_CONVEX_URL", "https://dogfood.convex.cloud")
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_123")
    expect(isDogfoodAuthConfigured()).toBe(false)

    vi.stubEnv("VITE_WORKOS_REDIRECT_URI", "aether://auth/callback")
    expect(isDogfoodAuthConfigured()).toBe(true)
  })

  it("treats blank dogfood env values as unconfigured so startup requires configuration", () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://dogfood.convex.cloud")
    vi.stubEnv("VITE_WORKOS_CLIENT_ID", "client_123")
    vi.stubEnv("VITE_WORKOS_REDIRECT_URI", "   ")

    expect(isDogfoodAuthConfigured()).toBe(false)
  })
})
