import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  session,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type Rectangle
} from "electron"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createAccountRegistry, type AccountRegistry } from "./account-registry"
import {
  retireAccountWindow,
  revealReplacementThenRetire,
  selectActiveWindowRecord
} from "./account-window-lifecycle"
import { createAuthCallbackCoordinator } from "./auth-callback"
import {
  accountPartition,
  defaultAccountId,
  parseAuthCallbackState,
  type AccountProfile
} from "../shared/account-session"
import {
  authCallbackScheme,
  findAuthCallbackUrl,
  isAllowedExternalAuthUrl,
  rendererAuthCallbackUrl
} from "../shared/auth-redirect-policy"
import {
  createWillNavigateHandler,
  createWindowOpenHandler,
  hardenedWebPreferences,
  isTrustedPrivilegedIpcSender,
  type RendererLocationPolicy
} from "./security-policy"

type WindowRecord = {
  readonly id: string
  readonly accountId: string
  readonly window: BrowserWindow
}

const windows = new Map<number, WindowRecord>()
let accounts: AccountRegistry | null = null
let pendingAdditionalWindows = 0
let lastFocusedWindowId: number | null = null
let windowTransitionDepth = 0
const retiringAccountIds = new Set<string>()
const rendererLoadTimeoutMs = 30_000

const rendererLocationPolicy: RendererLocationPolicy = {
  rendererDevServerUrl: process.env.ELECTRON_RENDERER_URL,
  packagedRendererUrl: pathToFileURL(join(__dirname, "../renderer/index.html")).toString()
}

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

const getAccounts = (): AccountRegistry => {
  if (accounts === null) throw new Error("Account registry is not ready.")
  return accounts
}

const activeRecord = (): WindowRecord | null => {
  const focused = BrowserWindow.getFocusedWindow()
  return selectActiveWindowRecord(windows, focused?.id ?? null, lastFocusedWindowId)
}

const recordForEvent = (event: IpcMainInvokeEvent): WindowRecord => {
  const record = [...windows.values()].find((candidate) => candidate.window.webContents === event.sender)
  if (
    record === undefined ||
    !isTrustedPrivilegedIpcSender(event, record.window.webContents, rendererLocationPolicy)
  ) {
    throw new Error("Refusing privileged IPC from an untrusted renderer frame.")
  }
  return record
}

const parseProfile = (value: unknown): AccountProfile => {
  if (
    typeof value !== "object" || value === null ||
    !("userId" in value) || typeof value.userId !== "string" || value.userId.length === 0 ||
    !("displayName" in value) || typeof value.displayName !== "string" || value.displayName.length === 0 ||
    !("email" in value) || typeof value.email !== "string" || value.email.length === 0 ||
    !("avatarUrl" in value) || (typeof value.avatarUrl !== "string" && value.avatarUrl !== null)
  ) {
    throw new Error("Refusing invalid account profile data.")
  }
  return {
    userId: value.userId,
    displayName: value.displayName,
    email: value.email,
    avatarUrl: value.avatarUrl
  }
}

const loadRenderer = (window: BrowserWindow): Promise<void> => {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl !== undefined) {
    return window.loadURL(devServerUrl)
  }
  return window.loadFile(join(__dirname, "../renderer/index.html"))
}

const loadRendererWithTimeout = async (window: BrowserWindow): Promise<void> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      loadRenderer(window),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("The replacement account window did not load in time."))
        }, rendererLoadTimeoutMs)
      })
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

const createWindow = (
  accountId: string,
  options?: { readonly bounds?: Rectangle; readonly show?: boolean; readonly load?: boolean }
): BrowserWindow => {
  const accountRegistry = getAccounts()
  const resolvedAccountId = accountRegistry.has(accountId)
    ? accountId
    : accountRegistry.preferredAccountId()
  const partition = accountPartition(resolvedAccountId)
  const window = new BrowserWindow({
    width: options?.bounds?.width ?? 960,
    height: options?.bounds?.height ?? 720,
    ...(options?.bounds === undefined ? {} : { x: options.bounds.x, y: options.bounds.y }),
    show: options?.show ?? true,
    webPreferences: {
      ...hardenedWebPreferences(join(__dirname, "../preload/index.js")),
      ...(partition === undefined ? {} : { partition })
    }
  })
  const record: WindowRecord = { id: randomUUID(), accountId: resolvedAccountId, window }
  windows.set(window.id, record)

  window.webContents.on("will-navigate", createWillNavigateHandler(rendererLocationPolicy))
  window.webContents.setWindowOpenHandler(createWindowOpenHandler(
    (url) => shell.openExternal(url),
    (cause) => console.error("Failed to open external attachment", cause)
  ))
  window.on("focus", () => {
    lastFocusedWindowId = window.id
    void accountRegistry.touch(resolvedAccountId).catch((cause: unknown) => {
      console.error("Failed to remember the active Aether account", cause)
    })
  })
  window.on("closed", () => {
    windows.delete(window.id)
    if (lastFocusedWindowId === window.id) lastFocusedWindowId = null
    if (
      !retiringAccountIds.has(resolvedAccountId) &&
      accountRegistry.isPending(resolvedAccountId) &&
      ![...windows.values()].some((candidate) => candidate.accountId === resolvedAccountId)
    ) {
      void accountRegistry.remove(resolvedAccountId).catch((cause: unknown) => {
        console.error("Failed to discard an unfinished Aether account", cause)
      })
    }
  })

  if (options?.load !== false) {
    void loadRenderer(window).catch((cause: unknown) => {
      console.error("Failed to load the Aether renderer", cause)
    })
  }
  return window
}

