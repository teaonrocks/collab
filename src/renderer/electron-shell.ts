import { isAllowedExternalAuthUrl } from "../shared/auth-redirect-policy"
import type { AccountProfile, WindowAccountContext } from "../shared/account-session"

export type AetherShell = {
  readonly openExternal: (url: string) => Promise<void>
  readonly openNativeAuth: (url: string) => Promise<void>
  readonly accountContext: () => Promise<WindowAccountContext>
  readonly onAccountContextChanged?: (listener: (context: WindowAccountContext) => void) => () => void
  readonly updateAccountProfile: (profile: AccountProfile) => Promise<WindowAccountContext>
  readonly switchAccount: (accountId: string) => Promise<void>
  readonly addAccount: () => Promise<void>
  readonly removeCurrentAccount: () => Promise<void>
  readonly signOutAllAccounts: () => Promise<void>
}

declare global {
  interface Window {
    readonly aetherShell?: AetherShell
  }
}

export const isSafeExternalAuthUrl = isAllowedExternalAuthUrl

export const openExternalUrl = (url: string): Promise<void> => {
  if (window.aetherShell !== undefined) {
    return window.aetherShell.openExternal(url)
  }

  if (!isSafeExternalAuthUrl(url)) {
    return Promise.reject(new Error("Refusing to navigate to unsupported external URL."))
  }

  window.location.assign(url)
  return Promise.resolve()
}

export const openNativeAuthUrl = (url: string): Promise<void> =>
  window.aetherShell?.openNativeAuth(url) ?? Promise.reject(new Error("Native account sign-in requires the Aether desktop app."))

export const getWindowAccountContext = (): Promise<WindowAccountContext | null> =>
  window.aetherShell?.accountContext() ?? Promise.resolve(null)

export const subscribeToWindowAccountContext = (
  listener: (context: WindowAccountContext) => void
): (() => void) => window.aetherShell?.onAccountContextChanged?.(listener) ?? (() => {})

export const updateWindowAccountProfile = (profile: AccountProfile): Promise<WindowAccountContext | null> =>
  window.aetherShell?.updateAccountProfile(profile) ?? Promise.resolve(null)

export const switchWindowAccount = (accountId: string): Promise<void> =>
  window.aetherShell?.switchAccount(accountId) ?? Promise.reject(new Error("Account switching requires the Aether desktop app."))

export const addWindowAccount = (): Promise<void> =>
  window.aetherShell?.addAccount() ?? Promise.reject(new Error("Adding accounts requires the Aether desktop app."))

export const removeCurrentWindowAccount = (): Promise<void> =>
  window.aetherShell?.removeCurrentAccount() ?? Promise.reject(new Error("Removing accounts requires the Aether desktop app."))

export const signOutAllWindowAccounts = (): Promise<void> =>
  window.aetherShell?.signOutAllAccounts() ?? Promise.reject(new Error("Signing out all accounts requires the Aether desktop app."))
