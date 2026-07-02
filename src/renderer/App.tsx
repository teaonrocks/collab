import { Result } from "@effect-atom/atom"
import { useAtomSet, useAtomValue } from "@effect-atom/atom-react"
import { Cause } from "effect"
import * as atoms from "./collab-atoms"
import { WorkspaceChat } from "./workspace-chat"

export { WorkspaceChat } from "./workspace-chat"

const loadingShellClassName =
  "loadingShell grid min-h-screen w-full place-items-center overflow-hidden bg-surface-canvas p-6 font-sans text-foreground"

export function App() {
  const snapshot = useAtomValue(atoms.snapshot)
  const createChannelMessage = useAtomSet(atoms.createChannelMessage, { mode: "promise" })
  const deleteChannelMessage = useAtomSet(atoms.deleteChannelMessage, { mode: "promise" })

  return Result.builder(snapshot)
    .onInitial(() => <main className={loadingShellClassName}><p>Loading...</p></main>)
    .onFailure((cause) => (
      <main className={loadingShellClassName}>
        <p className="errorText max-w-[min(720px,calc(100vw-48px))] [overflow-wrap:anywhere] text-destructive-text">
          {Cause.pretty(cause)}
        </p>
      </main>
    ))
    .onSuccess((model) => (
      <WorkspaceChat
        model={model}
        createChannelMessage={createChannelMessage}
        deleteChannelMessage={deleteChannelMessage}
      />
    ))
    .orNull()
}
