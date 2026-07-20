import { isAuthCallbackUrl } from "../shared/auth-redirect-policy"

const hasAuthCode = (location: Pick<Location, "search">): boolean => {
  const searchParams = new URLSearchParams(location.search)
  return searchParams.has("code")
}

const withoutSearchOrHash = (rawUrl: string): string => {
  const url = new URL(rawUrl)
  url.search = ""
  url.hash = ""
  return url.toString()
}

export const authKitRedirectUriForCurrentLocation = (
  configuredRedirectUri: string,
  location: Pick<Location, "href" | "search">
): string => {
  if (!isAuthCallbackUrl(configuredRedirectUri) || !hasAuthCode(location)) {
    return configuredRedirectUri
  }

  return withoutSearchOrHash(location.href)
}

export const authKitProviderOptionsForCurrentLocation = (
  configuredRedirectUri: string,
  location: Pick<Location, "href" | "protocol" | "search">
): { readonly redirectUri: string; readonly devMode?: true } => ({
  redirectUri: authKitRedirectUriForCurrentLocation(configuredRedirectUri, location),
  // AuthKit's production mode relies on web-origin refresh cookies. A packaged
  // file renderer instead needs its persistent local-storage token mode.
  ...(location.protocol === "file:" ? { devMode: true as const } : {})
})

export const authKitSignOutReturnTo = (location: Pick<Location, "href"> = window.location): string =>
  withoutSearchOrHash(location.href)
