import { isAllowedExternalAuthUrl } from "../shared/auth-redirect-policy"

export type AetherShell = {
  readonly openExternal: (url: string) => Promise<void>
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
