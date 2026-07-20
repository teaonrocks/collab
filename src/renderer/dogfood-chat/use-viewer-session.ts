import { useAuth } from "@workos-inc/authkit-react"
import { useAction, useConvexAuth } from "convex/react"
import { useEffect, useState } from "react"
import { api } from "../../../convex/_generated/api"

export function useViewerSession(blocked: boolean, onFailure: (cause: unknown) => void) {
  const auth = useAuth()
  const convexAuth = useConvexAuth()
  const ensureViewer = useAction(api.chat.ensureViewer)
  const [ensuredUserId, setEnsuredUserId] = useState<string | null>(null)
  const [ensureAttempt, setEnsureAttempt] = useState(0)
  const authUserId = auth.user?.id ?? null
  const sessionReady = authUserId !== null && convexAuth.isAuthenticated
  const viewerReady = sessionReady && ensuredUserId === authUserId && !blocked
  const status = auth.isLoading
    ? "auth-loading"
    : auth.user === null
      ? "signed-out"
      : !convexAuth.isAuthenticated
        ? "convex-loading"
        : viewerReady
          ? "ready"
          : "viewer-loading"

  useEffect(() => {
    const user = auth.user
    if (
      auth.isLoading ||
      blocked ||
      convexAuth.isLoading ||
      !convexAuth.isAuthenticated ||
      user === null ||
      ensuredUserId === user.id
    )
      return

    let cancelled = false
    void ensureViewer({})
      .then(() => {
        if (!cancelled) setEnsuredUserId(user.id)
      })
      .catch((cause: unknown) => {
        if (!cancelled) onFailure(cause)
      })
    return () => {
      cancelled = true
    }
  }, [
    auth.isLoading,
    auth.user,
    blocked,
    convexAuth.isAuthenticated,
    convexAuth.isLoading,
    ensureAttempt,
    ensureViewer,
    ensuredUserId,
    onFailure
  ])

  return {
    auth,
    convexAuth,
    authUserId,
    viewerReady,
    status,
    ensureAttempt,
    retry: () => {
      setEnsuredUserId(null)
      setEnsureAttempt((attempt) => attempt + 1)
    }
  }
}
