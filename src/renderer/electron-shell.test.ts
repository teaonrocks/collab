// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  addWindowAccount,
  getWindowAccountContext,
  openExternalUrl,
  openNativeAuthUrl,
  removeCurrentWindowAccount,
  signOutAllWindowAccounts,
  showDesktopNotification,
  subscribeToDesktopNotificationActivation,
  subscribeToWindowAccountContext,
  switchWindowAccount,
  updateDesktopNotificationContext,
  updateWindowAccountProfile
} from "./electron-shell"

const signInUrl = (host = "api.workos.com", protocol = "https:"): string => {
  const url = new URL(`${protocol}//${host}/user_management/authorize`)
  url.searchParams.set("provider", "authkit")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", "client_123")
  url.searchParams.set("redirect_uri", "aether://auth/callback")
  return url.toString()
}

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, "aetherShell")
})

describe("electron shell URL gate", () => {
  it("delegates to the preload bridge when Electron exposes it", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const openNativeAuth = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, "aetherShell", {
      configurable: true,
      value: { openExternal, openNativeAuth }
    })

    await openExternalUrl(signInUrl())
    await openNativeAuthUrl(signInUrl())

    expect(openExternal).toHaveBeenCalledWith(signInUrl())
    expect(openNativeAuth).toHaveBeenCalledWith(signInUrl())
  })

  it("rejects unsafe browser fallback navigation when preload is unavailable", async () => {
    await expect(openExternalUrl("https://example.com/phishing")).rejects.toThrow("unsupported external URL")
  })

  it("delegates account lifecycle commands to the isolated preload bridge", async () => {
    const context = {
      windowId: "window-1",
      currentAccountId: "default",
      accounts: []
    }
    const bridge = {
      accountContext: vi.fn().mockResolvedValue(context),
      onAccountContextChanged: vi.fn((listener: (next: typeof context) => void) => {
        listener(context)
        return vi.fn()
      }),
      updateAccountProfile: vi.fn().mockResolvedValue(context),
      switchAccount: vi.fn().mockResolvedValue(undefined),
      addAccount: vi.fn().mockResolvedValue(undefined),
      removeCurrentAccount: vi.fn().mockResolvedValue(undefined),
      signOutAllAccounts: vi.fn().mockResolvedValue(undefined)
    }
    Object.defineProperty(window, "aetherShell", {
      configurable: true,
      value: bridge
    })
    const profile = {
      userId: "user-1",
      displayName: "Maya Patel",
      email: "maya@example.com",
      avatarUrl: null
    }

    await expect(getWindowAccountContext()).resolves.toEqual(context)
    await expect(updateWindowAccountProfile(profile)).resolves.toEqual(context)
    const listener = vi.fn()
    const unsubscribe = subscribeToWindowAccountContext(listener)
    await switchWindowAccount("account-2")
    await addWindowAccount()
    await removeCurrentWindowAccount()
    await signOutAllWindowAccounts()

    expect(bridge.updateAccountProfile).toHaveBeenCalledWith(profile)
    expect(listener).toHaveBeenCalledWith(context)
    expect(typeof unsubscribe).toBe("function")
    expect(bridge.switchAccount).toHaveBeenCalledWith("account-2")
    expect(bridge.addAccount).toHaveBeenCalledTimes(1)
    expect(bridge.removeCurrentAccount).toHaveBeenCalledTimes(1)
    expect(bridge.signOutAllAccounts).toHaveBeenCalledTimes(1)
  })

  it("delegates desktop notification context, delivery, and activation", async () => {
    const activation = { conversationId: "channel-1", conversationKind: "channel" as const }
    const request = {
      messageId: "message-1",
      conversationId: "channel-1",
      conversationKind: "channel" as const,
      title: "#general",
      body: "Maya: Hello"
    }
    const bridge = {
      updateDesktopNotificationContext: vi.fn().mockResolvedValue(undefined),
      showDesktopNotification: vi.fn().mockResolvedValue("shown" as const),
      onDesktopNotificationActivated: vi.fn((listener: (value: typeof activation) => void) => {
        listener(activation)
        return vi.fn()
      })
    }
    Object.defineProperty(window, "aetherShell", { configurable: true, value: bridge })

    await updateDesktopNotificationContext("channel-1")
    await expect(showDesktopNotification(request)).resolves.toBe("shown")
    const listener = vi.fn()
    const unsubscribe = subscribeToDesktopNotificationActivation(listener)

    expect(bridge.updateDesktopNotificationContext).toHaveBeenCalledWith("channel-1")
    expect(bridge.showDesktopNotification).toHaveBeenCalledWith(request)
    expect(listener).toHaveBeenCalledWith(activation)
    expect(typeof unsubscribe).toBe("function")
  })
})
