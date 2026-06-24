// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { isSafeExternalAuthUrl, openExternalUrl } from "./electron-shell"

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
  it("allows AuthKit sign-in URLs on WorkOS, AuthKit, and local dev hosts", () => {
    expect(isSafeExternalAuthUrl(signInUrl())).toBe(true)
    expect(isSafeExternalAuthUrl(signInUrl("team.authkit.app"))).toBe(true)
    expect(isSafeExternalAuthUrl(signInUrl("localhost", "http:"))).toBe(true)
  })

  it("rejects non-AuthKit external and malformed callback URLs", () => {
    expect(isSafeExternalAuthUrl("https://example.com/user_management/authorize")).toBe(false)
    expect(isSafeExternalAuthUrl(signInUrl("api.workos.com", "http:"))).toBe(false)
    expect(isSafeExternalAuthUrl(signInUrl().replace("/user_management/authorize", "/docs"))).toBe(false)
    expect(isSafeExternalAuthUrl(signInUrl().replace("aether%3A%2F%2Fauth%2Fcallback", "https%3A%2F%2Fevil.test"))).toBe(false)
    expect(isSafeExternalAuthUrl("aether://auth/callback?code=abc")).toBe(false)
  })

  it("delegates to the preload bridge when Electron exposes it", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, "aetherShell", {
      configurable: true,
      value: { openExternal }
    })

    await openExternalUrl(signInUrl())

    expect(openExternal).toHaveBeenCalledWith(signInUrl())
  })

  it("rejects unsafe browser fallback navigation when preload is unavailable", async () => {
    await expect(openExternalUrl("https://example.com/phishing")).rejects.toThrow("unsupported external URL")
  })
})
