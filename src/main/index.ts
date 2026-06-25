import { RpcServer } from "@effect/rpc"
import { app, BrowserWindow, ipcMain, MessageChannelMain, shell, type MessagePortMain } from "electron"
import { Layer, ManagedRuntime } from "effect"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  authCallbackScheme,
  findAuthCallbackUrl,
  isAllowedExternalAuthUrl,
  rendererAuthCallbackUrl
} from "../shared/auth-redirect-policy"
import { CollabRpcs } from "../shared/collab-rpc"
import { CollabHandlersLive } from "./collab-handlers"
import { CollabRepo } from "./collab-repo"
import { type IpcServerPort, layerIpcServer, RpcPortHandoff } from "./ipc-server"

// The whole main-process backend: an RpcServer for the collaboration contract, its
// handlers, the MessagePort transport, and the filesystem-backed repo (which
// resolves its own storage path). provideMerge keeps RpcPortHandoff in the
// output so the window code below can hand fresh ports to the running server.
const Live = RpcServer.layer(CollabRpcs, { disableFatalDefects: true }).pipe(
  Layer.provide(CollabHandlersLive),
  Layer.provideMerge(layerIpcServer),
  Layer.provide(CollabRepo.Default)
)

// ManagedRuntime keeps the layer scope open for the app's lifetime, so the
// forked RpcServer daemon stays alive across every renderer load (a plain
// Effect.runPromise would close the scope and tear the server down at once).
const runtime = ManagedRuntime.make(Live)
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

// Adapt Electron's EventEmitter-style MessagePortMain to the structural
// IpcServerPort the transport expects. The wrapped-listener map lets `off`
// detach the exact handler `on` registered, so a port swap leaves no leak.
const toServerPort = (port: MessagePortMain): IpcServerPort => {
  const wrapped = new Map<(...args: Array<any>) => void, (messageEvent: { data: unknown }) => void>()
  const on = ((event: "message" | "close", listener: (...args: Array<any>) => void) => {
    if (event === "message") {
      const handler = (messageEvent: { data: unknown }): void => listener({ data: messageEvent.data })
      wrapped.set(listener, handler)
      port.on("message", handler)
    } else {
      port.on("close", listener)
    }
  }) as IpcServerPort["on"]
  const off = ((_event: "message", listener: (...args: Array<any>) => void) => {
    const handler = wrapped.get(listener)
    if (handler !== undefined) {
      port.off("message", handler)
      wrapped.delete(listener)
    }
  }) as IpcServerPort["off"]
  return {
    on,
    off,
    postMessage: (message) => port.postMessage(message),
    start: () => port.start(),
    close: () => port.close()
  }
}

const createWindow = (bind: (port: IpcServerPort) => void): void => {
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

  // Mint a fresh MessageChannel per load: the renderer keeps port2, the server
  // binds port1. On reload this fires again, swapping ports — the transport
  // interrupts the previous load's in-flight streams.
  window.webContents.on("did-finish-load", () => {
    const channel = new MessageChannelMain()
    window.webContents.postMessage("rpc-port", null, [channel.port2])
    bind(toServerPort(channel.port1))
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
  () =>
    runtime.runPromise(RpcPortHandoff).then((handoff) => {
      createWindow(handoff.bind)
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow(handoff.bind)
      })
    }),
  (cause) => {
    console.error("Failed to start the Effect RPC server", cause)
    app.quit()
  }
)

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    void runtime.dispose().finally(() => app.quit())
  }
})
