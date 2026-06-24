import { RegistryProvider } from "@effect-atom/atom-react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { DogfoodAuthProvider } from "./convex-auth"

const container = document.getElementById("root")
if (container === null) throw new Error("Missing #root element")

createRoot(container).render(
  <DogfoodAuthProvider>
    <RegistryProvider>
      <App />
    </RegistryProvider>
  </DogfoodAuthProvider>
)
