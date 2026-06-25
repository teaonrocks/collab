import { RpcClient } from "@effect/rpc"
import { Effect, Layer } from "effect"
import { CollabRpcs } from "../shared/collab-rpc"
import { type IpcClientPort, layerIpcClient } from "../shared/rpc-client"
import { layerChatDataFromCollabApi } from "./chat-data"
import { CollabApi } from "./collab-api"

export const layerCollabApi: Layer.Layer<CollabApi, never, RpcClient.Protocol> = Layer.scoped(
  CollabApi,
  Effect.gen(function*() {
    const client = yield* RpcClient.make(CollabRpcs)
    return CollabApi.of({
      snapshot: () => client.CollabGetSnapshot(),
      registerAgent: (input) => client.WorkspaceAgentRegister(input),
      enableAgent: (input) => client.ChannelAgentEnable(input),
      createChannelMessage: (input) => client.ChannelMessageCreate(input),
      deleteChannelMessage: (input) => client.ChannelMessageDelete(input),
      createDraftThread: (input) => client.DraftThreadCreate(input),
      startRun: (threadId) => client.AgentRunStart({ threadId }),
      changes: () => client.CollabWatch()
    })
  })
)

let resolvePort!: (port: MessagePort) => void
const portReady = new Promise<MessagePort>((resolve) => {
  resolvePort = resolve
})
if (typeof window !== "undefined") {
  const onMessage = (event: MessageEvent) => {
    if (event.data === "rpc-port" && event.ports[0] !== undefined) {
      window.removeEventListener("message", onMessage)
      resolvePort(event.ports[0])
    }
  }
  window.addEventListener("message", onMessage)
}

export const toClientPort = (port: MessagePort): IpcClientPort => ({
  get onmessage() {
    return port.onmessage as IpcClientPort["onmessage"]
  },
  set onmessage(handler: IpcClientPort["onmessage"]) {
    port.onmessage = handler === null ? null : (event) => handler({ data: event.data })
  },
  postMessage: (message) => port.postMessage(message),
  start: () => port.start(),
  close: () => port.close()
})

const layerRpcClient: Layer.Layer<RpcClient.Protocol> = Layer.unwrapEffect(
  Effect.promise(() => portReady).pipe(Effect.map((port) => layerIpcClient(toClientPort(port))))
)

export const CollabApiLive: Layer.Layer<CollabApi> = layerCollabApi.pipe(Layer.provide(layerRpcClient))

export const RendererDataLive = Layer.merge(
  CollabApiLive,
  layerChatDataFromCollabApi.pipe(Layer.provide(CollabApiLive))
)
