const hasValue = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0

export const isDogfoodAuthConfigured = (): boolean =>
  hasValue(import.meta.env.VITE_CONVEX_URL) &&
  hasValue(import.meta.env.VITE_WORKOS_CLIENT_ID) &&
  hasValue(import.meta.env.VITE_WORKOS_REDIRECT_URI)
