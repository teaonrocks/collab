import { RegistryProvider } from "@effect-atom/atom-react"
import { Suspense, lazy } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import { isDogfoodAuthConfigured } from "./dogfood-config"
import { TailwindPipelineProbe } from "./tailwind-pipeline-probe"

const DogfoodApp = lazy(async () => {
  const [{ DogfoodAuthProvider }, { ConvexDogfoodApp }] = await Promise.all([
    import("./convex-auth"),
    import("./dogfood-chat")
  ])
  return {
    default: () => (
      <DogfoodAuthProvider>
        <ConvexDogfoodApp />
      </DogfoodAuthProvider>
    )
  }
})

const container = document.getElementById("root")
if (container === null) throw new Error("Missing #root element")

createRoot(container).render(
  <>
    <TailwindPipelineProbe />
    {isDogfoodAuthConfigured()
      ? (
        <Suspense fallback={<main className="loadingShell grid min-h-screen w-full place-items-center overflow-hidden bg-surface-canvas p-6 font-sans text-foreground"><p>Loading...</p></main>}>
          <DogfoodApp />
        </Suspense>
      )
      : (
        <RegistryProvider>
          <App />
        </RegistryProvider>
      )}
  </>
)
