import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { expectedConvexModules, generatedConvexModules } from "./check-convex-bindings.mjs"

describe("Convex generated binding validation", () => {
  it("finds nested function modules while excluding Convex entrypoints and tests", () => {
    const root = mkdtempSync(join(tmpdir(), "aether-convex-bindings-"))
    try {
      mkdirSync(join(root, "nested", "_generated"), { recursive: true })
      for (const file of ["chat.ts", "schema.ts", "chat.test.ts", "nested/search.ts", "nested/_generated/api.ts"]) {
        writeFileSync(join(root, file), "export {}\n")
      }

      expect(expectedConvexModules(root)).toEqual(["chat", "nested/search"])
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it("reads the module set committed in the generated API declaration", () => {
    expect(
      generatedConvexModules(`
      import type * as chat from "../chat.js";
      import type * as nested_search from "../nested/search.js";
    `)
    ).toEqual(["chat", "nested/search"])
  })
})
