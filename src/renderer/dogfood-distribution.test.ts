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
    expect(testerSection).toContain("pnpm package:mac")
    expect(testerSection).toContain("pnpm start:mac")
    expect(testerSection).not.toContain("pnpm convex:dev\n")
    expect(guide).toContain("pnpm convex deploy")
    expect(guide).toContain("pnpm convex env set --prod")
    expect(guide).toContain("### Rollback")
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

  it("defines one complete automated release command", () => {
    const manifest = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>
    }

    expect(manifest.scripts["convex:check"]).toContain("tsc -p convex/tsconfig.json")
    expect(manifest.scripts["convex:check"]).toContain("check-convex-bindings.mjs")
    expect(manifest.scripts.lint).toContain("eslint .")
    expect(manifest.scripts.lint).toContain("knip --dependencies")
    expect(manifest.scripts["dogfood:verify"]).toBe(
      "pnpm typecheck && pnpm convex:check && pnpm lint && pnpm test && pnpm build"
    )
  })

  it("runs the release command in CI after a frozen install on the pinned toolchain", () => {
    const workflow = readRepoFile(".github/workflows/release-gate.yml")

    expect(workflow).toContain("node-version-file: .nvmrc")
    expect(workflow).toContain("pnpm install --frozen-lockfile")
    expect(workflow).toContain("pnpm dogfood:verify")
    expect(workflow).toContain("runs-on: macos-14")
    expect(workflow).toContain("pnpm package:mac")
  })

  it("documents immutable remote handoff and credential-free two-account evidence", () => {
    const guide = readRepoFile("docs/dogfood-distribution.md")
    const smoke = readRepoFile("docs/dogfood-smoke-test.md")
    const readme = readRepoFile("README.md")

    expect(guide).toContain('test -z "$(git status --porcelain)"')
    expect(guide).toContain("git ls-remote --exit-code origin")
    expect(guide).toContain("git tag -a")
    expect(guide).toContain("tested commit, tag, branch, CI run URL")
    expect(smoke).toContain("Use two different allowlisted accounts")
    expect(smoke).toContain("Exact tested Git commit, immutable friend-beta tag, CI run URL")
    expect(smoke).toContain("created a private channel with Tester B as an initial invitee")
    expect(smoke).toContain("created a second private channel alone, then added Tester B later")
    expect(smoke).toContain("Tester A removed Tester B")
    expect(smoke).toContain("Do not mark this record complete from automated tests alone")
    expect(smoke).not.toContain("private channels remain deferred")
    expect(smoke).not.toContain("CONVEX_DEPLOY_KEY=")
    expect(readRepoFile("docs/architecture-decisions.md")).toContain(
      "Treat Private Channels As Explicit Membership Boundaries"
    )
    expect(readme).toContain("active runtime uses")
    expect(readme).toContain("does not fall back to the local JSON chat")
  })
})
