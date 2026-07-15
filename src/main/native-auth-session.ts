import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { join } from "node:path"
import { authCallbackScheme, isAllowedExternalAuthUrl, isAuthCallbackUrl } from "../shared/auth-redirect-policy"

type NativeAuthenticationEvent =
  | { readonly type: "started" }
  | { readonly type: "completed"; readonly callbackURL: string }
  | { readonly type: "cancelled" }
  | { readonly type: "error"; readonly message?: string }

type SpawnNativeAuthHelper = (executablePath: string) => ChildProcessWithoutNullStreams

const activeSessions = new Set<ChildProcessWithoutNullStreams>()
const maximumOutputLength = 64 * 1024
const authenticationTimeoutMs = 15 * 60 * 1_000

const spawnNativeAuthHelper: SpawnNativeAuthHelper = (executablePath) =>
  spawn(executablePath, [], { stdio: ["pipe", "pipe", "pipe"] })

export const nativeAuthHelperExecutable = ({
  appPath,
  resourcesPath,
  packaged
}: {
  readonly appPath: string
  readonly resourcesPath: string
  readonly packaged: boolean
}): string => packaged
  ? join(resourcesPath, "native", "AetherWebAuthHelper.app", "Contents", "MacOS", "AetherWebAuthHelper")
  : join(appPath, "build", "native", "AetherWebAuthHelper.app", "Contents", "MacOS", "AetherWebAuthHelper")

const parseAuthenticationEvent = (rawEvent: string): NativeAuthenticationEvent => {
  const value: unknown = JSON.parse(rawEvent)
  if (typeof value !== "object" || value === null || !("type" in value)) {
    throw new Error("The native authentication helper returned an invalid response.")
  }
  if (value.type === "started" || value.type === "cancelled") return { type: value.type }
  if (value.type === "completed" && "callbackURL" in value && typeof value.callbackURL === "string") {
    return { type: "completed", callbackURL: value.callbackURL }
  }
  if (value.type === "error") {
    const message = "message" in value && typeof value.message === "string"
      ? value.message.slice(0, 1_000)
      : undefined
    return { type: "error", ...(message === undefined ? {} : { message }) }
  }
  throw new Error("The native authentication helper returned an invalid response.")
}

export const runNativeAuthSession = (
  rawUrl: string,
  executablePath: string,
  launch: SpawnNativeAuthHelper = spawnNativeAuthHelper,
  timeoutMs = authenticationTimeoutMs
): Promise<string | null> => {
  if (!isAllowedExternalAuthUrl(rawUrl)) {
    return Promise.reject(new Error("Refusing to open unsupported external URL."))
  }
  if (process.platform !== "darwin") {
    return Promise.reject(new Error("Native account sign-in is currently supported only on macOS."))
  }

  return new Promise((resolve, reject) => {
    const child = launch(executablePath)
    activeSessions.add(child)
    let settled = false
    let output = ""
    let errorOutput = ""

    const timeout = setTimeout(() => {
      finish(new Error("The native authentication session timed out."))
      child.kill()
    }, timeoutMs)

    const finish = (result: string | null | Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      activeSessions.delete(child)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      if (settled) return
      output += chunk.toString()
      if (output.length > maximumOutputLength) {
        finish(new Error("The native authentication helper returned too much data."))
        child.kill()
        return
      }

      let newline = output.indexOf("\n")
      while (newline >= 0 && !settled) {
        const line = output.slice(0, newline).trim()
        output = output.slice(newline + 1)
        if (line.length > 0) {
          try {
            const event = parseAuthenticationEvent(line)
            if (event.type === "completed") {
              if (!isAuthCallbackUrl(event.callbackURL)) {
                throw new Error("The native authentication helper returned an invalid callback URL.")
              }
              finish(event.callbackURL)
            } else if (event.type === "cancelled") {
              finish(null)
            } else if (event.type === "error") {
              finish(new Error(event.message ?? "The native authentication session failed."))
            }
          } catch (cause) {
            finish(cause instanceof Error ? cause : new Error("The native authentication helper returned an invalid response."))
            child.kill()
          }
        }
        newline = output.indexOf("\n")
      }
    })

    child.stderr.on("data", (chunk: Buffer | string) => {
      errorOutput = (errorOutput + chunk.toString()).slice(-8_192)
    })
    child.stdin.on("error", (cause) => finish(cause))
    child.once("error", (cause) => finish(cause))
    child.once("exit", (code, signal) => {
      activeSessions.delete(child)
      if (settled) return
      const diagnostic = errorOutput.trim()
      finish(new Error(diagnostic.length > 0
        ? `The native authentication helper failed: ${diagnostic}`
        : `The native authentication helper exited before sign-in completed (${signal ?? code ?? "unknown"}).`))
    })

    child.stdin.end(JSON.stringify({
      authorizationURL: rawUrl,
      callbackScheme: authCallbackScheme,
      ephemeral: true
    }))
  })
}

export const cancelNativeAuthSessions = (): void => {
  for (const child of activeSessions) child.kill()
  activeSessions.clear()
}
