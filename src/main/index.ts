import { app, BrowserWindow, ipcMain, shell } from "electron"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  authCallbackScheme,
  findAuthCallbackUrl,
  isAllowedExternalAuthUrl,
  rendererAuthCallbackUrl
} from "../shared/auth-redirect-policy"

let mainWindow: BrowserWindow | null = null

let pendingAuthCallbackUrl: string | null = findAuthCallbackUrl(process.argv)

ipcMain.handle("aether:open-external", (_event, rawUrl: unknown) => {
  if (typeof rawUrl !== "string") {
    throw new Error("Refusing to open non-string external URL.")
  }
  if (!isAllowedExternalAuthUrl(rawUrl)) {
    throw new Error("Refusing to open unsupported external URL.")
  }
  return shell.openExternal(rawUrl)
})

const rendererCallbackUrl = (rawUrl: string): string | null => {
  return rendererAuthCallbackUrl(rawUrl, {
    rendererDevServerUrl: process.env.ELECTRON_RENDERER_URL,
    packagedRendererUrl: pathToFileURL(join(__dirname, "../renderer/index.html")).toString()
  })
}

const focusWindow = (window: BrowserWindow): void => {
  if (window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.focus()
}

const getMainWindow = (): BrowserWindow | null => {
  if (mainWindow === null) return null
  if (mainWindow.isDestroyed()) {
    mainWindow = null
    return null
  }
  return mainWindow
}

const handleAuthCallback = (rawUrl: string): void => {
  const targetUrl = rendererCallbackUrl(rawUrl)
  if (targetUrl === null) return

  const window = getMainWindow()
  if (window === null) {
    pendingAuthCallbackUrl = rawUrl
    return
  }

  focusWindow(window)
  void window.loadURL(targetUrl)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", (_event, argv) => {
    const callbackUrl = findAuthCallbackUrl(argv)
    if (callbackUrl !== null) handleAuthCallback(callbackUrl)
    const window = getMainWindow()
    if (window !== null) focusWindow(window)
  })
}

app.on("open-url", (event, rawUrl) => {
  event.preventDefault()
  handleAuthCallback(rawUrl)
})

const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 960,
    height: 720,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: false
    }
  })
  mainWindow = window
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (pendingAuthCallbackUrl !== null) {
    const callbackUrl = pendingAuthCallbackUrl
    pendingAuthCallbackUrl = null
    handleAuthCallback(callbackUrl)
  } else if (devServerUrl !== undefined) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(authCallbackScheme, process.execPath, [process.argv[1]!])
} else {
  app.setAsDefaultProtocolClient(authCallbackScheme)
}

app.whenReady().then(
  () => {
    createWindow()
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  },
  (cause) => {
    console.error("Failed to start Aether", cause)
    app.quit()
  }
)

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
