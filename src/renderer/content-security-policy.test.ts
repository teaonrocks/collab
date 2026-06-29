import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { productionContentSecurityPolicy } from "./content-security-policy"

describe("production renderer Content Security Policy", () => {
  it("blocks fallback sources and permits only required service and attachment origins", () => {
    expect(productionContentSecurityPolicy).toContain("default-src 'self'")
    expect(productionContentSecurityPolicy).toContain("object-src 'none'")
    expect(productionContentSecurityPolicy).toContain("frame-ancestors 'none'")
    expect(productionContentSecurityPolicy).toContain("https://*.convex.cloud")
    expect(productionContentSecurityPolicy).toContain("wss://*.convex.cloud")
    expect(productionContentSecurityPolicy).toContain("https://*.workos.com")
    expect(productionContentSecurityPolicy).toContain("https://*.authkit.app")
    expect(productionContentSecurityPolicy).not.toContain("http:")
    expect(productionContentSecurityPolicy).not.toMatch(/(?:^|\s)https:(?:\s|;|$)/)
    expect(productionContentSecurityPolicy).not.toContain("unsafe-eval")
  })

  it("is installed in the renderer document through the build-time policy token", async () => {
    const html = await readFile(new URL("./index.html", import.meta.url), "utf8")
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toContain('__AETHER_CONTENT_SECURITY_POLICY__')
  })
})
