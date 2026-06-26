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

export const authKitSignOutReturnTo = (location: Pick<Location, "href"> = window.location): string =>
  withoutSearchOrHash(location.href)
