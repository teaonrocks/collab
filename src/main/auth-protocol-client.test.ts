import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { authProtocolClientRegistration } from "./auth-protocol-client"

describe("authentication protocol client registration", () => {
  it("never lets the generic Electron development bundle claim aether links on macOS", () => {
    expect(authProtocolClientRegistration({
      argv: ["/path/to/Electron", "."],
      defaultApp: true,
      executablePath: "/path/to/Electron",
      packaged: false,
      platform: "darwin"
    })).toBeNull()
  })

  it("registers the uniquely identified packaged Aether bundle on macOS", () => {
    expect(authProtocolClientRegistration({
      argv: ["/Applications/Aether.app/Contents/MacOS/Aether"],
      defaultApp: false,
      executablePath: "/Applications/Aether.app/Contents/MacOS/Aether",
      packaged: true,
      platform: "darwin"
    })).toEqual({})
  })

  it("keeps the executable and app entrypoint registration used by development on Windows", () => {
    expect(authProtocolClientRegistration({
      argv: ["C:\\Electron.exe", "app"],
      defaultApp: true,
      executablePath: "C:\\Electron.exe",
      packaged: false,
      platform: "win32"
    })).toEqual({
      executablePath: "C:\\Electron.exe",
      args: [resolve("app")]
    })
  })
})
