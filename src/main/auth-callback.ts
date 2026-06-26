export type AuthCallbackWindow = {
  readonly isDestroyed: () => boolean
  readonly isMinimized: () => boolean
  readonly restore: () => void
  readonly focus: () => void
  readonly loadURL: (url: string) => Promise<unknown> | void
}

export type AuthCallbackCoordinator = {
  readonly pendingAuthCallbackUrl: () => string | null
  readonly handleAuthCallback: (rawUrl: string, window: AuthCallbackWindow | null) => void
  readonly consumePendingAuthCallback: (window: AuthCallbackWindow) => void
}

export const focusAuthCallbackWindow = (window: AuthCallbackWindow): void => {
  if (window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.focus()
}

export const createAuthCallbackCoordinator = (options: {
  readonly initialAuthCallbackUrl: string | null
  readonly rendererCallbackUrl: (rawUrl: string) => string | null
}): AuthCallbackCoordinator => {
  let pendingAuthCallbackUrl = options.initialAuthCallbackUrl

  const handleAuthCallback = (rawUrl: string, window: AuthCallbackWindow | null): void => {
    const targetUrl = options.rendererCallbackUrl(rawUrl)
    if (targetUrl === null) return

    if (window === null || window.isDestroyed()) {
      pendingAuthCallbackUrl = rawUrl
      return
    }

    focusAuthCallbackWindow(window)
    void window.loadURL(targetUrl)
  }

  return {
    pendingAuthCallbackUrl: () => pendingAuthCallbackUrl,
    handleAuthCallback,
    consumePendingAuthCallback: (window) => {
      if (pendingAuthCallbackUrl === null) return
      const callbackUrl = pendingAuthCallbackUrl
      pendingAuthCallbackUrl = null
      handleAuthCallback(callbackUrl, window)
    }
  }
}
