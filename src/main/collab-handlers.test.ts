import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type RpcClient, type RpcGroup, RpcTest } from "@effect/rpc"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"
import { CollabRpcs } from "../shared/collab-rpc"
import { CollabHandlersLive } from "./collab-handlers"
import { CollabRepo } from "./collab-repo"

const electron = vi.hoisted(() => ({ userDataDir: "" }))
vi.mock("electron", () => ({ app: { getPath: () => electron.userDataDir } }))

beforeEach(() => {
  electron.userDataDir = mkdtempSync(join(tmpdir(), "collab-handlers-"))
})
afterEach(() => {
  rmSync(electron.userDataDir, { recursive: true, force: true })
})

type CollabClient = RpcClient.RpcClient<RpcGroup.Rpcs<typeof CollabRpcs>>

const withClient = <A, E>(use: (client: CollabClient) => Effect.Effect<A, E>) =>
  Effect.gen(function*() {
    const client = yield* RpcTest.makeClient(CollabRpcs).pipe(
      Effect.provide(CollabHandlersLive),
      Effect.provide(CollabRepo.Default)
    )
    return yield* use(client)
  }).pipe(Effect.scoped)

describe("CollabRpcs handlers (in-memory RpcTest client)", () => {
  it.effect("runs the register -> enable -> draft -> start flow through handlers", () =>
    withClient((client) =>
      Effect.gen(function*() {
        const initial = yield* client.CollabGetSnapshot()
        const agent = yield* client.WorkspaceAgentRegister({
          displayName: "Hermes",
          description: "Local review agent",
          providerName: "local-fake",
          declaredCapabilities: ["read_channel_context", "write_thread_message"],
          grantedCapabilities: ["read_channel_context", "write_thread_message"]
        })
        yield* client.ChannelAgentEnable({
          channelId: initial.channel.id,
          agentId: agent.id,
          channelGrants: agent.grantedCapabilities
        })
        const thread = yield* client.DraftThreadCreate({
          channelId: initial.channel.id,
          agentId: agent.id,
          selectedMessageIds: [initial.channelMessages[0]!.id],
          prompt: "Summarize the selected context."
        })
        const result = yield* client.AgentRunStart({ threadId: thread.id })
        const final = yield* client.CollabGetSnapshot()

        expect(result.run.status).toBe("completed")
        expect(result.responseMessage.provenance?.runId).toBe(result.run.id)
        expect(final.threads[0]?.status).toBe("completed")
        expect(final.agentRuns).toHaveLength(1)
      })))
})
