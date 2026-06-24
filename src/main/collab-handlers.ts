import { Effect } from "effect"
import { CollabRpcs } from "../shared/collab-rpc"
import { CollabRepo } from "./collab-repo"

export const CollabHandlersLive = CollabRpcs.toLayer(
  Effect.gen(function*() {
    const repo = yield* CollabRepo
    return CollabRpcs.of({
      CollabGetSnapshot: () => repo.snapshot,
      WorkspaceAgentRegister: (payload) => repo.registerAgent(payload),
      ChannelAgentEnable: (payload) => repo.enableAgent(payload),
      ChannelMessageCreate: (payload) => repo.createChannelMessage(payload),
      ChannelMessageDelete: (payload) => repo.deleteChannelMessage(payload),
      DraftThreadCreate: (payload) => repo.createDraftThread(payload),
      AgentRunStart: ({ threadId }) => repo.startRun(threadId),
      CollabWatch: () => repo.changes
    })
  })
)
