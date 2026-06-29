export type RendererLocationPolicy = {
  readonly rendererDevServerUrl?: string
  readonly packagedRendererUrl: string
}

type FrameLike = {
  readonly url: string
}

type WebContentsLike = {
  readonly mainFrame: FrameLike
}

export type PrivilegedIpcEvent = {
  readonly sender: WebContentsLike
  readonly senderFrame: FrameLike | null
}

type NavigationEvent = {
  preventDefault: () => void
}

type OpenExternal = (url: string) => Promise<unknown>

export const hardenedWebPreferences = (preload: string) => ({
  preload,
  contextIsolation: true,
  sandbox: true
}) as const

const parseUrl = (rawUrl: string): URL | null => {
  try {
    return new URL(rawUrl)
  } catch {
    return null
  }
}

const hasSafeUrlShape = (url: URL): boolean =>
  url.username === "" && url.password === "" && url.hash === ""

export const isTrustedRendererUrl = (
  rawUrl: string,
  policy: RendererLocationPolicy
): boolean => {
  const url = parseUrl(rawUrl)
  if (url === null || !hasSafeUrlShape(url)) return false

  if (policy.rendererDevServerUrl !== undefined) {
    const devServerUrl = parseUrl(policy.rendererDevServerUrl)
    return devServerUrl !== null &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === devServerUrl.origin
  }

  const packagedRendererUrl = parseUrl(policy.packagedRendererUrl)
  return packagedRendererUrl !== null &&
    url.protocol === "file:" &&
    url.origin === packagedRendererUrl.origin &&
    url.host === packagedRendererUrl.host &&
    url.pathname === packagedRendererUrl.pathname
}

export const isAllowedExternalAttachmentUrl = (rawUrl: string): boolean => {
  const url = parseUrl(rawUrl)
  return url !== null && url.protocol === "https:" && hasSafeUrlShape(url)
}

export const createWillNavigateHandler = (policy: RendererLocationPolicy) =>
  (event: NavigationEvent, url: string): void => {
    if (!isTrustedRendererUrl(url, policy)) event.preventDefault()
  }

export const createWindowOpenHandler = (
  openExternal: OpenExternal,
  onOpenError: (cause: unknown) => void
) => ({ url }: { readonly url: string }) => {
  if (isAllowedExternalAttachmentUrl(url)) {
    void openExternal(url).catch(onOpenError)
  }
  return { action: "deny" as const }
}

export const isTrustedPrivilegedIpcSender = (
  event: PrivilegedIpcEvent,
  expectedWebContents: WebContentsLike,
  policy: RendererLocationPolicy
): boolean => event.sender === expectedWebContents &&
  event.senderFrame !== null &&
  event.senderFrame === expectedWebContents.mainFrame &&
  isTrustedRendererUrl(event.senderFrame.url, policy)
