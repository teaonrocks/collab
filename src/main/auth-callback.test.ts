import { describe, expect, it, vi } from "vitest"
import { createAuthCallbackCoordinator, focusAuthCallbackWindow, type AuthCallbackWindow } from "./auth-callback"

const makeWindow = (input?: { readonly minimized?: boolean; readonly destroyed?: boolean }) => {
  let minimized = input?.minimized ?? false
  const window: AuthCallbackWindow = {
    isDestroyed: vi.fn(() => input?.destroyed ?? false),
    isMinimized: vi.fn(() => minimized),
    restore: vi.fn(() => {
      minimized = false
    }),
    focus: vi.fn(),
    loadURL: vi.fn()
  }
  return window
}

describe("auth callback coordinator", () => {
  it("restores and focuses a minimized callback window", () => {
    const window = makeWindow({ minimized: true })

    focusAuthCallbackWindow(window)

    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("queues a valid callback until a window exists", () => {
    const coordinator = createAuthCallbackCoordinator({
      initialAuthCallbackUrl: null,
      rendererCallbackUrl: (rawUrl) => rawUrl.replace("aether://auth/callback", "file:///app/index.html")
    })

    coordinator.handleAuthCallback("aether://auth/callback?code=abc", null)

    expect(coordinator.pendingAuthCallbackUrl()).toBe("aether://auth/callback?code=abc")

    const window = makeWindow()
    coordinator.consumePendingAuthCallback(window)

    expect(coordinator.pendingAuthCallbackUrl()).toBeNull()
    expect(window.loadURL).toHaveBeenCalledWith("file:///app/index.html?code=abc")
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("ignores unsupported callback URLs without replacing pending work", () => {
    const coordinator = createAuthCallbackCoordinator({
      initialAuthCallbackUrl: "aether://auth/callback?code=first",
      rendererCallbackUrl: (rawUrl) => (rawUrl.startsWith("aether://auth/callback") ? "file:///app/index.html" : null)
    })
    const window = makeWindow()

    coordinator.handleAuthCallback("https://evil.test/callback?code=abc", window)

    expect(coordinator.pendingAuthCallbackUrl()).toBe("aether://auth/callback?code=first")
    expect(window.loadURL).not.toHaveBeenCalled()
  })

  it("keeps valid callbacks pending if the existing window is destroyed", () => {
    const coordinator = createAuthCallbackCoordinator({
      initialAuthCallbackUrl: null,
      rendererCallbackUrl: () => "file:///app/index.html?code=abc"
    })

    coordinator.handleAuthCallback("aether://auth/callback?code=abc", makeWindow({ destroyed: true }))

    expect(coordinator.pendingAuthCallbackUrl()).toBe("aether://auth/callback?code=abc")
  })

  it("can discard a stale callback that no longer has its initiating window", () => {
    const coordinator = createAuthCallbackCoordinator({
      initialAuthCallbackUrl: "aether://auth/callback?code=stale",
      rendererCallbackUrl: () => "file:///app/index.html?code=stale"
    })

    coordinator.discardPendingAuthCallback()

    expect(coordinator.pendingAuthCallbackUrl()).toBeNull()
  })
})
