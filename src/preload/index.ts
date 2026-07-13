import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("aetherShell", {
  openExternal: (url: unknown) => {
    if (typeof url !== "string") {
      return Promise.reject(new TypeError("Expected external URL to be a string."))
    }
    return ipcRenderer.invoke("aether:open-external", url)
  },
  accountContext: () => ipcRenderer.invoke("aether:accounts-context"),
  updateAccountProfile: (profile: unknown) => ipcRenderer.invoke("aether:accounts-update-profile", profile),
  switchAccount: (accountId: unknown) => {
    if (typeof accountId !== "string") {
      return Promise.reject(new TypeError("Expected account id to be a string."))
    }
    return ipcRenderer.invoke("aether:accounts-switch", accountId)
  },
  addAccount: () => ipcRenderer.invoke("aether:accounts-add"),
  removeCurrentAccount: () => ipcRenderer.invoke("aether:accounts-remove-current"),
  signOutAllAccounts: () => ipcRenderer.invoke("aether:accounts-sign-out-all")
})
