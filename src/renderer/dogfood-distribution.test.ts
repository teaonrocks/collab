import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const readRepoFile = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")

describe("friend dogfood distribution", () => {
  it("ships public renderer values for the named shared production deployment", () => {
    const exampleEnv = readRepoFile(".env.example")

    expect(exampleEnv).toContain(
      "VITE_CONVEX_URL=https://polished-bison-174.convex.cloud"
    )
    expect(exampleEnv).toMatch(/^VITE_WORKOS_CLIENT_ID=client_/m)
    expect(exampleEnv).toContain("VITE_WORKOS_REDIRECT_URI=aether://auth/callback")
    expect(exampleEnv).not.toMatch(/^CONVEX_(?:DEPLOYMENT|DEPLOY_KEY)=/m)
    expect(exampleEnv).not.toMatch(/^(?:WORKOS_API_KEY|AETHER_ALLOWLIST_OPERATOR_KEY)=/m)
  })

  it("keeps tester startup separate from operator deployment", () => {
    const guide = readRepoFile("docs/dogfood-distribution.md")
    const testerSection = guide.split("## Deployment Operator Runbook", 1)[0]

    expect(testerSection).toContain("polished-bison-174")
    expect(testerSection).toContain("pnpm dev")
    expect(testerSection).not.toContain("pnpm convex:dev\n")
    expect(guide).toContain("pnpm convex deploy")
    expect(guide).toContain("pnpm convex env set --prod")
    expect(guide).toContain("### Rollback")
  })
})
