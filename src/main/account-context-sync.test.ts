import { describe, expect, it, vi } from "vitest"
import { accountContextChangedChannel, type WindowAccountContext } from "../shared/account-session"
import { broadcastAccountContexts, type AccountContextWindowRecord } from "./account-context-sync"

const record = (
  id: string,
  accountId: string,
  send: (channel: string, context: WindowAccountContext) => void,
  destroyed = false
): AccountContextWindowRecord => ({
  id,
  accountId,
  window: { isDestroyed: () => destroyed, webContents: { send } }
})

describe("account context synchronization", () => {
  it("broadcasts a window-specific current account with the shared account list", () => {
    const firstSend = vi.fn()
    const secondSend = vi.fn()
    const context = vi.fn((windowId: string, currentAccountId: string): WindowAccountContext => ({
      windowId,
      currentAccountId,
      accounts: [
        {
          id: "default",
          displayName: "Maya",
          email: "maya@example.com",
          avatarUrl: null,
          current: currentAccountId === "default",
          pending: false
        },
        {
          id: "account-2",
          displayName: "Archer",
          email: "archer@example.com",
          avatarUrl: null,
          current: currentAccountId === "account-2",
          pending: false
        }
      ]
    }))

    broadcastAccountContexts({ context }, [
      record("window-1", "default", firstSend),
      record("window-2", "account-2", secondSend)
    ])

    expect(firstSend).toHaveBeenCalledWith(
      accountContextChangedChannel,
      expect.objectContaining({
        windowId: "window-1",
        currentAccountId: "default",
        accounts: expect.arrayContaining([expect.objectContaining({ id: "default", current: true })])
      })
    )
    expect(secondSend).toHaveBeenCalledWith(
      accountContextChangedChannel,
      expect.objectContaining({
        windowId: "window-2",
        currentAccountId: "account-2",
        accounts: expect.arrayContaining([expect.objectContaining({ id: "account-2", current: true })])
      })
    )
  })

  it("does not send account updates to destroyed windows", () => {
    const send = vi.fn()

    broadcastAccountContexts(
      { context: vi.fn(() => ({ windowId: "closed", currentAccountId: "default", accounts: [] })) },
      [record("closed", "default", send, true)]
    )

    expect(send).not.toHaveBeenCalled()
  })
})
