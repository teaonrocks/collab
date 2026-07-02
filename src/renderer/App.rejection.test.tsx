// @vitest-environment happy-dom
import { Atom } from "@effect-atom/atom"
import { RegistryProvider } from "@effect-atom/atom-react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Effect, Layer, Stream } from "effect"
import { afterEach, describe, expect, it } from "vitest"
import {
  Channel,
  ChannelMessage,
  type ChannelMessageId,
  CollabPolicyDenied,
  CollabSnapshot,
  HumanAccount,
  type HumanAccountId,
  Workspace,
  type WorkspaceId
} from "../shared/collab-rpc"
import { App } from "./App"
import { layerLegacyChatDataFromCollabApi as layerChatDataFromCollabApi } from "./legacy-chat-data"
import { CollabApi } from "./collab-api"
import { runtime } from "./collab-atoms"

afterEach(cleanup)

const userId = "human-1" as HumanAccountId
const workspaceId = "workspace-1" as WorkspaceId
const channelId = "channel-1" as Channel["id"]

const model = new CollabSnapshot({
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
      body: "The partner brief needs a concise risk summary.",
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

const failingMessageLayer = Layer.succeed(
  CollabApi,
  CollabApi.of({
    snapshot: () => Effect.succeed(model),
    registerAgent: () => Effect.die("not used"),
    enableAgent: () => Effect.die("not used"),
    createChannelMessage: () =>
      Effect.fail(new CollabPolicyDenied({
        action: "channel_message.create",
        detail: "nope"
      })),
    deleteChannelMessage: () => Effect.die("not used"),
    createDraftThread: () => Effect.die("not used"),
    startRun: () => Effect.die("not used"),
    changes: () => Stream.make(model)
  })
)

const mockRendererDataLayer = (layer: Layer.Layer<CollabApi>) =>
  Layer.merge(layer, layerChatDataFromCollabApi.pipe(Layer.provide(layer)))

describe("App mutation failure handling", () => {
  it("does not leak an unhandled promise rejection when message send fails", async () => {
    const rejections: Array<unknown> = []
    const handler = (reason: unknown) => rejections.push(reason)
    process.on("unhandledRejection", handler)
    try {
      render(
        <RegistryProvider
          initialValues={[Atom.initialValue(runtime.layer, mockRendererDataLayer(failingMessageLayer))]}
          scheduleTask={(f) => f()}
        >
          <App />
        </RegistryProvider>
      )

      const input = await screen.findByPlaceholderText("Message origination")
      fireEvent.change(input, { target: { value: "Ship chat first." } })
      fireEvent.submit(input.closest("form")!)

      await new Promise((r) => setTimeout(r, 50))

      expect(rejections).toEqual([])
    } finally {
      process.off("unhandledRejection", handler)
    }
  })
})
