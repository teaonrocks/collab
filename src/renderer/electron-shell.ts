export type AetherShell = {
  readonly openExternal: (url: string) => Promise<void>
}

const authCallbackProtocol = "aether:"
const authCallbackHost = "auth"
const authCallbackPath = "/callback"
const authAuthorizePath = "/user_management/authorize"
const workOsAuthHost = "api.workos.com"
const authKitRootHost = "authkit.app"

declare global {
  interface Window {
    readonly aetherShell?: AetherShell
  }
}

const isLocalDevHost = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"

const isAuthKitHost = (hostname: string): boolean =>
  hostname === authKitRootHost || hostname.endsWith(`.${authKitRootHost}`)

const isAuthCallbackUrl = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === authCallbackProtocol &&
      url.hostname === authCallbackHost &&
      url.pathname === authCallbackPath &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.hash === ""
    )
  } catch {
    return false
  }
}

const isAllowedRedirectUri = (rawUrl: string | null): boolean => {
  if (rawUrl === null) return false
  if (isAuthCallbackUrl(rawUrl)) return true

  try {
    const url = new URL(rawUrl)
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      isLocalDevHost(url.hostname) &&
      url.pathname === authCallbackPath &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    )
  } catch {
    return false
  }
}

export const isSafeExternalAuthUrl = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl)
    if (
      url.pathname !== authAuthorizePath ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.searchParams.get("provider") !== "authkit" ||
      url.searchParams.get("response_type") !== "code" ||
      !url.searchParams.get("client_id")?.startsWith("client_") ||
      !isAllowedRedirectUri(url.searchParams.get("redirect_uri"))
    ) {
      return false
    }

    if (isLocalDevHost(url.hostname)) {
      return url.protocol === "http:" || url.protocol === "https:"
    }

    return url.protocol === "https:" && (url.hostname === workOsAuthHost || isAuthKitHost(url.hostname))
  } catch {
    return false
  }
}

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
