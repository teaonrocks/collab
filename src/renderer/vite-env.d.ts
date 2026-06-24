/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AETHER_SHOW_AGENT_UI?: string
  readonly VITE_CONVEX_URL?: string
  readonly VITE_WORKOS_CLIENT_ID?: string
  readonly VITE_WORKOS_REDIRECT_URI?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
