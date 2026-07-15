import { execFile } from "node:child_process"
import { chmod, copyFile, mkdir, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath, URL } from "node:url"

const execFileAsync = promisify(execFile)
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))
const sourceRoot = join(projectRoot, "native", "macos", "AetherWebAuthHelper")
const outputApp = join(projectRoot, "build", "native", "AetherWebAuthHelper.app")
const outputContents = join(outputApp, "Contents")
const outputExecutable = join(outputContents, "MacOS", "AetherWebAuthHelper")
const architectures = ["arm64", "x86_64"]

if (process.platform !== "darwin") {
  console.log("Skipping the macOS authentication helper build on this platform.")
  process.exit(0)
}

await rm(outputApp, { recursive: true, force: true })
await mkdir(join(outputContents, "MacOS"), { recursive: true })
await copyFile(join(sourceRoot, "Info.plist"), join(outputContents, "Info.plist"))

const architectureExecutables = []
for (const architecture of architectures) {
  const executable = join(projectRoot, "build", "native", `AetherWebAuthHelper-${architecture}`)
  await execFileAsync("/usr/bin/xcrun", [
    "swiftc",
    "-parse-as-library",
    "-O",
    "-target",
    `${architecture}-apple-macosx12.0`,
    "-framework",
    "AppKit",
    "-framework",
    "AuthenticationServices",
    join(sourceRoot, "main.swift"),
    "-o",
    executable
  ])
  architectureExecutables.push(executable)
}

await execFileAsync("/usr/bin/xcrun", ["lipo", "-create", ...architectureExecutables, "-output", outputExecutable])
await Promise.all(architectureExecutables.map((executable) => rm(executable, { force: true })))
await chmod(outputExecutable, 0o755)
await execFileAsync("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", outputApp])
console.log(`Built ${outputApp}`)
