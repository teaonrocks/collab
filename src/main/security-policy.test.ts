import { describe, expect, it, vi } from "vitest"
import {
  createWillNavigateHandler,
  createWindowOpenHandler,
  hardenedWebPreferences,
  isAllowedExternalAttachmentUrl,
  isTrustedPrivilegedIpcSender,
  isTrustedRendererUrl,
  type RendererLocationPolicy
} from "./security-policy"

const packagedPolicy: RendererLocationPolicy = {
  packagedRendererUrl: "file:///Applications/Aether.app/Contents/Resources/app.asar/out/renderer/index.html"
}

describe("Electron renderer security policy", () => {
  it("enables sandboxing while retaining the isolated preload bridge", () => {
    expect(hardenedWebPreferences("/app/preload.js")).toEqual({
      preload: "/app/preload.js",
      contextIsolation: true,
      sandbox: true
    })
  })

  it("allows only the configured renderer location for top-level navigation", () => {
    expect(isTrustedRendererUrl(`${packagedPolicy.packagedRendererUrl}?code=abc`, packagedPolicy)).toBe(true)
    expect(isTrustedRendererUrl("file:///tmp/copied-index.html", packagedPolicy)).toBe(false)
    expect(isTrustedRendererUrl("file://remote-host/Applications/Aether.app/Contents/Resources/app.asar/out/renderer/index.html", packagedPolicy)).toBe(false)
    expect(isTrustedRendererUrl("https://evil.example/app", packagedPolicy)).toBe(false)

    const devPolicy = {
      rendererDevServerUrl: "http://localhost:5173/",
      packagedRendererUrl: packagedPolicy.packagedRendererUrl
    }
    expect(isTrustedRendererUrl("http://localhost:5173/callback?code=abc", devPolicy)).toBe(true)
    expect(isTrustedRendererUrl("http://127.0.0.1:5173/", devPolicy)).toBe(false)

    const preventDefault = vi.fn()
    const handleNavigation = createWillNavigateHandler(packagedPolicy)
    handleNavigation({ preventDefault }, packagedPolicy.packagedRendererUrl)
    expect(preventDefault).not.toHaveBeenCalled()
    handleNavigation({ preventDefault }, "https://evil.example/app")
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it("approves only credential-free HTTPS attachment URLs for the system browser", () => {
    expect(isAllowedExternalAttachmentUrl("https://files.example/brief.pdf?token=abc")).toBe(true)
    expect(isAllowedExternalAttachmentUrl("http://files.example/brief.pdf")).toBe(false)
    expect(isAllowedExternalAttachmentUrl("https://user@files.example/brief.pdf")).toBe(false)
    expect(isAllowedExternalAttachmentUrl("javascript:alert(1)")).toBe(false)

    const openExternal = vi.fn().mockResolvedValue(undefined)
    const handleWindowOpen = createWindowOpenHandler(openExternal, vi.fn())
    expect(handleWindowOpen({ url: "https://files.example/brief.pdf" })).toEqual({ action: "deny" })
    expect(handleWindowOpen({ url: "http://files.example/brief.pdf" })).toEqual({ action: "deny" })
    expect(openExternal).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledWith("https://files.example/brief.pdf")
  })

  it("requires the expected main frame and a trusted frame URL for privileged IPC", () => {
    const mainFrame = { url: packagedPolicy.packagedRendererUrl }
    const expectedWebContents = { mainFrame }

    expect(isTrustedPrivilegedIpcSender(
      { sender: expectedWebContents, senderFrame: mainFrame },
      expectedWebContents,
      packagedPolicy
    )).toBe(true)
    expect(isTrustedPrivilegedIpcSender(
      { sender: expectedWebContents, senderFrame: { url: packagedPolicy.packagedRendererUrl } },
      expectedWebContents,
      packagedPolicy
    )).toBe(false)
    expect(isTrustedPrivilegedIpcSender(
      { sender: { mainFrame }, senderFrame: mainFrame },
      expectedWebContents,
      packagedPolicy
    )).toBe(false)
    expect(isTrustedPrivilegedIpcSender(
      { sender: expectedWebContents, senderFrame: null },
      expectedWebContents,
      packagedPolicy
    )).toBe(false)
  })
})
