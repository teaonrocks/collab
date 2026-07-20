import { describe, expect, it } from "vitest"
import {
  findAuthCallbackUrl,
  isAllowedExternalAuthUrl,
  parseAuthCallbackUrl,
  rendererAuthCallbackUrl
} from "./auth-redirect-policy"

const signInUrl = (input?: {
  readonly host?: string
  readonly protocol?: string
  readonly redirectUri?: string
  readonly provider?: string
  readonly responseType?: string
  readonly clientId?: string
}): string => {
  const host = input?.host ?? "api.workos.com"
  const protocol = input?.protocol ?? "https:"
  const url = new URL(`${protocol}//${host}/user_management/authorize`)
  url.searchParams.set("provider", input?.provider ?? "authkit")
  url.searchParams.set("response_type", input?.responseType ?? "code")
  url.searchParams.set("client_id", input?.clientId ?? "client_123")
  url.searchParams.set("redirect_uri", input?.redirectUri ?? "aether://auth/callback")
  return url.toString()
}

describe("auth redirect policy", () => {
  it("allows AuthKit sign-in URLs on WorkOS, AuthKit, and local dev hosts", () => {
    expect(isAllowedExternalAuthUrl(signInUrl())).toBe(true)
    expect(isAllowedExternalAuthUrl(signInUrl({ host: "team.authkit.app" }))).toBe(true)
    expect(isAllowedExternalAuthUrl(signInUrl({ host: "localhost", protocol: "http:" }))).toBe(true)
    expect(isAllowedExternalAuthUrl(signInUrl({ host: "[::1]", protocol: "http:" }))).toBe(true)
  })

  it("allows native and local callback redirect URIs on otherwise valid sign-in URLs", () => {
    expect(isAllowedExternalAuthUrl(signInUrl({ redirectUri: "aether://auth/callback?state=abc" }))).toBe(true)
    expect(isAllowedExternalAuthUrl(signInUrl({ redirectUri: "http://localhost/callback?code=abc" }))).toBe(true)
    expect(isAllowedExternalAuthUrl(signInUrl({ redirectUri: "https://127.0.0.1/callback?code=abc" }))).toBe(true)
  })

  it("rejects unsupported external sign-in URLs", () => {
    expect(isAllowedExternalAuthUrl("https://example.com/user_management/authorize")).toBe(false)
    expect(isAllowedExternalAuthUrl(signInUrl({ host: "api.workos.com", protocol: "http:" }))).toBe(false)
    expect(isAllowedExternalAuthUrl(signInUrl().replace("/user_management/authorize", "/docs"))).toBe(false)
    expect(isAllowedExternalAuthUrl(signInUrl({ provider: "google" }))).toBe(false)
    expect(isAllowedExternalAuthUrl(signInUrl({ responseType: "token" }))).toBe(false)
    expect(isAllowedExternalAuthUrl(signInUrl({ clientId: "not-a-client" }))).toBe(false)
    expect(isAllowedExternalAuthUrl(signInUrl({ redirectUri: "https://evil.test/callback" }))).toBe(false)
    expect(isAllowedExternalAuthUrl(signInUrl({ redirectUri: "aether://auth/callback#fragment" }))).toBe(false)
    expect(isAllowedExternalAuthUrl("aether://auth/callback?code=abc")).toBe(false)
  })

  it("parses only strict native auth callbacks", () => {
    expect(parseAuthCallbackUrl("aether://auth/callback?code=abc")?.searchParams.get("code")).toBe("abc")
    expect(parseAuthCallbackUrl("aether://auth/callback#fragment")).toBeNull()
    expect(parseAuthCallbackUrl("aether://auth:443/callback")).toBeNull()
    expect(parseAuthCallbackUrl("aether://auth/other")).toBeNull()
    expect(parseAuthCallbackUrl("aether://user@auth/callback")).toBeNull()
    expect(parseAuthCallbackUrl("not a url")).toBeNull()
  })

  it("finds the first auth callback URL in process arguments", () => {
    expect(findAuthCallbackUrl(["--flag", "aether://auth/callback?code=abc", "aether://auth/callback?code=next"])).toBe(
      "aether://auth/callback?code=abc"
    )
    expect(findAuthCallbackUrl(["--flag", "https://example.test"])).toBeNull()
  })

  it("maps native callbacks to the renderer callback URL", () => {
    expect(
      rendererAuthCallbackUrl("aether://auth/callback?code=abc&state=xyz", {
        rendererDevServerUrl: "http://localhost:5173/",
        packagedRendererUrl: "file:///app/out/renderer/index.html"
      })
    ).toBe("http://localhost:5173/callback?code=abc&state=xyz")

    expect(
      rendererAuthCallbackUrl("aether://auth/callback?code=abc", {
        packagedRendererUrl: "file:///app/out/renderer/index.html"
      })
    ).toBe("file:///app/out/renderer/index.html?code=abc")

    expect(
      rendererAuthCallbackUrl("https://example.test/callback?code=abc", {
        packagedRendererUrl: "file:///app/out/renderer/index.html"
      })
    ).toBeNull()
  })
})
