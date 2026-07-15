import type { WindowAccountContext } from "../shared/account-session"
import { accountContextChangedChannel } from "../shared/account-session"

type AccountContextRegistry = {
  readonly context: (windowId: string, currentAccountId: string) => WindowAccountContext
}

export type AccountContextWindowRecord = {
  readonly id: string
  readonly accountId: string
  readonly window: {
    readonly webContents: {
      readonly send: (channel: string, context: WindowAccountContext) => void
    }
    readonly isDestroyed: () => boolean
  }
}

export const broadcastAccountContexts = (
  registry: AccountContextRegistry,
  records: Iterable<AccountContextWindowRecord>
): void => {
  for (const record of records) {
    if (record.window.isDestroyed()) continue
    record.window.webContents.send(
      accountContextChangedChannel,
      registry.context(record.id, record.accountId)
    )
  }
}
