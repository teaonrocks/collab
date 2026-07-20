import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import { resolve } from "node:path"
import type { Plugin } from "vite"
import {
  developmentContentSecurityPolicy,
  productionContentSecurityPolicy
} from "./src/renderer/content-security-policy"

const rendererContentSecurityPolicy = (): Plugin => {
  let content = productionContentSecurityPolicy
  return {
    name: "aether-renderer-content-security-policy",
    configResolved: (config) => {
      content = config.command === "build" ? productionContentSecurityPolicy : developmentContentSecurityPolicy
    },
    transformIndexHtml: (html) => html.replace("__AETHER_CONTENT_SECURITY_POLICY__", content)
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/main/index.ts") } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/preload/index.ts") } }
    }
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react(), rendererContentSecurityPolicy()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/renderer/index.html") } }
    }
  }
})
