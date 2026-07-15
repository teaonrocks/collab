import { describe, expect, it } from "vitest"
import {
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
})
