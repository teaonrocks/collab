import { ConvexProviderWithAuthKit } from "@convex-dev/workos"
import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react"
import { ConvexReactClient } from "convex/react"
import type { ReactNode } from "react"
import { authKitRedirectUriForCurrentLocation } from "./authkit-redirect"
import { isDogfoodAuthConfigured } from "./dogfood-config"

let convexClient: ConvexReactClient | null = null

const getConvexClient = (url: string): ConvexReactClient => {
  convexClient ??= new ConvexReactClient(url)
  return convexClient
}

const hasValue = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0

export function DogfoodAuthProvider(props: { readonly children: ReactNode }) {
  if (!isDogfoodAuthConfigured()) {
    return <>{props.children}</>
  }

  const convexUrl = import.meta.env.VITE_CONVEX_URL
  const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID
  const configuredRedirectUri = import.meta.env.VITE_WORKOS_REDIRECT_URI

  if (!hasValue(convexUrl) || !hasValue(clientId) || !hasValue(configuredRedirectUri)) {
    return <>{props.children}</>
  }

  const redirectUri = authKitRedirectUriForCurrentLocation(configuredRedirectUri, window.location)

  return (
    <AuthKitProvider clientId={clientId} redirectUri={redirectUri}>
      <ConvexProviderWithAuthKit client={getConvexClient(convexUrl)} useAuth={useAuth}>
        {props.children}
      </ConvexProviderWithAuthKit>
    </AuthKitProvider>
  )
}
