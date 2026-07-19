import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const readRepoFile = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")

describe("friend dogfood distribution", () => {
  it("ships only public renderer configuration", () => {
    const entries = Object.fromEntries(readRepoFile(".env.example")
      .split("\n")
      .filter((line) => line.trim().length > 0 && !line.startsWith("#"))
      .map((line) => line.split("=", 2)))

    expect(entries).toEqual({
      VITE_CONVEX_URL: "https://polished-bison-174.convex.cloud",
      VITE_WORKOS_CLIENT_ID: expect.stringMatching(/^client_/),
      VITE_WORKOS_REDIRECT_URI: "aether://auth/callback",
      VITE_AETHER_SHOW_AGENT_UI: "false"
    })
  })

  it("packages a uniquely identified macOS callback handler", () => {
    const manifest = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>
      build: {
        appId: string
        protocols: ReadonlyArray<{ schemes: ReadonlyArray<string> }>
      }
    }

    expect(manifest.scripts["package:mac"]).toContain("electron-builder --mac dir")
    expect(manifest.build.appId).toBe("com.aether.chat")
    expect(manifest.build.protocols.some(({ schemes }) => schemes.includes("aether"))).toBe(true)
  })

})
