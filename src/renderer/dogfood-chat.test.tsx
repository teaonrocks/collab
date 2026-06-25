// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentType } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Id } from "../../convex/_generated/dataModel"
import { ChannelMessage } from "../shared/collab-rpc"
import { dogfoodChatToChatData, type DogfoodChannelMessageView, type DogfoodWorkspaceView } from "./dogfood-chat"

const mocks = vi.hoisted(() => ({
  auth: {
    isLoading: false,
    user: null as null | { readonly id: string },
    signOut: vi.fn(),
    getSignInUrl: vi.fn()
  },
  convexAuth: {
    isLoading: false,
    isAuthenticated: false
  },
  ensureViewer: vi.fn(),
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  mutationCallCount: 0,
  workspace: undefined as DogfoodWorkspaceView | null | undefined,
  messages: undefined as ReadonlyArray<DogfoodChannelMessageView> | undefined
}))

vi.mock("@workos-inc/authkit-react", () => ({
  useAuth: () => mocks.auth
}))

vi.mock("convex/react", () => ({
  useConvexAuth: () => mocks.convexAuth,
  useAction: () => mocks.ensureViewer,
  useMutation: () => {
    const mutation = [mocks.sendMessage, mocks.editMessage, mocks.deleteMessage][mocks.mutationCallCount % 3]
    mocks.mutationCallCount += 1
    return mutation
  },
  useQuery: (_query: unknown, args: unknown) => {
    if (args === "skip") return undefined
    return typeof args === "object" && args !== null && "channelId" in args ? mocks.messages : mocks.workspace
  }
}))

