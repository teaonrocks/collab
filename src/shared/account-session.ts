export const defaultAccountId = "default"
export const accountContextChangedChannel = "aether:accounts-changed"

export type AccountProfile = {
  readonly userId: string
  readonly displayName: string
  readonly email: string
  readonly avatarUrl: string | null
}

export type AccountSummary = {
  readonly id: string
  readonly displayName: string
  readonly email: string | null
  readonly avatarUrl: string | null
  readonly current: boolean
  readonly pending: boolean
}

export type WindowAccountContext = {
  readonly windowId: string
  readonly currentAccountId: string
  readonly accounts: ReadonlyArray<AccountSummary>
}

export type AuthCallbackState = {
  readonly windowId: string
  readonly accountId: string
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

export const parseAuthCallbackState = (rawUrl: string): AuthCallbackState | null => {
  try {
    const state = new URL(rawUrl).searchParams.get("state")
    if (state === null) return null
    const parsed: unknown = JSON.parse(state)
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("aetherWindowId" in parsed) ||
      !("aetherAccountId" in parsed) ||
      !isNonEmptyString(parsed.aetherWindowId) ||
      !isNonEmptyString(parsed.aetherAccountId)
    ) {
      return null
    }
    return {
      windowId: parsed.aetherWindowId,
      accountId: parsed.aetherAccountId
    }
  } catch {
    return null
  }
}

export const accountPartition = (accountId: string): string | undefined =>
  accountId === defaultAccountId ? undefined : `persist:aether-account-${accountId}`
