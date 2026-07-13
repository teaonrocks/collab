import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import {
  defaultAccountId,
  type AccountProfile,
  type AccountSummary,
  type WindowAccountContext
} from "../shared/account-session"

type StoredAccount = {
  readonly id: string
  readonly createdAt: number
  readonly lastUsedAt: number
  readonly profile: AccountProfile | null
}

type StoredRegistry = {
  readonly version: 1
  readonly accounts: ReadonlyArray<StoredAccount>
}

export type AccountRegistry = {
  readonly initialize: () => Promise<void>
  readonly has: (accountId: string) => boolean
  readonly isPending: (accountId: string) => boolean
  readonly create: () => Promise<string>
  readonly touch: (accountId: string) => Promise<void>
  readonly updateProfile: (accountId: string, profile: AccountProfile) => Promise<string | null>
  readonly remove: (accountId: string) => Promise<void>
  readonly reset: () => Promise<void>
  readonly preferredAccountId: (excluding?: string) => string
  readonly accountIds: () => ReadonlyArray<string>
  readonly context: (windowId: string, currentAccountId: string) => WindowAccountContext
}

const isProfile = (value: unknown): value is AccountProfile => {
  if (typeof value !== "object" || value === null) return false
  return "userId" in value && typeof value.userId === "string" && value.userId.length > 0 &&
    "displayName" in value && typeof value.displayName === "string" && value.displayName.length > 0 &&
    "email" in value && typeof value.email === "string" && value.email.length > 0 &&
    "avatarUrl" in value && (typeof value.avatarUrl === "string" || value.avatarUrl === null)
}

const parseRegistry = (raw: string): ReadonlyArray<StoredAccount> => {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed) || parsed.version !== 1 || !("accounts" in parsed) || !Array.isArray(parsed.accounts)) {
      return []
    }
    return parsed.accounts.flatMap((account): ReadonlyArray<StoredAccount> => {
      if (
        typeof account !== "object" || account === null ||
        !("id" in account) || typeof account.id !== "string" || account.id.length === 0 ||
        !("createdAt" in account) || typeof account.createdAt !== "number" ||
        !("lastUsedAt" in account) || typeof account.lastUsedAt !== "number" ||
        !("profile" in account) || (account.profile !== null && !isProfile(account.profile))
      ) {
        return []
      }
      return [{
        id: account.id,
        createdAt: account.createdAt,
        lastUsedAt: account.lastUsedAt,
        profile: account.profile
      }]
    })
  } catch {
    return []
  }
}

const blankAccount = (id: string, now: number): StoredAccount => ({
  id,
  createdAt: now,
  lastUsedAt: now,
  profile: null
})

export const createAccountRegistry = (filePath: string, now: () => number = Date.now): AccountRegistry => {
  let accounts: ReadonlyArray<StoredAccount> = []
  const pendingAccountIds = new Set<string>()
  let persistQueue = Promise.resolve()

  const persist = (): Promise<void> => {
    const registry: StoredRegistry = {
      version: 1,
      accounts: accounts.filter((account) => !pendingAccountIds.has(account.id))
    }
    persistQueue = persistQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(filePath), { recursive: true })
      const temporaryPath = `${filePath}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
      await rename(temporaryPath, filePath)
    })
    return persistQueue
  }

  const ensureAccount = (): string => {
    if (accounts.length > 0) return accounts[0]!.id
    const timestamp = now()
    accounts = [blankAccount(defaultAccountId, timestamp)]
    return defaultAccountId
  }

  return {
    initialize: async () => {
      try {
        accounts = parseRegistry(await readFile(filePath, "utf8"))
          .filter((account) => account.id === defaultAccountId || account.profile !== null)
      } catch {
        accounts = []
      }
      pendingAccountIds.clear()
      ensureAccount()
      await persist()
    },
    has: (accountId) => accounts.some((account) => account.id === accountId),
    isPending: (accountId) => pendingAccountIds.has(accountId),
    create: async () => {
      const timestamp = now()
      const accountId = randomUUID()
      accounts = [...accounts, blankAccount(accountId, timestamp)]
      pendingAccountIds.add(accountId)
      return accountId
    },
    touch: async (accountId) => {
      if (!accounts.some((account) => account.id === accountId)) return
      accounts = accounts.map((account) => account.id === accountId
        ? { ...account, lastUsedAt: now() }
        : account)
      await persist()
    },
    updateProfile: async (accountId, profile) => {
      const duplicate = accounts.find((account) => account.id !== accountId && account.profile?.userId === profile.userId)
      pendingAccountIds.delete(accountId)
      if (duplicate !== undefined) pendingAccountIds.delete(duplicate.id)
      accounts = accounts
        .filter((account) => account.id !== duplicate?.id)
        .map((account) => account.id === accountId
          ? { ...account, profile, lastUsedAt: now() }
          : account)
      await persist()
      return duplicate?.id ?? null
    },
    remove: async (accountId) => {
      pendingAccountIds.delete(accountId)
      accounts = accounts.filter((account) => account.id !== accountId)
      ensureAccount()
      await persist()
    },
    reset: async () => {
      pendingAccountIds.clear()
      accounts = [blankAccount(defaultAccountId, now())]
      await persist()
    },
    preferredAccountId: (excluding) => {
      ensureAccount()
      return [...accounts]
        .filter((account) => account.id !== excluding)
        .sort((left, right) => right.lastUsedAt - left.lastUsedAt)[0]?.id ?? defaultAccountId
    },
    accountIds: () => accounts.map((account) => account.id),
    context: (windowId, currentAccountId) => ({
      windowId,
      currentAccountId,
      accounts: [...accounts]
        .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
        .map<AccountSummary>((account) => ({
          id: account.id,
          displayName: account.profile?.displayName ?? "Sign in",
          email: account.profile?.email ?? null,
          avatarUrl: account.profile?.avatarUrl ?? null,
          current: account.id === currentAccountId
        }))
    })
  }
}
