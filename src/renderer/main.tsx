import { RegistryProvider } from "@effect-atom/atom-react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { DogfoodAuthProvider, isDogfoodAuthConfigured } from "./convex-auth"
import { ConvexDogfoodApp } from "./dogfood-chat"

const container = document.getElementById("root")
if (container === null) throw new Error("Missing #root element")

const app = isDogfoodAuthConfigured()
  ? <ConvexDogfoodApp />
  : (
    <RegistryProvider>
      <App />
    </RegistryProvider>
  )

createRoot(container).render(
  <DogfoodAuthProvider>
    {app}
  </DogfoodAuthProvider>
)
