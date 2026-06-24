import { Atom } from "@effect-atom/atom"
import { Effect, Stream } from "effect"
import { CollabApi } from "./collab-api"
import { CollabApiLive } from "./collab-api-live"

export const runtime = Atom.runtime(CollabApiLive)

const api = Effect.serviceFunctions(CollabApi)

export const snapshot = runtime.atom(
  Stream.unwrap(Effect.map(CollabApi, (svc) => svc.changes()))
)

export const registerAgent = runtime.fn(api.registerAgent, { concurrent: true })
export const enableAgent = runtime.fn(api.enableAgent, { concurrent: true })
export const createChannelMessage = runtime.fn(api.createChannelMessage, { concurrent: true })
export const deleteChannelMessage = runtime.fn(api.deleteChannelMessage, { concurrent: true })
export const createDraftThread = runtime.fn(api.createDraftThread, { concurrent: true })
export const startRun = runtime.fn(api.startRun, { concurrent: true })
