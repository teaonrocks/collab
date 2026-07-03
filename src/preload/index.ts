import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("aetherShell", {
  openExternal: (url: unknown) => {
    if (typeof url !== "string") {
      return Promise.reject(new TypeError("Expected external URL to be a string."))
    }
    return ipcRenderer.invoke("aether:open-external", url)
  }
})
