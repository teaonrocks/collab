import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, type Scope } from "effect"
import { afterEach, beforeEach, vi } from "vitest"
import type { AgentId } from "../shared/collab-rpc"
import { CollabRepo } from "./collab-repo"

const electron = vi.hoisted(() => ({ userDataDir: "" }))
vi.mock("electron", () => ({ app: { getPath: () => electron.userDataDir } }))

let filePath: string
beforeEach(() => {
  electron.userDataDir = mkdtempSync(join(tmpdir(), "collab-"))
  filePath = join(electron.userDataDir, "aether-collab.json")
})
afterEach(() => {
  rmSync(electron.userDataDir, { recursive: true, force: true })
})

const makeRepo = Effect.provide(CollabRepo, CollabRepo.Default)

const run = <A, E>(self: Effect.Effect<A, E, FileSystem.FileSystem | Scope.Scope>) =>
  self.pipe(Effect.provide(NodeContext.layer), Effect.scoped)

const registerAgent = (repo: CollabRepo) =>
  repo.registerAgent({
    displayName: "Hermes",
    description: "Local review agent",
    providerName: "local-fake",
    declaredCapabilities: ["read_channel_context", "write_thread_message"],
    grantedCapabilities: ["read_channel_context", "write_thread_message"]
  })

describe("CollabRepo (filesystem-backed MVP collaboration store)", () => {
  it.effect("loads a seeded workspace, channel, current user, and channel messages", () =>
    run(Effect.gen(function*() {
      const repo = yield* makeRepo
      const snapshot = yield* repo.snapshot

      expect(snapshot.workspace.name).toBe("Aether Labs")
      expect(snapshot.channel.name).toBe("origination")
      expect(snapshot.workspaceRole).toBe("admin")
      expect(snapshot.channelMessages).toHaveLength(3)
    })))

  it.effect("registers a workspace agent and enables it in the channel", () =>
    run(Effect.gen(function*() {
      const repo = yield* makeRepo
      const agent = yield* registerAgent(repo)
      const snapshot = yield* repo.snapshot
      const enablement = yield* repo.enableAgent({
        channelId: snapshot.channel.id,
        agentId: agent.id,
        channelGrants: agent.grantedCapabilities
      })
      const next = yield* repo.snapshot

      expect(agent.displayName).toBe("Hermes")
      expect(enablement.status).toBe("enabled")
      expect(next.workspaceAgents).toStrictEqual([agent])
      expect(next.channelAgentEnablements).toStrictEqual([enablement])
      expect(next.auditEvents.map((event) => event.eventType)).toContain("workspace_agent.registered")
      expect(next.auditEvents.map((event) => event.eventType)).toContain("channel_agent.enabled")
    })))

  it.effect("creates and soft-deletes channel messages", () =>
    run(Effect.gen(function*() {
      const repo = yield* makeRepo
      const snapshot = yield* repo.snapshot

      const message = yield* repo.createChannelMessage({
        channelId: snapshot.channel.id,
        body: "Can someone check the partner wording?"
      })
      const afterCreate = yield* repo.snapshot
      const deleted = yield* repo.deleteChannelMessage({
        channelId: snapshot.channel.id,
        messageId: message.id
      })
      const afterDelete = yield* repo.snapshot

      expect(message.authorDisplayName).toBe(snapshot.currentUser.displayName)
      expect(afterCreate.channelMessages.map((item) => item.id)).toContain(message.id)
      expect(deleted.deletedAt).not.toBeNull()
      expect(afterDelete.channelMessages.find((item) => item.id === message.id)?.deletedAt).not.toBeNull()
      expect(afterDelete.auditEvents.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(["channel_message.created", "channel_message.deleted"])
      )
    })))

  it.effect("creates replies and marks parent previews deleted when the parent is soft-deleted", () =>
    run(Effect.gen(function*() {
      const repo = yield* makeRepo
      const snapshot = yield* repo.snapshot
      const parent = snapshot.channelMessages[0]!

      const reply = yield* repo.createChannelMessage({
        channelId: snapshot.channel.id,
        body: "I can turn this into a reply.",
        parentMessageId: parent.id
      })
      yield* repo.deleteChannelMessage({
        channelId: snapshot.channel.id,
        messageId: parent.id
      })
      const afterDelete = yield* repo.snapshot

      expect(reply.parentMessageId).toBe(parent.id)
      expect(reply.parentMessage).toMatchObject({
        id: parent.id,
        authorDisplayName: parent.authorDisplayName,
        bodyPreview: parent.body,
        deleted: false
      })
      expect(afterDelete.channelMessages.find((message) => message.id === reply.id)?.parentMessage).toMatchObject({
        id: parent.id,
        authorDisplayName: parent.authorDisplayName,
        bodyPreview: "",
        deleted: true
      })
    })))

  it.effect("creates a private draft thread with selected context before any run exists", () =>
    run(Effect.gen(function*() {
      const repo = yield* makeRepo
      const agent = yield* registerAgent(repo)
      const snapshot = yield* repo.snapshot
      yield* repo.enableAgent({
        channelId: snapshot.channel.id,
        agentId: agent.id,
        channelGrants: agent.grantedCapabilities
      })
      const message = snapshot.channelMessages[0]!

      const thread = yield* repo.createDraftThread({
        channelId: snapshot.channel.id,
        agentId: agent.id,
        selectedMessageIds: [message.id],
        prompt: "Summarize the risk."
      })
      const next = yield* repo.snapshot
      const threadMessages = next.threadMessages.filter((item) => item.threadId === thread.id)

      expect(thread.status).toBe("draft")
      expect(thread.visibility).toBe("private")
      expect(next.agentRuns).toStrictEqual([])
      expect(threadMessages.map((item) => item.messageKind)).toStrictEqual(["selected_context", "normal"])
      expect(next.auditEvents.map((event) => event.eventType)).toContain("draft_thread.created")
      expect(next.auditEvents.map((event) => event.eventType)).toContain("context.selected")
      expect(next.auditEvents.map((event) => event.eventType)).not.toContain("context.reviewed")
    })))

  it.effect("starts a fake local agent run and records response provenance plus audit", () =>
    run(Effect.gen(function*() {
      const repo = yield* makeRepo
      const agent = yield* registerAgent(repo)
      const snapshot = yield* repo.snapshot
      yield* repo.enableAgent({
        channelId: snapshot.channel.id,
        agentId: agent.id,
        channelGrants: agent.grantedCapabilities
      })
      const thread = yield* repo.createDraftThread({
        channelId: snapshot.channel.id,
        agentId: agent.id,
        selectedMessageIds: [snapshot.channelMessages[0]!.id, snapshot.channelMessages[1]!.id],
        prompt: "Prepare the partner summary."
      })

      const result = yield* repo.startRun(thread.id)
      const next = yield* repo.snapshot

      expect(result.thread.status).toBe("completed")
      expect(result.run.status).toBe("completed")
      expect(result.responseMessage.messageKind).toBe("agent_output")
      expect(result.responseMessage.provenance?.agentId).toBe(agent.id)
      expect(result.responseMessage.provenance?.runId).toBe(result.run.id)
      expect(next.agentRuns).toStrictEqual([result.run])
      expect(next.auditEvents.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(["context.reviewed", "agent_run.started", "agent_response.created", "agent_run.completed"])
      )
    })))

  it.effect("denies draft creation without selected context", () =>
    run(Effect.gen(function*() {
      const repo = yield* makeRepo
      const snapshot = yield* repo.snapshot
      const error = yield* Effect.flip(repo.createDraftThread({
        channelId: snapshot.channel.id,
        agentId: "missing" as AgentId,
        selectedMessageIds: [],
        prompt: "Try anyway."
      }))

      expect(error._tag).toBe("CollabPolicyDenied")
      if (error._tag === "CollabPolicyDenied") {
        expect(error.action).toBe("context.select")
      }
    })))

  it.effect("persists collaboration state across a fresh repo instance", () =>
    run(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const repo1 = yield* makeRepo
      yield* registerAgent(repo1)
      expect(yield* fs.readFileString(filePath)).toContain("Hermes")

      const repo2 = yield* makeRepo
      const reloaded = yield* repo2.snapshot
      expect(reloaded.workspaceAgents.map((agent) => agent.displayName)).toContain("Hermes")
    })))
})
