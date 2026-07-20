export const authCallbackScheme = "aether"

const authCallbackProtocol = `${authCallbackScheme}:`
const authCallbackHost = "auth"
const authCallbackPath = "/callback"
const authAuthorizePath = "/user_management/authorize"
const workOsAuthHost = "api.workos.com"
const authKitRootHost = "authkit.app"

export type RendererAuthCallbackTarget = {
  readonly rendererDevServerUrl?: string
  readonly packagedRendererUrl: string
}

export const parseAuthCallbackUrl = (rawUrl: string): URL | null => {
  try {
    const url = new URL(rawUrl)
    if (
      url.protocol !== authCallbackProtocol ||
      url.hostname !== authCallbackHost ||
      url.pathname !== authCallbackPath ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.hash !== ""
    ) {
      return null
    }
    return url
  } catch {
    return null
  }
}

export const isAuthCallbackUrl = (rawUrl: string): boolean => parseAuthCallbackUrl(rawUrl) !== null

export const findAuthCallbackUrl = (argv: ReadonlyArray<string>): string | null => argv.find(isAuthCallbackUrl) ?? null

const isLocalDevHost = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"

const isAuthKitHost = (hostname: string): boolean =>
  hostname === authKitRootHost || hostname.endsWith(`.${authKitRootHost}`)

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

export const isAllowedExternalAuthUrl = (rawUrl: string): boolean => {
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

export const rendererAuthCallbackUrl = (rawUrl: string, target: RendererAuthCallbackTarget): string | null => {
  const callback = parseAuthCallbackUrl(rawUrl)
  if (callback === null) return null

  const targetUrl =
    target.rendererDevServerUrl !== undefined
      ? new URL(authCallbackPath, target.rendererDevServerUrl)
      : new URL(target.packagedRendererUrl)
  targetUrl.search = callback.search
  return targetUrl.toString()
}
