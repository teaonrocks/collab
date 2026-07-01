import { execFileSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

const distDirectory = resolve("dist")
const appPath = existsSync(distDirectory)
  ? readdirSync(distDirectory)
      .filter((entry) => entry.startsWith("mac"))
      .map((entry) => resolve(distDirectory, entry, "Aether.app"))
      .find(existsSync)
  : undefined

if (appPath === undefined) {
  console.error("A packaged Aether.app was not found. Run `pnpm package:mac` first.")
  process.exitCode = 1
} else {
  execFileSync("/usr/bin/open", [appPath], { stdio: "inherit" })
}
