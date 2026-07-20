import { readdirSync, readFileSync } from "node:fs"
import { relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const ignoredModules = new Set(["auth.config", "convex.config", "crons", "http", "schema"])

export const expectedConvexModules = (convexDir) => {
  const visit = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const absolute = resolve(directory, entry.name)
      if (entry.isDirectory()) return entry.name === "_generated" ? [] : visit(absolute)
      if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name) || /\.test\.[cm]?[jt]sx?$/.test(entry.name)) return []

      const moduleName = relative(convexDir, absolute)
        .split(sep)
        .join("/")
        .replace(/\.[cm]?[jt]sx?$/, "")
      return ignoredModules.has(moduleName) ? [] : [moduleName]
    })

  return visit(convexDir).sort()
}

export const generatedConvexModules = (apiDeclaration) =>
  [...apiDeclaration.matchAll(/import type \* as \S+ from "\.\.\/(.+)\.js";/g)].map((match) => match[1]).sort()

export const staleConvexBindings = (convexDir) => {
  const expected = expectedConvexModules(convexDir)
  const generated = generatedConvexModules(readFileSync(resolve(convexDir, "_generated/api.d.ts"), "utf8"))
  return {
    missing: expected.filter((moduleName) => !generated.includes(moduleName)),
    removed: generated.filter((moduleName) => !expected.includes(moduleName))
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const convexDir = resolve(process.cwd(), "convex")
  const stale = staleConvexBindings(convexDir)
  if (stale.missing.length > 0 || stale.removed.length > 0) {
    console.error(
      "Convex generated bindings are stale. Run `pnpm convex:codegen` with deployment access and commit the result."
    )
    if (stale.missing.length > 0) console.error(`Missing modules: ${stale.missing.join(", ")}`)
    if (stale.removed.length > 0) console.error(`Removed modules: ${stale.removed.join(", ")}`)
    process.exitCode = 1
  }
}
