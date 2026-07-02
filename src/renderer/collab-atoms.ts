import { Atom } from "@effect-atom/atom"
import { Effect, Stream } from "effect"
import { CollabApi } from "./collab-api"
import { RendererDataLive } from "./collab-api-live"
import { LegacyChatData } from "./legacy-chat-data"

export const runtime = Atom.runtime(RendererDataLive)

const api = Effect.serviceFunctions(CollabApi)
const chatData = Effect.serviceFunctions(LegacyChatData)

export const snapshot = runtime.atom(
  Stream.unwrap(Effect.map(LegacyChatData, (svc) => svc.changes()))
)

export const registerAgent = runtime.fn(api.registerAgent, { concurrent: true })
export const enableAgent = runtime.fn(api.enableAgent, { concurrent: true })
export const createChannelMessage = runtime.fn(chatData.createChannelMessage, { concurrent: true })
export const deleteChannelMessage = runtime.fn(chatData.deleteChannelMessage, { concurrent: true })
export const createDraftThread = runtime.fn(api.createDraftThread, { concurrent: true })
export const startRun = runtime.fn(api.startRun, { concurrent: true })
