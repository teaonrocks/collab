import { describe, expect, it, vi } from "vitest"
import {
  retireAccountWindow,
  revealReplacementThenRetire,
  selectActiveWindowRecord,
  type ManagedAccountWindow
} from "./account-window-lifecycle"

const makeWindow = (): ManagedAccountWindow => {
  let destroyed = false
  return {
    isDestroyed: vi.fn(() => destroyed),
    show: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(() => {
      destroyed = true
    })
  }
}

describe("account window lifecycle", () => {
  it("uses the last-focused window when the application has no focused window", () => {
    const first = { accountId: "account-1" }
    const second = { accountId: "account-2" }
    const records = new Map([[1, first], [2, second]])

    expect(selectActiveWindowRecord(records, null, 1)).toBe(first)
    expect(selectActiveWindowRecord(records, null, null)).toBeNull()
  })

  it("reveals a loaded replacement before retiring its source", async () => {
    const source = makeWindow()
    const replacement = makeWindow()
    const loadReplacement = vi.fn().mockResolvedValue(undefined)

    await expect(revealReplacementThenRetire({ source, replacement, loadReplacement })).resolves.toBe(replacement)

    expect(replacement.show).toHaveBeenCalledTimes(1)
    expect(source.hide).toHaveBeenCalledTimes(1)
    expect(source.destroy).toHaveBeenCalledTimes(1)
  })

  it("keeps the source usable and destroys a replacement that fails to load", async () => {
    const source = makeWindow()
    const replacement = makeWindow()

    await expect(revealReplacementThenRetire({
      source,
      replacement,
      loadReplacement: () => Promise.reject(new Error("renderer unavailable"))
    })).rejects.toThrow("renderer unavailable")

    expect(source.hide).not.toHaveBeenCalled()
    expect(source.destroy).not.toHaveBeenCalled()
    expect(replacement.hide).toHaveBeenCalledTimes(1)
    expect(replacement.destroy).toHaveBeenCalledTimes(1)
  })

  it("retires an authenticated window immediately", () => {
    const window = makeWindow()

    retireAccountWindow(window)

    expect(window.hide).toHaveBeenCalledTimes(1)
    expect(window.destroy).toHaveBeenCalledTimes(1)
  })
})
