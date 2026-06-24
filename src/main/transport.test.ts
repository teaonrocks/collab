import { MessageChannel, type MessagePort } from "node:worker_threads"
import { RpcClient, RpcSerialization, RpcServer } from "@effect/rpc"
import { describe, expect, it } from "@effect/vitest"
import { Cause, Chunk, Effect, Layer, Stream } from "effect"
import {
  Channel,
  ChannelMessage,
  type AgentId,
  type ChannelMessageId,
  CollabPolicyDenied,
  CollabRpcs,
  CollabSnapshot,
  HumanAccount,
  type HumanAccountId,
  Workspace,
  type WorkspaceId
} from "../shared/collab-rpc"
import { type IpcClientPort, layerIpcClient, makeIpcClientProtocol } from "../shared/rpc-client"
import { type IpcServerPort, layerIpcServer, RpcPortHandoff } from "./ipc-server"

const serverConfig = { disableFatalDefects: true } as const

const userId = "human-1" as HumanAccountId
const workspaceId = "workspace-1" as WorkspaceId
const channelId = "channel-1" as Channel["id"]

const makeSnapshot = (name = "Aether Labs") =>
  new CollabSnapshot({
    currentUser: new HumanAccount({
      id: userId,
      displayName: "Maya Patel",
      email: "maya@example.test",
      createdAt: 1
    }),
    workspace: new Workspace({
      id: workspaceId,
      name,
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

const SNAPSHOT_A = makeSnapshot("Aether Labs")
const SNAPSHOT_B = makeSnapshot("Aether Field Ops")

const baseHandlers = () => ({
  CollabGetSnapshot: () => Effect.succeed(SNAPSHOT_A),
  WorkspaceAgentRegister: () => Effect.never,
  ChannelAgentEnable: () => Effect.never,
  ChannelMessageCreate: () => Effect.never,
  ChannelMessageDelete: () => Effect.never,
  DraftThreadCreate: () => Effect.never,
  AgentRunStart: () => Effect.never,
  CollabWatch: () => Stream.empty
})

const makeServer = <H extends Parameters<typeof CollabRpcs.of>[0]>(handlers: H) =>
  RpcServer.layer(CollabRpcs, serverConfig).pipe(
    Layer.provide(CollabRpcs.toLayer(handlers)),
    Layer.provideMerge(layerIpcServer)
  )

function clientAdapter(port: MessagePort): IpcClientPort {
  const adapter: IpcClientPort = {
    onmessage: null,
    postMessage: (message) => port.postMessage(message),
    start: () => port.start(),
    close: () => port.close()
  }
  port.on("message", (data: string | Uint8Array) => {
    adapter.onmessage?.({ data })
  })
  return adapter
}

function serverAdapter(port: MessagePort): IpcServerPort {
  const listeners = new Map<(event: { data: string | Uint8Array }) => void, (data: string | Uint8Array) => void>()
  return {
    on: (event, listener) => {
      if (event === "message") {
        const wrapped = (data: string | Uint8Array) => listener({ data })
        listeners.set(listener, wrapped)
        port.on("message", wrapped)
      } else {
        port.on("close", listener)
      }
    },
    off: (event, listener) => {
      if (event === "message") {
        const wrapped = listeners.get(listener)
        if (wrapped !== undefined) {
          port.off("message", wrapped)
          listeners.delete(listener)
        }
      } else {
        port.off("close", listener)
      }
    },
    postMessage: (message) => port.postMessage(message),
    start: () => port.start(),
    close: () => port.close()
  }
}

describe("layerIpc transport (client <-> server over a MessagePort)", () => {
  it("round-trips a unary collaboration snapshot call end-to-end", async () => {
    const channel = new MessageChannel()
    const server = makeServer({
      ...baseHandlers(),
      CollabGetSnapshot: () => Effect.succeed(SNAPSHOT_A)
    })
    const program = Effect.gen(function*() {
      const handoff = yield* RpcPortHandoff
      handoff.bind(serverAdapter(channel.port2))
      const client = yield* RpcClient.make(CollabRpcs)
      return yield* client.CollabGetSnapshot()
    }).pipe(
      Effect.provide(layerIpcClient(clientAdapter(channel.port1))),
      Effect.provide(server),
      Effect.scoped
    )

    const snapshot = await Effect.runPromise(program)

    expect(snapshot).toStrictEqual(SNAPSHOT_A)

    channel.port1.close()
    channel.port2.close()
  })

  it("round-trips a handler failure as a typed tagged error over the wire", async () => {
    const channel = new MessageChannel()
    const server = makeServer({
      ...baseHandlers(),
      DraftThreadCreate: () =>
        Effect.fail(new CollabPolicyDenied({
          action: "agent_run.create_draft",
          detail: "The selected agent is not enabled in this channel."
        }))
    })
    const program = Effect.gen(function*() {
      const handoff = yield* RpcPortHandoff
      handoff.bind(serverAdapter(channel.port2))
      const client = yield* RpcClient.make(CollabRpcs)
      return yield* Effect.flip(client.DraftThreadCreate({
        channelId,
        agentId: "agent-missing" as AgentId,
        selectedMessageIds: ["message-1" as ChannelMessageId],
        prompt: "Summarize the selected context."
      }))
    }).pipe(
      Effect.provide(layerIpcClient(clientAdapter(channel.port1))),
      Effect.provide(server),
      Effect.scoped
    )

    const error = await Effect.runPromise(program)

    expect(error._tag).toBe("CollabPolicyDenied")
    expect((error as CollabPolicyDenied).action).toBe("agent_run.create_draft")

    channel.port1.close()
    channel.port2.close()
  })

  it("rejects blank text at the payload boundary (NonEmptyTrimmedString)", async () => {
    const channel = new MessageChannel()
    const server = makeServer(baseHandlers())
    const program = Effect.gen(function*() {
      const handoff = yield* RpcPortHandoff
      handoff.bind(serverAdapter(channel.port2))
      const client = yield* RpcClient.make(CollabRpcs)
      return yield* client.WorkspaceAgentRegister({
        displayName: "   ",
        description: "Local review agent",
        providerName: "local-fake",
        declaredCapabilities: ["read_channel_context"],
        grantedCapabilities: ["read_channel_context"]
      }).pipe(Effect.exit)
    }).pipe(
      Effect.provide(layerIpcClient(clientAdapter(channel.port1))),
      Effect.provide(server),
      Effect.scoped
    )

    const exit = await Effect.runPromise(program)

    expect(exit._tag).toBe("Failure")

    channel.port1.close()
    channel.port2.close()
  })

  it("delivers a server-streamed sequence of collaboration snapshots in order", async () => {
    const channel = new MessageChannel()
    const server = makeServer({
      ...baseHandlers(),
      CollabWatch: () => Stream.fromIterable([SNAPSHOT_A, SNAPSHOT_B])
    })
    const program = Effect.gen(function*() {
      const handoff = yield* RpcPortHandoff
      handoff.bind(serverAdapter(channel.port2))
      const client = yield* RpcClient.make(CollabRpcs)
      const collected = yield* Stream.runCollect(client.CollabWatch())
      return Chunk.toReadonlyArray(collected)
    }).pipe(
      Effect.provide(layerIpcClient(clientAdapter(channel.port1))),
      Effect.provide(server),
      Effect.scoped
    )

    const emissions = await Effect.runPromise(program)

    expect(emissions).toStrictEqual([SNAPSHOT_A, SNAPSHOT_B])

    channel.port1.close()
    channel.port2.close()
  })

  it("ships a handler defect to the client without poisoning concurrent requests", async () => {
    let resolveFirst!: () => void
    const gotFirst = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    let streamErrored = false

    const channel = new MessageChannel()
    const server = makeServer({
      ...baseHandlers(),
      WorkspaceAgentRegister: () => Effect.die("boom"),
      CollabGetSnapshot: () => Effect.succeed(SNAPSHOT_A),
      CollabWatch: () => Stream.make(SNAPSHOT_A).pipe(Stream.concat(Stream.never))
    })
    const program = Effect.gen(function*() {
      const handoff = yield* RpcPortHandoff
      handoff.bind(serverAdapter(channel.port2))
      const client = yield* RpcClient.make(CollabRpcs)

      const watcher = yield* Effect.forkScoped(
        Stream.runForEach(client.CollabWatch(), () => Effect.sync(() => resolveFirst())).pipe(
          Effect.catchAllCause(() =>
            Effect.sync(() => {
              streamErrored = true
            })
          )
        )
      )
      yield* Effect.promise(() => gotFirst)

      const cause = yield* client.WorkspaceAgentRegister({
        displayName: "Hermes",
        description: "Local review agent",
        providerName: "local-fake",
        declaredCapabilities: ["read_channel_context"],
        grantedCapabilities: ["read_channel_context"]
      }).pipe(Effect.sandbox, Effect.flip)

      yield* Effect.sleep("100 millis")
      const after = yield* client.CollabGetSnapshot()

      return { after, cause, running: watcher.unsafePoll() === null }
    }).pipe(
      Effect.provide(layerIpcClient(clientAdapter(channel.port1))),
      Effect.provide(server),
      Effect.scoped
    )

    const { after, cause, running } = await Effect.runPromise(program)

    expect(Cause.pretty(cause)).toContain("boom")
    expect(streamErrored).toBe(false)
    expect(running).toBe(true)
    expect(after).toStrictEqual(SNAPSHOT_A)

    channel.port1.close()
    channel.port2.close()
  })

  it("interrupts the previous client's in-flight server stream on a port swap", async () => {
    let resolveFirst!: () => void
    const gotFirst = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    let wasInterrupted = false
    let resolveInterrupted!: () => void
    const interrupted = new Promise<void>((resolve) => {
      resolveInterrupted = resolve
    })

    const channel1 = new MessageChannel()
    const channel2 = new MessageChannel()
    const server = makeServer({
      ...baseHandlers(),
      CollabWatch: () =>
        Stream.make(SNAPSHOT_A).pipe(
          Stream.concat(Stream.never),
          Stream.ensuring(
            Effect.sync(() => {
              wasInterrupted = true
              resolveInterrupted()
            })
          )
        )
    })

    const program = Effect.gen(function*() {
      const handoff = yield* RpcPortHandoff
      handoff.bind(serverAdapter(channel1.port2))
      const client = yield* RpcClient.make(CollabRpcs)

      yield* Effect.forkScoped(
        Stream.runForEach(client.CollabWatch(), () => Effect.sync(() => resolveFirst()))
      )
      yield* Effect.promise(() => gotFirst)

      handoff.bind(serverAdapter(channel2.port2))

      yield* Effect.promise(() => interrupted).pipe(
        Effect.timeoutFail({
          duration: "5 seconds",
          onTimeout: () => new Error("in-flight server stream was not interrupted on swap")
        })
      )
    }).pipe(
      Effect.provide(layerIpcClient(clientAdapter(channel1.port1))),
      Effect.provide(server),
      Effect.scoped
    )

    await Effect.runPromise(program)

    expect(wasInterrupted).toBe(true)

    channel1.port1.close()
    channel1.port2.close()
    channel2.port1.close()
    channel2.port2.close()
  })

  it("client transport swallows a parser decode error instead of throwing in the message callback", async () => {
    const throwingSerialization = Layer.succeed(
      RpcSerialization.RpcSerialization,
      RpcSerialization.RpcSerialization.of({
        contentType: "application/x-broken",
        includesFraming: true,
        unsafeMake: () => ({
          decode: () => {
            throw new Error("bad frame")
          },
          encode: () => undefined
        })
      })
    )
    let handler: ((event: { data: string | Uint8Array }) => void) | null = null
    const fakePort: IpcClientPort = {
      get onmessage() {
        return handler
      },
      set onmessage(next) {
        handler = next
      },
      postMessage: () => {},
      start: () => {},
      close: () => {}
    }

    await Effect.runPromise(
      Effect.gen(function*() {
        yield* makeIpcClientProtocol(fakePort)
        expect(handler).not.toBeNull()
        expect(() => handler?.({ data: new Uint8Array([1, 2, 3]) })).not.toThrow()
      }).pipe(Effect.provide(throwingSerialization), Effect.scoped)
    )
  })
})