const replaceWindowAccount = async (record: WindowRecord, accountId: string): Promise<BrowserWindow> => {
  if (record.window.isDestroyed()) return createWindow(accountId)
  const replacement = createWindow(accountId, {
    bounds: record.window.getBounds(),
    show: false,
    load: false
  })
  return revealReplacementThenRetire({
    source: record.window,
    replacement,
    loadReplacement: () => loadRendererWithTimeout(replacement)
  })
}

type WindowPlacement = { readonly bounds: Rectangle }

const retireWindowRecords = (records: ReadonlyArray<WindowRecord>): ReadonlyArray<WindowPlacement> => {
  const placements = records.flatMap((record): ReadonlyArray<WindowPlacement> =>
    record.window.isDestroyed() ? [] : [{ bounds: record.window.getBounds() }])
  for (const record of records) retireAccountWindow(record.window)
  return placements
}

const reopenWindowPlacements = async (
  placements: ReadonlyArray<WindowPlacement>,
  accountId: string
): Promise<void> => {
  await Promise.all(placements.map(async ({ bounds }) => {
    const replacement = createWindow(accountId, { bounds, show: false, load: false })
    try {
      await loadRendererWithTimeout(replacement)
      if (replacement.isDestroyed()) throw new Error("The replacement account window closed while loading.")
      replacement.show()
    } catch (cause) {
      retireAccountWindow(replacement)
      console.error("Failed to load a replacement Aether account window", cause)
      createWindow(accountId, { bounds })
    }
  }))
}

const withWindowTransition = async <Value>(
  accountIds: ReadonlyArray<string>,
  operation: () => Promise<Value>
): Promise<Value> => {
  windowTransitionDepth += 1
  for (const accountId of accountIds) retiringAccountIds.add(accountId)
  try {
    return await operation()
  } finally {
    for (const accountId of accountIds) retiringAccountIds.delete(accountId)
    windowTransitionDepth -= 1
  }
}

const clearAccountStorage = async (accountId: string): Promise<void> => {
  const partition = accountPartition(accountId)
  const accountSession = partition === undefined ? session.defaultSession : session.fromPartition(partition)
  await accountSession.clearStorageData()
  accountSession.flushStorageData()
}

const callbackRecord = (rawUrl: string): WindowRecord | null => {
  const state = parseAuthCallbackState(rawUrl)
  if (state !== null) {
    const exactWindow = [...windows.values()].find((record) =>
      record.id === state.windowId && record.accountId === state.accountId
    )
    return exactWindow ?? null
  }
  return activeRecord()
}

const handleAuthCallback = (rawUrl: string): void => {
  const state = parseAuthCallbackState(rawUrl)
  const record = callbackRecord(rawUrl)
  if (state !== null && record === null) {
    console.warn("Ignoring an AuthKit callback whose initiating Aether window is no longer open.")
    return
  }
  authCallbacks.handleAuthCallback(rawUrl, record?.window ?? null)
}

