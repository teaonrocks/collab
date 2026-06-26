import { RpcSerialization } from "@effect/rpc"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import {
  AuditEvent,
  type AuditEventId,
  Channel,
  ChannelMessage,
  ChannelMessageAttachment,
  type ChannelMessageId,
  CollabRpcs,
  CollabSnapshot,
  HumanAccount,
  type HumanAccountId,
  Workspace,
  type WorkspaceId
} from "./collab-rpc"

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
        deletedAt: null,
        attachments: [
          new ChannelMessageAttachment({
            id: "attachment-1",
            storageId: "storage-1",
            name: "risk-summary.png",
            contentType: "image/png",
            size: 1234,
            kind: "image",
            url: "https://files.example/risk-summary.png"
          })
        ]
      })
    ],
    workspaceAgents: [],
    channelAgentEnablements: [],
    threads: [],
    threadMessages: [],
    agentRuns: [],
    auditEvents: [
      new AuditEvent({
        id: "audit-1" as AuditEventId,
        workspaceId,
        actorType: "system",
        actorId: "platform",
        eventType: "snapshot.created",
        targetType: "workspace",
        targetId: workspaceId,
        sourceChannelId: null,
        threadId: null,
        runId: null,
        result: "succeeded",
        detail: "",
        createdAt: 3
      })
    ]
  })

describe("CollabRpcs contract", () => {
  it("exposes the expected RPC tags (inventory / drift guard)", () => {
    const tags = new Set(CollabRpcs.requests.keys())
    const expected = [
      "CollabGetSnapshot",
      "WorkspaceAgentRegister",
      "ChannelAgentEnable",
      "ChannelMessageCreate",
      "ChannelMessageDelete",
      "DraftThreadCreate",
      "AgentRunStart",
      "CollabWatch"
    ]
    for (const tag of expected) {
      expect(tags.has(tag)).toBe(true)
    }
    expect(tags.size).toBe(expected.length)
  })

  it.effect("round-trips a CollabSnapshot through encode -> MsgPack -> decode", () =>
    Effect.gen(function*() {
      const serialization = yield* RpcSerialization.RpcSerialization
      const parser = serialization.unsafeMake()
      const snapshot = makeSnapshot()

      const wire = yield* Schema.encode(CollabSnapshot)(snapshot)
      const [unpacked] = parser.decode(parser.encode(wire) as Uint8Array)
      const decoded = yield* Schema.decodeUnknown(CollabSnapshot)(unpacked)

      expect(decoded).toStrictEqual(snapshot)
    }).pipe(Effect.provide(RpcSerialization.layerMsgPack)))
})
