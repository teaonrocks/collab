import { app, BrowserWindow, ipcMain, shell } from "electron"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createAuthCallbackCoordinator, focusAuthCallbackWindow } from "./auth-callback"
import {
  authCallbackScheme,
  findAuthCallbackUrl,
  isAllowedExternalAuthUrl,
  rendererAuthCallbackUrl
} from "../shared/auth-redirect-policy"

let mainWindow: BrowserWindow | null = null

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

const authCallbacks = createAuthCallbackCoordinator({
  initialAuthCallbackUrl: findAuthCallbackUrl(process.argv),
  rendererCallbackUrl
})

const getMainWindow = (): BrowserWindow | null => {
  if (mainWindow === null) return null
  if (mainWindow.isDestroyed()) {
    mainWindow = null
    return null
  }
  return mainWindow
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", (_event, argv) => {
    const callbackUrl = findAuthCallbackUrl(argv)
    if (callbackUrl !== null) authCallbacks.handleAuthCallback(callbackUrl, getMainWindow())
    const window = getMainWindow()
    if (window !== null) focusAuthCallbackWindow(window)
  })
}

app.on("open-url", (event, rawUrl) => {
  event.preventDefault()
  authCallbacks.handleAuthCallback(rawUrl, getMainWindow())
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
  if (authCallbacks.pendingAuthCallbackUrl() !== null) {
    authCallbacks.consumePendingAuthCallback(window)
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
