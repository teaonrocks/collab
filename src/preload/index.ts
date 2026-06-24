import { contextBridge, ipcRenderer } from "electron"

// The preload runs in an isolated world. It receives the transferred port from
// main and relays it into the renderer's main world, where the RPC client picks
// it up via `window.onmessage`.
ipcRenderer.on("rpc-port", (event) => {
  const [port] = event.ports
  if (port !== undefined) {
    window.postMessage("rpc-port", "*", [port])
  }
})

contextBridge.exposeInMainWorld("aetherShell", {
  openExternal: (url: unknown) => {
    if (typeof url !== "string") {
      return Promise.reject(new TypeError("Expected external URL to be a string."))
    }
    return ipcRenderer.invoke("aether:open-external", url)
  }
})