const registerIpc = (): void => {
  ipcMain.handle("aether:open-external", (event, rawUrl: unknown) => {
    recordForEvent(event)
    if (typeof rawUrl !== "string") {
      throw new Error("Refusing to open non-string external URL.")
    }
    if (!isAllowedExternalAuthUrl(rawUrl)) {
      throw new Error("Refusing to open unsupported external URL.")
    }
    return shell.openExternal(rawUrl)
  })

  ipcMain.handle("aether:accounts-context", (event) => {
    const record = recordForEvent(event)
    return getAccounts().context(record.id, record.accountId)
  })

  ipcMain.handle("aether:accounts-update-profile", async (event, rawProfile: unknown) => {
    const record = recordForEvent(event)
    const duplicateAccountId = await getAccounts().updateProfile(record.accountId, parseProfile(rawProfile))
    if (duplicateAccountId !== null) {
      const duplicateWindows = [...windows.values()].filter((candidate) => candidate.accountId === duplicateAccountId)
      await withWindowTransition([duplicateAccountId], async () => {
        const placements = retireWindowRecords(duplicateWindows)
        await clearAccountStorage(duplicateAccountId)
        await reopenWindowPlacements(placements, record.accountId)
      })
    }
    return getAccounts().context(record.id, record.accountId)
  })

  ipcMain.handle("aether:accounts-switch", async (event, accountId: unknown) => {
    const record = recordForEvent(event)
    if (typeof accountId !== "string" || !getAccounts().has(accountId)) {
      throw new Error("Refusing to switch to an unknown account.")
    }
    if (accountId === record.accountId) return
    await getAccounts().touch(accountId)
    if (getAccounts().isPending(record.accountId)) {
      const pendingWindows = [...windows.values()].filter((candidate) => candidate.accountId === record.accountId)
      await withWindowTransition([record.accountId], async () => {
        const placements = retireWindowRecords(pendingWindows)
        await getAccounts().remove(record.accountId)
        await reopenWindowPlacements(placements, accountId)
      })
      return
    }
    await replaceWindowAccount(record, accountId)
  })

  ipcMain.handle("aether:accounts-add", async (event) => {
    const record = recordForEvent(event)
    const accountId = await getAccounts().create()
    try {
      await replaceWindowAccount(record, accountId)
    } catch (cause) {
      await getAccounts().remove(accountId)
      throw cause
    }
  })

  ipcMain.handle("aether:accounts-remove-current", async (event) => {
    const record = recordForEvent(event)
    const removedAccountId = record.accountId
    const accountWindows = [...windows.values()].filter((candidate) => candidate.accountId === removedAccountId)
    await withWindowTransition([removedAccountId], async () => {
      const placements = retireWindowRecords(accountWindows)
      await clearAccountStorage(removedAccountId)
      await getAccounts().remove(removedAccountId)
      await reopenWindowPlacements(placements, getAccounts().preferredAccountId(removedAccountId))
    })
  })

  ipcMain.handle("aether:accounts-sign-out-all", async (event) => {
    recordForEvent(event)
    const accountIds = getAccounts().accountIds()
    const accountWindows = [...windows.values()]
    await withWindowTransition(accountIds, async () => {
      const placements = retireWindowRecords(accountWindows)
      await Promise.all(accountIds.map(clearAccountStorage))
      await getAccounts().reset()
      await reopenWindowPlacements(placements, defaultAccountId)
    })
  })
}

const installApplicationMenu = (): void => {
  const template: ReadonlyArray<MenuItemConstructorOptions> = [
    ...(process.platform === "darwin"
      ? [{
          label: app.name,
          submenu: [{ role: "about" as const }, { type: "separator" as const }, { role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const }, { type: "separator" as const }, { role: "quit" as const }]
        }]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+N",
          click: () => createWindow(activeRecord()?.accountId ?? getAccounts().preferredAccountId())
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" }
      ]
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate([...template]))
}

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(authCallbackScheme, process.execPath, [process.argv[1]!])
} else {
  app.setAsDefaultProtocolClient(authCallbackScheme)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", (_event, argv) => {
    const callbackUrl = findAuthCallbackUrl(argv)
    if (callbackUrl !== null) {
      if (accounts === null) {
        authCallbacks.handleAuthCallback(callbackUrl, null)
      } else {
        handleAuthCallback(callbackUrl)
      }
      return
    }
    if (accounts === null) {
      pendingAdditionalWindows += 1
      return
    }
    createWindow(activeRecord()?.accountId ?? getAccounts().preferredAccountId())
  })

  app.on("open-url", (event, rawUrl) => {
    event.preventDefault()
    if (accounts === null) {
      authCallbacks.handleAuthCallback(rawUrl, null)
    } else {
      handleAuthCallback(rawUrl)
    }
  })

  void app.whenReady()
    .then(async () => {
      accounts = createAccountRegistry(join(app.getPath("userData"), "accounts.json"))
      await accounts.initialize()
      registerIpc()
      installApplicationMenu()

      const pendingCallback = authCallbacks.pendingAuthCallbackUrl()
      if (pendingCallback === null) {
        createWindow(accounts.preferredAccountId())
      } else {
        const state = parseAuthCallbackState(pendingCallback)
        const accountId = state !== null && accounts.has(state.accountId)
          ? state.accountId
          : accounts.preferredAccountId()
        const window = createWindow(accountId)
        if (state === null) {
          authCallbacks.consumePendingAuthCallback(window)
        } else {
          authCallbacks.discardPendingAuthCallback()
        }
      }
      for (let index = 0; index < pendingAdditionalWindows; index += 1) {
        createWindow(activeRecord()?.accountId ?? accounts.preferredAccountId())
      }
      pendingAdditionalWindows = 0

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow(getAccounts().preferredAccountId())
      })
    })
    .catch((cause: unknown) => {
      console.error("Failed to start Aether", cause)
      app.quit()
    })

  app.on("window-all-closed", () => {
    if (windowTransitionDepth > 0 || BrowserWindow.getAllWindows().length > 0) return
    if (process.platform !== "darwin") app.quit()
  })
}
