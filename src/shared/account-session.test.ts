import { describe, expect, it } from "vitest"
import { accountPartition, defaultAccountId, parseAuthCallbackState } from "./account-session"

describe("account session policy", () => {
  it("keeps the original account in the default Electron session", () => {
    expect(accountPartition(defaultAccountId)).toBeUndefined()
    expect(accountPartition("account-2")).toBe("persist:aether-account-account-2")
  })

  it("extracts the initiating window and account from an AuthKit callback", () => {
    const url = new URL("aether://auth/callback")
    url.searchParams.set("code", "code-1")
    url.searchParams.set(
      "state",
      JSON.stringify({
        aetherWindowId: "window-1",
        aetherAccountId: "account-2"
      })
    )

    expect(parseAuthCallbackState(url.toString())).toEqual({
      windowId: "window-1",
      accountId: "account-2"
    })
  })

  it("rejects missing, malformed, and incomplete callback state", () => {
    expect(parseAuthCallbackState("aether://auth/callback?code=abc")).toBeNull()
    expect(parseAuthCallbackState("aether://auth/callback?state=nope")).toBeNull()
    expect(
      parseAuthCallbackState(
        `aether://auth/callback?state=${encodeURIComponent(
          JSON.stringify({
            aetherWindowId: "window-1"
          })
        )}`
      )
    ).toBeNull()
  })
})
