// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentType } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Id } from "../../convex/_generated/dataModel"
import { ChannelMessage, CollabSnapshot } from "../shared/collab-rpc"
import { dogfoodChatToCollabSnapshot, type DogfoodChannelMessageView, type DogfoodWorkspaceView } from "./dogfood-chat"

const mocks = vi.hoisted(() => ({
  auth: {
    isLoading: false,
    user: null as null | { readonly id: string },
    signOut: vi.fn(),
    getSignInUrl: vi.fn()
  },
  ensureViewer: vi.fn(),
  sendMessage: vi.fn(),
  mutationCallCount: 0,
  workspace: undefined as DogfoodWorkspaceView | null | undefined,
  messages: undefined as ReadonlyArray<DogfoodChannelMessageView> | undefined
}))

vi.mock("@workos-inc/authkit-react", () => ({
  useAuth: () => mocks.auth
}))

vi.mock("convex/react", () => ({
  useMutation: () => {
    mocks.mutationCallCount += 1
    return mocks.mutationCallCount % 2 === 1 ? mocks.ensureViewer : mocks.sendMessage
  },
  useQuery: (_query: unknown, args: unknown) => {
    if (args === "skip") return undefined
    return typeof args === "object" && args !== null && "channelId" in args ? mocks.messages : mocks.workspace
  }
}))

vi.mock("./App", () => ({
  WorkspaceChat: ((props: {
    readonly model: CollabSnapshot
    readonly createChannelMessage: (input: { readonly channelId: string; readonly body: string }) => Promise<unknown>
    readonly profileMenuActions?: ReadonlyArray<{ readonly label: string; readonly onSelect: () => void }>
  }) => (
    <section aria-label="mock workspace chat">
      <h2>{props.model.workspace.name}</h2>
      <p>{props.model.channelMessages[0]?.body}</p>
      <button
        type="button"
        onClick={() => props.createChannelMessage({ channelId: props.model.channel.id, body: "Hello from dogfood" })}
      >
        Send mock message
      </button>
      <button type="button" onClick={() => props.profileMenuActions?.[0]?.onSelect()}>
        Sign out
      </button>
    </section>
  )) satisfies ComponentType<any>
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  mocks.auth.isLoading = false
  mocks.auth.user = null
  mocks.auth.getSignInUrl.mockResolvedValue("https://api.workos.com/user_management/authorize")
  mocks.ensureViewer.mockResolvedValue({})
  mocks.sendMessage.mockResolvedValue({})
  mocks.mutationCallCount = 0
  mocks.workspace = undefined
  mocks.messages = undefined
})

const workspace: DogfoodWorkspaceView = {
  currentUser: {
    id: "user-1" as Id<"users">,
    displayName: "Maya Patel"
  },
  workspace: {
    id: "workspace-1" as Id<"workspaces">,
    name: "Aether Dogfood"
  },
  channel: {
    id: "channel-1" as Id<"channels">,
    name: "general",
    visibility: "private"
  }
}

const messages: ReadonlyArray<DogfoodChannelMessageView> = [
  {
    id: "message-1" as Id<"messages">,
    channelId: "channel-1" as Id<"channels">,
    authorUserId: "user-1" as Id<"users">,
    authorDisplayName: "Maya Patel",
    body: "Dogfood chat is live.",
    createdAt: 42
  }
]

describe("dogfoodChatToCollabSnapshot", () => {
  it("adapts the Convex dogfood chat view into the legacy WorkspaceChat model", () => {
    const snapshot = dogfoodChatToCollabSnapshot({ workspace, messages })

    expect(snapshot).toBeInstanceOf(CollabSnapshot)
    expect(snapshot.currentUser.displayName).toBe("Maya Patel")
    expect(snapshot.workspace.name).toBe("Aether Dogfood")
    expect(snapshot.channel.name).toBe("general")
    expect(snapshot.channel.createdBy).toBe(snapshot.currentUser.id)
    expect(snapshot.channelMessages).toHaveLength(1)
    expect(snapshot.channelMessages[0]).toBeInstanceOf(ChannelMessage)
    expect(snapshot.channelMessages[0]).toMatchObject({
      authorType: "human",
      authorDisplayName: "Maya Patel",
      body: "Dogfood chat is live.",
      deletedAt: null
    })
  })

  it("keeps agent-era snapshot fields empty while the dogfood path is chat-only", () => {
    const snapshot = dogfoodChatToCollabSnapshot({ workspace, messages })

    expect(snapshot.workspaceAgents).toEqual([])
    expect(snapshot.channelAgentEnablements).toEqual([])
    expect(snapshot.threads).toEqual([])
    expect(snapshot.threadMessages).toEqual([])
    expect(snapshot.agentRuns).toEqual([])
    expect(snapshot.auditEvents).toEqual([])
  })
})

describe("ConvexDogfoodApp", () => {
  it("shows the sign-in entry state when signed out", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")

    render(<ConvexDogfoodApp />)

    expect(screen.getByRole("heading", { name: "Aether Dogfood" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy()
  })

  it("shows access setup errors from ensureViewer", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.ensureViewer.mockRejectedValue(new Error("This email is not on the Aether dogfood allowlist"))

    render(<ConvexDogfoodApp />)

    expect(await screen.findByRole("heading", { name: "Could Not Join" })).toBeTruthy()
    expect(screen.getByText("This email is not on the Aether dogfood allowlist")).toBeTruthy()
  })

  it("wires the profile sign-out action through the reused chat surface", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.workspace = workspace
    mocks.messages = messages

    render(<ConvexDogfoodApp />)

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }))

    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1)
  })

  it("sends messages through the Convex mutation using the active channel", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.workspace = workspace
    mocks.messages = messages

    render(<ConvexDogfoodApp />)

    fireEvent.click(await screen.findByRole("button", { name: "Send mock message" }))

    await waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith({
        channelId: workspace.channel.id,
        body: "Hello from dogfood"
      })
    )
  })
})
