import { Atom, Registry } from "@effect-atom/atom"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import {
  Channel,
  ChannelMessage,
  type ChannelMessageId,
  CollabSnapshot,
  HumanAccount,
  type HumanAccountId,
  Workspace,
  WorkspaceAgent,
  type WorkspaceId
} from "../shared/collab-rpc"
import { CollabApi } from "./collab-api"
import { registerAgent, runtime, snapshot as snapshotAtom } from "./collab-atoms"

const userId = "human-1" as HumanAccountId
const workspaceId = "workspace-1" as WorkspaceId
const channelId = "channel-1" as Channel["id"]

const makeSnapshot = () =>
  new CollabSnapshot({
    currentUser: new HumanAccount({
      id: userId,
      displayName: "Maya Patel",
      email: "maya@example.test",
      createdAt: 1
    }),
    workspace: new Workspace({
      id: workspaceId,
      name: "Aether Labs",
      createdAt: 1
    }),
    workspaceRole: "admin",
    channel: new Channel({
      id: channelId,
      workspaceId,
      name: "origination",
      visibility: "private",
      createdBy: userId,
      createdAt: 1
    }),
    channelRole: "admin",
    channelMessages: [
      new ChannelMessage({
        id: "message-1" as ChannelMessageId,
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "Summarize the handoff risks.",
        createdAt: 2,
        deletedAt: null
      })
    ],
    workspaceAgents: [],
    channelAgentEnablements: [],
    threads: [],
    threadMessages: [],
    agentRuns: [],
    auditEvents: []
  })

const makeApiMock = () => {
  const calls: Array<{ method: string; args: unknown }> = []
  const model = makeSnapshot()
  const layer = Layer.succeed(
    CollabApi,
    CollabApi.of({
      snapshot: () => Effect.succeed(model),
      registerAgent: (input) => {
        calls.push({ method: "registerAgent", args: input.displayName })
        return Effect.succeed(new WorkspaceAgent({
          id: "agent-1" as WorkspaceAgent["id"],
          workspaceId,
          displayName: input.displayName,
          description: input.description,
          providerName: input.providerName,
          declaredCapabilities: input.declaredCapabilities,
          grantedCapabilities: input.grantedCapabilities,
          status: "active",
          createdBy: userId,
          createdAt: 3
        }))
      },
      enableAgent: (input) => {
        calls.push({ method: "enableAgent", args: input.agentId })
        return Effect.die("not used")
      },
      createChannelMessage: (input) => {
        calls.push({ method: "createChannelMessage", args: input.body })
        return Effect.die("not used")
      },
      deleteChannelMessage: (input) => {
        calls.push({ method: "deleteChannelMessage", args: input.messageId })
        return Effect.die("not used")
      },
      createDraftThread: (input) => {
        calls.push({ method: "createDraftThread", args: input.prompt })
        return Effect.die("not used")
      },
      startRun: (threadId) => {
        calls.push({ method: "startRun", args: threadId })
        return Effect.die("not used")
      },
      changes: () => Stream.make(model)
    })
  )
  return { calls, layer, model }
}

const mock = (layer: Layer.Layer<CollabApi>) =>
  Registry.make({ initialValues: [Atom.initialValue(runtime.layer, layer)] })

describe("collaboration atoms", () => {
  it("resolves the snapshot atom from the CollabApi changes stream", async () => {
    const { layer, model } = makeApiMock()
    const registry = mock(layer)

    const result = await Effect.runPromise(
      Registry.getResult(registry, snapshotAtom, { suspendOnWaiting: true })
    )

    expect(result).toStrictEqual(model)
  })

  it("runs registerAgent through the mock api and records the call", async () => {
    const { calls, layer } = makeApiMock()
    const registry = mock(layer)

    registry.set(registerAgent, {
      displayName: "Hermes",
      description: "Local review agent",
      providerName: "local-fake",
      declaredCapabilities: ["read_channel_context"],
      grantedCapabilities: ["read_channel_context"]
    })
    const created = await Effect.runPromise(
      Registry.getResult(registry, registerAgent, { suspendOnWaiting: true })
    )

    expect(created.displayName).toBe("Hermes")
    expect(calls).toContainEqual({ method: "registerAgent", args: "Hermes" })
  })
})
