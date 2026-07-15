import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import { nativeAuthHelperExecutable, runNativeAuthSession } from "./native-auth-session"

class FakeChildProcess extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kill = vi.fn(() => true)
}

const signInUrl = (): string => {
  const url = new URL("https://api.workos.com/user_management/authorize")
  url.searchParams.set("provider", "authkit")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", "client_123")
  url.searchParams.set("redirect_uri", "aether://auth/callback")
  return url.toString()
}

const launchWith = (child: FakeChildProcess) =>
  vi.fn(() => child as unknown as ChildProcessWithoutNullStreams)

describe.runIf(process.platform === "darwin")("native authentication session", () => {
  it("sends an ephemeral AuthKit request over stdin and returns its native callback", async () => {
    const child = new FakeChildProcess()
    const input: Buffer[] = []
    child.stdin.on("data", (chunk: Buffer) => input.push(chunk))
    const result = runNativeAuthSession(signInUrl(), "/path/to/helper", launchWith(child))

    child.stdout.write('{"type":"started"}\n')
    child.stdout.write('{"type":"completed","callbackURL":"aether://auth/callback?code=abc"}\n')

    await expect(result).resolves.toBe("aether://auth/callback?code=abc")
    expect(JSON.parse(Buffer.concat(input).toString())).toEqual({
      authorizationURL: signInUrl(),
      callbackScheme: "aether",
      ephemeral: true
    })
  })

  it("treats closing the native session as cancellation", async () => {
    const child = new FakeChildProcess()
    const result = runNativeAuthSession(signInUrl(), "/path/to/helper", launchWith(child))

    child.stdout.write('{"type":"cancelled"}\n')

    await expect(result).resolves.toBeNull()
  })

  it("rejects unsafe authorization URLs and callbacks", async () => {
    const launch = vi.fn()
    await expect(runNativeAuthSession("https://example.com/phishing", "/path/to/helper", launch)).rejects.toThrow("unsupported external URL")
    expect(launch).not.toHaveBeenCalled()

    const child = new FakeChildProcess()
    const result = runNativeAuthSession(signInUrl(), "/path/to/helper", launchWith(child))
    child.stdout.write('{"type":"completed","callbackURL":"https://example.com/callback"}\n')
    await expect(result).rejects.toThrow("invalid callback URL")
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it("resolves development and packaged helper locations", () => {
    expect(nativeAuthHelperExecutable({
      appPath: "/project",
      resourcesPath: "/Aether.app/Contents/Resources",
      packaged: false
    })).toBe("/project/build/native/AetherWebAuthHelper.app/Contents/MacOS/AetherWebAuthHelper")
    expect(nativeAuthHelperExecutable({
      appPath: "/project",
      resourcesPath: "/Aether.app/Contents/Resources",
      packaged: true
    })).toBe("/Aether.app/Contents/Resources/native/AetherWebAuthHelper.app/Contents/MacOS/AetherWebAuthHelper")
  })
})
