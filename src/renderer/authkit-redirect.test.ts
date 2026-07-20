import { describe, expect, it } from "vitest"
import {
  authKitProviderOptionsForCurrentLocation,
  authKitRedirectUriForCurrentLocation,
  authKitSignOutReturnTo
} from "./authkit-redirect"

describe("AuthKit renderer redirect helpers", () => {
  it("uses the packaged renderer page as the callback path when a native deep link lands with a code", () => {
    expect(
      authKitRedirectUriForCurrentLocation("aether://auth/callback", {
        href: "file:///Applications/Aether.app/Contents/Resources/out/renderer/index.html?code=abc&state=xyz",
        search: "?code=abc&state=xyz"
      })
    ).toBe("file:///Applications/Aether.app/Contents/Resources/out/renderer/index.html")
  })

  it("keeps the configured native redirect URI while generating sign-in URLs", () => {
    expect(
      authKitRedirectUriForCurrentLocation("aether://auth/callback", {
        href: "file:///app/index.html",
        search: ""
      })
    ).toBe("aether://auth/callback")
  })

  it("does not rewrite non-native redirect URIs", () => {
    expect(
      authKitRedirectUriForCurrentLocation("http://localhost:5173/callback", {
        href: "http://localhost:5173/callback?code=abc",
        search: "?code=abc"
      })
    ).toBe("http://localhost:5173/callback")
  })

  it("uses the current app page without callback parameters as the sign-out return target", () => {
    expect(
      authKitSignOutReturnTo({
        href: "file:///Applications/Aether.app/Contents/Resources/out/renderer/index.html?code=abc#debug"
      })
    ).toBe("file:///Applications/Aether.app/Contents/Resources/out/renderer/index.html")
  })

  it("configures AuthKit local storage for packaged renderer refresh tokens", () => {
    expect(
      authKitProviderOptionsForCurrentLocation("aether://auth/callback", {
        href: "file:///Applications/Aether.app/Contents/Resources/out/renderer/index.html",
        protocol: "file:",
        search: ""
      })
    ).toEqual({
      redirectUri: "aether://auth/callback",
      devMode: true
    })
  })

  it("leaves web origins on AuthKit's automatic cookie policy", () => {
    expect(
      authKitProviderOptionsForCurrentLocation("http://localhost:5173/callback", {
        href: "http://localhost:5173/",
        protocol: "http:",
        search: ""
      })
    ).toEqual({ redirectUri: "http://localhost:5173/callback" })
    expect(
      authKitProviderOptionsForCurrentLocation("https://app.example.com/callback", {
        href: "https://app.example.com/",
        protocol: "https:",
        search: ""
      })
    ).toEqual({ redirectUri: "https://app.example.com/callback" })
  })
})