vi.mock("./App", () => ({
  WorkspaceChat: ((props: {
    readonly model: {
      readonly workspace: { readonly name: string }
      readonly channel: { readonly id: string }
      readonly channelMessages: ReadonlyArray<ChannelMessage>
    }
  readonly createChannelMessage: (input: { readonly channelId: string; readonly body: string }) => Promise<unknown>
  readonly editChannelMessage?: (input: { readonly channelId: string; readonly messageId: string; readonly body: string }) => Promise<unknown>
  readonly deleteChannelMessage: (input: { readonly channelId: string; readonly messageId: string }) => Promise<unknown>
  readonly operationErrorMessage?: (operation: "send" | "edit" | "delete", cause: unknown) => string
  readonly canEditMessage?: (message: ChannelMessage) => boolean
  readonly canDeleteMessage?: (message: ChannelMessage) => boolean
  readonly profileMenuActions?: ReadonlyArray<{ readonly label: string; readonly onSelect: () => void }>
}) => {
    const firstMessage = props.model.channelMessages[0]
    const secondMessage = props.model.channelMessages[1]
    return (
      <section aria-label="mock workspace chat">
        <h2>{props.model.workspace.name}</h2>
        <p>{firstMessage?.body}</p>
        {firstMessage?.editedAt === null ? null : <span>edited</span>}
        <button
          type="button"
          onClick={() => props.createChannelMessage({ channelId: props.model.channel.id, body: "Hello from dogfood" })}
        >
          Send mock message
        </button>
        {firstMessage !== undefined && props.canEditMessage?.(firstMessage)
          ? (
            <button
              type="button"
              onClick={() => props.editChannelMessage?.({
                channelId: props.model.channel.id,
                messageId: firstMessage.id,
                body: "Edited dogfood"
              })}
            >
              Edit first message
            </button>
          )
          : null}
        {firstMessage !== undefined && props.canDeleteMessage?.(firstMessage)
          ? (
            <button
              type="button"
              onClick={() => props.deleteChannelMessage({
                channelId: props.model.channel.id,
                messageId: firstMessage.id
              })}
            >
              Delete first message
            </button>
          )
          : null}
        {secondMessage !== undefined && props.canEditMessage?.(secondMessage)
          ? <button type="button">Edit second message</button>
          : null}
        {secondMessage !== undefined && props.canDeleteMessage?.(secondMessage)
          ? <button type="button">Delete second message</button>
          : null}
        <button type="button" onClick={() => props.profileMenuActions?.[0]?.onSelect()}>
          Sign out
        </button>
        <p>{props.operationErrorMessage?.("send", new Error("secret mutation details"))}</p>
      </section>
    )
  }) satisfies ComponentType<any>
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  mocks.auth.isLoading = false
  mocks.auth.user = null
  mocks.auth.getSignInUrl.mockResolvedValue("https://api.workos.com/user_management/authorize")
  mocks.convexAuth.isLoading = false
  mocks.convexAuth.isAuthenticated = false
  mocks.ensureViewer.mockResolvedValue({})
  mocks.sendMessage.mockResolvedValue({})
  mocks.editMessage.mockResolvedValue({})
  mocks.deleteMessage.mockResolvedValue({})
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

const messagesWithAnotherAuthor: ReadonlyArray<DogfoodChannelMessageView> = [
  ...messages,
  {
    id: "message-2" as Id<"messages">,
    channelId: "channel-1" as Id<"channels">,
    authorUserId: "user-2" as Id<"users">,
    authorDisplayName: "Lee Chen",
    body: "Another teammate is here.",
    createdAt: 43
  }
]

describe("dogfoodChatToChatData", () => {
  it("adapts the Convex dogfood chat view into the chat data interface", () => {
    const chatData = dogfoodChatToChatData({
      workspace,
      messages,
      sendMessage: mocks.sendMessage,
      editMessage: mocks.editMessage,
      deleteMessage: mocks.deleteMessage
    })

    expect(chatData.model.currentUser.displayName).toBe("Maya Patel")
    expect(chatData.model.workspace.name).toBe("Aether Dogfood")
    expect(chatData.model.channel.name).toBe("general")
    expect(chatData.model.channel.createdBy).toBe(chatData.model.currentUser.id)
    expect(chatData.model.channelMessages).toHaveLength(1)
    expect(chatData.model.channelMessages[0]).toBeInstanceOf(ChannelMessage)
    expect(chatData.model.channelMessages[0]).toMatchObject({
      authorType: "human",
      authorDisplayName: "Maya Patel",
      body: "Dogfood chat is live.",
      editedAt: null,
      deletedAt: null
    })
  })

  it("preserves Convex editedAt in the chat data model", () => {
    const chatData = dogfoodChatToChatData({
      workspace,
      messages: [{ ...messages[0]!, editedAt: 45 }],
      sendMessage: mocks.sendMessage,
      editMessage: mocks.editMessage,
      deleteMessage: mocks.deleteMessage
    })

    expect(chatData.model.channelMessages[0]?.editedAt).toBe(45)
  })

  it("uses Convex ids for chat commands without exposing snapshot-era fields", async () => {
    const chatData = dogfoodChatToChatData({
      workspace,
      messages,
      sendMessage: mocks.sendMessage,
      editMessage: mocks.editMessage,
      deleteMessage: mocks.deleteMessage
    })

    await chatData.createChannelMessage({ channelId: chatData.model.channel.id, body: "Ship chat first." })
    await chatData.editChannelMessage?.({
      channelId: chatData.model.channel.id,
      messageId: chatData.model.channelMessages[0]!.id,
      body: "Edited dogfood"
    })
    await chatData.deleteChannelMessage({
      channelId: chatData.model.channel.id,
      messageId: chatData.model.channelMessages[0]!.id
    })

    expect(mocks.sendMessage).toHaveBeenCalledWith({ channelId: workspace.channel.id, body: "Ship chat first." })
    expect(mocks.editMessage).toHaveBeenCalledWith({
      channelId: workspace.channel.id,
      messageId: messages[0]!.id,
      body: "Edited dogfood"
    })
    expect(mocks.deleteMessage).toHaveBeenCalledWith({ channelId: workspace.channel.id, messageId: messages[0]!.id })
    expect("workspaceAgents" in chatData.model).toBe(false)
    expect("agentRuns" in chatData.model).toBe(false)
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
    mocks.convexAuth.isAuthenticated = true
    mocks.ensureViewer.mockRejectedValue(new Error("This email is not on the Aether dogfood allowlist"))

    render(<ConvexDogfoodApp />)

    expect(await screen.findByRole("heading", { name: "Could Not Join" })).toBeTruthy()
    expect(screen.getByText("This email is not on the Aether dogfood allowlist")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  })

  it("can retry viewer setup after an access setup error", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.ensureViewer.mockRejectedValueOnce(new Error("WorkOS user profile is missing an email address"))

    render(<ConvexDogfoodApp />)

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }))

    await waitFor(() => expect(mocks.ensureViewer).toHaveBeenCalledTimes(2))
  })

  it("wires the profile sign-out action through the reused chat surface", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.messages = messages

    render(<ConvexDogfoodApp />)

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }))

    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1)
  })

  it("sends messages through the Convex mutation using the active channel", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
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

  it("wires edit and hard delete mutations for the current author only", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.messages = messagesWithAnotherAuthor

    render(<ConvexDogfoodApp />)

    expect(await screen.findByRole("button", { name: "Edit first message" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Delete first message" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Edit second message" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Delete second message" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Edit first message" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete first message" }))

    await waitFor(() =>
      expect(mocks.editMessage).toHaveBeenCalledWith({
        channelId: workspace.channel.id,
        messageId: messages[0]!.id,
        body: "Edited dogfood"
      })
    )
    expect(mocks.deleteMessage).toHaveBeenCalledWith({
      channelId: workspace.channel.id,
      messageId: messages[0]!.id
    })
  })

  it("passes compact dogfood mutation errors into the reused chat surface", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.messages = messages

    render(<ConvexDogfoodApp />)

    expect(await screen.findByText("Could not send message. Check your connection and try again.")).toBeTruthy()
    expect(screen.queryByText(/secret mutation details/)).toBeNull()
  })

  it("waits for Convex to authenticate before initializing the viewer", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isLoading = true
    mocks.convexAuth.isAuthenticated = false

    render(<ConvexDogfoodApp />)

    expect(screen.getByRole("heading", { name: "Checking Session" })).toBeTruthy()
    expect(screen.getByText("Waiting for your AuthKit session to reach Convex...")).toBeTruthy()
    expect(mocks.ensureViewer).not.toHaveBeenCalled()
  })
})
