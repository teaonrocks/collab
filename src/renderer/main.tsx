import { Suspense, lazy } from "react"
import { createRoot } from "react-dom/client"
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

const missingDogfoodConfig = (
  <main className="grid min-h-screen w-full place-items-center overflow-hidden bg-surface-canvas p-6 font-sans text-foreground">
    <section className="w-full max-w-md space-y-3 rounded-card border border-border bg-surface-panel p-5 shadow-panel">
      <p className="text-sm font-medium">Dogfood configuration required</p>
      <p className="text-sm text-muted-foreground">
        Set VITE_CONVEX_URL, VITE_WORKOS_CLIENT_ID, and VITE_WORKOS_REDIRECT_URI to start Aether.
      </p>
    </section>
  </main>
)

createRoot(container).render(
  <>
    <TailwindPipelineProbe />
    {isDogfoodAuthConfigured()
      ? (
        <Suspense fallback={<main className="loadingShell grid min-h-screen w-full place-items-center overflow-hidden bg-surface-canvas p-6 font-sans text-foreground"><p>Loading...</p></main>}>
          <DogfoodApp />
        </Suspense>
      )
      : missingDogfoodConfig}
  </>
)
