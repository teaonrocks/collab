// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { getFunctionName } from "convex/server"
import type { ComponentType } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Id } from "../../convex/_generated/dataModel"
import { ConvexDogfoodApp, DogfoodErrorBoundary } from "./dogfood-chat"
import {
  dogfoodChatToChatData,
  type DogfoodChatAdapterInput,
  type DogfoodChannelMemberView,
  type DogfoodChannelMessageView,
  type DogfoodChannelView,
  type DogfoodDirectConversationView,
  type DogfoodPrivateChannelInviteCandidateView,
  type DogfoodWorkspaceView
} from "./dogfood-chat-adapter"
import type { WorkspaceChatProps } from "./workspace-chat"

const mocks = vi.hoisted(() => ({
  auth: {
    isLoading: false,
    user: null as null | {
      readonly id: string
      readonly email?: string
      readonly firstName?: string | null
      readonly lastName?: string | null
      readonly profilePictureUrl?: string | null
    },
    signOut: vi.fn(),
    getSignInUrl: vi.fn()
  },
  convexAuth: {
    isLoading: false,
    isAuthenticated: false
  },
  convexQuery: vi.fn(),
  queryCalls: [] as Array<string>,
  ensureViewer: vi.fn(),
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  toggleMessageReaction: vi.fn(),
  createChannel: vi.fn(),
  editChannel: vi.fn(),
  deleteChannel: vi.fn(),
  addPrivateChannelMember: vi.fn(),
  removePrivateChannelMember: vi.fn(),
  ensureChannelMember: vi.fn(),
  markChannelRead: vi.fn(),
  generateAttachmentUploadUrl: vi.fn(),
  registerAttachmentUpload: vi.fn(),
  deleteAttachmentUpload: vi.fn(),
  startOrReopenDirectConversation: vi.fn(),
  sendFriendRequest: vi.fn(),
  updateDirectMessageProfile: vi.fn(),
  respondToFriendRequest: vi.fn(),
  updateNotificationPreference: vi.fn(),
  openNotificationFeed: vi.fn(),
  loadMore: vi.fn(),
  paginationStatus: undefined as "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted" | undefined,
  workspace: undefined as DogfoodWorkspaceView | null | undefined,
  channels: undefined as ReadonlyArray<DogfoodChannelView> | undefined,
  directConversations: [] as ReadonlyArray<DogfoodDirectConversationView> | undefined,
  messages: undefined as ReadonlyArray<DogfoodChannelMessageView> | undefined,
  messagesByChannel: undefined as Record<string, ReadonlyArray<DogfoodChannelMessageView>> | undefined,
  members: undefined as ReadonlyArray<DogfoodChannelMemberView> | undefined,
  membersByChannel: undefined as Record<string, ReadonlyArray<DogfoodChannelMemberView>> | undefined,
  inviteCandidates: undefined as ReadonlyArray<DogfoodPrivateChannelInviteCandidateView> | undefined,
  managementCandidates: undefined as ReadonlyArray<DogfoodPrivateChannelInviteCandidateView> | undefined,
  channelIndicators: undefined as ReadonlyArray<{ readonly channelId: string; readonly indicator: "unread" | "mentioned" }> | undefined,
  notificationPreference: undefined as { readonly mode: "all" | "mentions" | "off"; readonly options: ReadonlyArray<"all" | "mentions" | "off"> } | undefined,
  notificationFeedArgs: [] as Array<{ readonly cursor: number }>,
  workspaceChatProps: null as WorkspaceChatProps | null,
  notificationEvents: {
    cursor: 0,
    notifications: [] as ReadonlyArray<{
      readonly id: string
      readonly messageId: string
      readonly channelId: string
      readonly conversationKind: "channel" | "direct"
      readonly title: string
      readonly body: string
      readonly createdAt: number
    }>
  }
}))

vi.mock("@workos-inc/authkit-react", () => ({
  useAuth: () => mocks.auth
}))

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.convexQuery }),
  useConvexAuth: () => mocks.convexAuth,
  useAction: () => mocks.ensureViewer,
  useMutation: (reference: unknown) => {
    const mutations = {
      "chat:sendMessage": mocks.sendMessage,
      "chat:editMessage": mocks.editMessage,
      "chat:deleteMessage": mocks.deleteMessage,
      "chat:toggleMessageReaction": mocks.toggleMessageReaction,
      "chat:createChannel": mocks.createChannel,
      "chat:editChannel": mocks.editChannel,
      "chat:deleteChannel": mocks.deleteChannel,
      "chat:addPrivateChannelMember": mocks.addPrivateChannelMember,
      "chat:removePrivateChannelMember": mocks.removePrivateChannelMember,
      "chat:ensureChannelMember": mocks.ensureChannelMember,
      "chat:markChannelRead": mocks.markChannelRead,
      "chat:generateAttachmentUploadUrl": mocks.generateAttachmentUploadUrl,
      "chat:registerAttachmentUpload": mocks.registerAttachmentUpload,
      "chat:deleteAttachmentUpload": mocks.deleteAttachmentUpload,
      "direct_conversations:startOrReopen": mocks.startOrReopenDirectConversation,
      "social:sendFriendRequest": mocks.sendFriendRequest,
      "social:updateProfile": mocks.updateDirectMessageProfile,
      "social:respondToFriendRequest": mocks.respondToFriendRequest,
      "notification_preferences:updatePreference": mocks.updateNotificationPreference,
      "notification_preferences:openFeed": mocks.openNotificationFeed
    }
    return mutations[getFunctionName(reference as never) as keyof typeof mutations]
  },
  usePaginatedQuery: (_query: unknown, args: unknown) => {
    if (args === "skip") return { results: [], status: "LoadingFirstPage", loadMore: mocks.loadMore }
    const channelId = typeof args === "object" && args !== null && "channelId" in args ? String(args.channelId) : ""
    const messages = mocks.messagesByChannel?.[channelId] ?? mocks.messages
    return {
      results: messages === undefined ? [] : [...messages].reverse(),
      status: mocks.paginationStatus ?? (messages === undefined ? "LoadingFirstPage" : "Exhausted"),
      loadMore: mocks.loadMore
    }
  },
  useQuery: (query: unknown, args: unknown) => {
    const functionName = getFunctionName(query as never)
    mocks.queryCalls.push(functionName)
    if (args === "skip") return undefined
    if (functionName === "direct_conversations:list") return mocks.directConversations
    if (functionName === "social:profile") return undefined
    if (functionName === "social:incomingFriendRequests") return undefined
    if (functionName === "notification_preferences:preference") return mocks.notificationPreference
    if (functionName === "notification_preferences:feed") {
      mocks.notificationFeedArgs.push(args as { cursor: number })
      return mocks.notificationEvents
    }
    if (functionName === "chat:eligiblePrivateChannelMembers") {
      return typeof args === "object" && args !== null && "channelId" in args
        ? mocks.managementCandidates
        : mocks.inviteCandidates
    }
    if (typeof args === "object" && args !== null && "channelId" in args) {
      const channelId = String(args.channelId)
      if (functionName === "chat:channelMembers") {
        return mocks.membersByChannel?.[channelId] ?? mocks.members
      }
      return mocks.membersByChannel?.[channelId] ?? mocks.members
    }
    if (functionName === "chat:conversationIndicators") return mocks.channelIndicators
    if (typeof args === "object" && args !== null && "workspaceId" in args) return mocks.channels
    return mocks.workspace
  }
}))

vi.mock("./workspace-chat", () => ({
  WorkspaceChat: ((props: WorkspaceChatProps) => {
    mocks.workspaceChatProps = props
    return <section aria-label="mock workspace chat" />
  }) satisfies ComponentType<WorkspaceChatProps>
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, "aetherShell")
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true)
  mocks.auth.isLoading = false
  mocks.auth.user = null
  mocks.auth.getSignInUrl.mockResolvedValue("https://api.workos.com/user_management/authorize")
  mocks.convexAuth.isLoading = false
  mocks.convexAuth.isAuthenticated = false
  mocks.ensureViewer.mockResolvedValue({})
  mocks.convexQuery.mockResolvedValue([])
  mocks.sendMessage.mockResolvedValue({})
  mocks.editMessage.mockResolvedValue({})
  mocks.deleteMessage.mockResolvedValue({})
  mocks.toggleMessageReaction.mockResolvedValue({})
  mocks.createChannel.mockResolvedValue({
    id: "channel-2",
    key: "design",
    name: "design",
    visibility: "public",
    createdAt: 44
  })
  mocks.addPrivateChannelMember.mockResolvedValue({})
  mocks.removePrivateChannelMember.mockResolvedValue({})
  mocks.ensureChannelMember.mockResolvedValue({})
  mocks.markChannelRead.mockResolvedValue({})
  mocks.generateAttachmentUploadUrl.mockResolvedValue({
    uploadUrl: "https://upload.example/convex",
    intentId: "intent-1"
  })
  mocks.registerAttachmentUpload.mockResolvedValue({ status: "registered", storageId: "storage-1" })
  mocks.deleteAttachmentUpload.mockResolvedValue({})
  mocks.startOrReopenDirectConversation.mockResolvedValue({
    id: "direct-1",
    workspaceId: "workspace-1",
    otherUser: { id: "user-2", displayName: "Lee Chen" },
    createdAt: 44
  })
  mocks.queryCalls = []
  mocks.workspace = undefined
  mocks.channels = undefined
  mocks.directConversations = []
  mocks.messages = undefined
  mocks.messagesByChannel = undefined
  mocks.paginationStatus = undefined
  mocks.members = undefined
  mocks.membersByChannel = undefined
  mocks.inviteCandidates = undefined
  mocks.managementCandidates = undefined
  mocks.channelIndicators = undefined
  mocks.notificationPreference = undefined
  mocks.notificationFeedArgs = []
  mocks.workspaceChatProps = null
  mocks.notificationEvents = { cursor: 0, notifications: [] }
  mocks.updateNotificationPreference.mockResolvedValue({ mode: "mentions", options: ["all", "mentions", "off"] })
  mocks.openNotificationFeed.mockResolvedValue({ cursor: 0 })
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

const channels: ReadonlyArray<DogfoodChannelView> = [
  {
    id: "channel-1" as Id<"channels">,
    key: "general",
    name: "general",
    visibility: "private",
    createdAt: 1
  },
  {
    id: "channel-2" as Id<"channels">,
    key: "design",
    name: "design",
    visibility: "public",
    createdAt: 2
  }
]

const messages: ReadonlyArray<DogfoodChannelMessageView> = [
  {
    id: "message-1" as Id<"messages">,
    channelId: "channel-1" as Id<"channels">,
    authorUserId: "user-1" as Id<"users">,
    authorDisplayName: "Maya Patel",
    body: "Dogfood chat is live.",
    parentMessageId: null,
    parentMessage: null,
    createdAt: 42,
    editedAt: null,
    reactions: [],
    attachments: []
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
    parentMessageId: null,
    parentMessage: null,
    createdAt: 43,
    editedAt: null,
    reactions: [],
    attachments: []
  }
]

const designMessages: ReadonlyArray<DogfoodChannelMessageView> = [
  {
    id: "message-3" as Id<"messages">,
    channelId: "channel-2" as Id<"channels">,
    authorUserId: "user-1" as Id<"users">,
    authorDisplayName: "Maya Patel",
    body: "Design kickoff is scoped here.",
    parentMessageId: null,
    parentMessage: null,
    createdAt: 46,
    editedAt: null,
    reactions: [],
    attachments: []
  }
]

const members: ReadonlyArray<DogfoodChannelMemberView> = [
  {
    id: "user-2" as Id<"users">,
    displayName: "Lee Chen",
    joinedAt: 40,
    role: "member"
  },
  {
    id: "user-1" as Id<"users">,
    displayName: "Maya Patel",
    joinedAt: 39,
    role: "admin"
  }
]

const inviteCandidates: ReadonlyArray<DogfoodPrivateChannelInviteCandidateView> = [{
  id: "user-2" as Id<"users">,
  displayName: "Lee Chen"
}]

const adapterData = (
  overrides: Partial<DogfoodChatAdapterInput["data"]> = {}
): DogfoodChatAdapterInput["data"] => ({
  workspace,
  channels,
  selectedConversation: { kind: "channel", id: workspace.channel.id },
  messages,
  ...overrides
})

type AuthenticatedDogfoodOverrides = Partial<Pick<typeof mocks,
  | "workspace"
  | "channels"
  | "directConversations"
  | "messages"
  | "messagesByChannel"
  | "members"
  | "membersByChannel"
  | "inviteCandidates"
  | "managementCandidates"
  | "channelIndicators"
  | "notificationPreference"
  | "paginationStatus"
>>

const renderAuthenticatedDogfood = (overrides: AuthenticatedDogfoodOverrides = {}) => {
  mocks.auth.user = {
    id: "auth-user-1",
    email: "maya@example.com",
    firstName: "Maya",
    lastName: "Patel"
  }
  mocks.convexAuth.isAuthenticated = true
  Object.assign(mocks, {
    workspace,
    channels,
    messages: [],
    members: [],
    ...overrides
  })
  return render(<ConvexDogfoodApp />)
}

const capturedWorkspaceChatProps = (): WorkspaceChatProps => {
  if (mocks.workspaceChatProps === null) throw new Error("WorkspaceChat has not rendered")
  return mocks.workspaceChatProps
}

describe("dogfoodChatToChatData", () => {
  it("adapts a direct conversation into the shared timeline without channel-only controls", async () => {
    const directConversation = {
      id: "direct-1" as Id<"channels">,
      otherUser: { id: "user-2" as Id<"users">, displayName: "Lee Chen" },
      createdAt: 44
    }
    const selections: Array<Id<"channels">> = []
    const chatData = dogfoodChatToChatData({
      data: adapterData({
        directConversations: [directConversation],
        selectedConversation: { kind: "direct", id: directConversation.id },
        messages: []
      }),
      commands: {
        selectDirectConversation: (id) => selections.push(id),
        editChannel: mocks.editChannel,
        deleteChannel: mocks.deleteChannel,
        addChannelMember: mocks.addPrivateChannelMember,
        removeChannelMember: mocks.removePrivateChannelMember,
        sendMessage: mocks.sendMessage,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage
      }
    })

    expect(chatData.model.activeConversation).toEqual({
      kind: "direct",
      directConversation: { id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }
    })
    expect(chatData.model.channels).toHaveLength(2)
    expect(chatData.model.directConversations).toHaveLength(1)
    expect(chatData.editChannel).toBeUndefined()
    expect(chatData.deleteChannel).toBeUndefined()
    expect(chatData.addChannelMember).toBeUndefined()
    expect(chatData.removeChannelMember).toBeUndefined()
    chatData.selectDirectConversation?.("direct-1")
    await chatData.createChannelMessage({ channelId: "direct-1", body: "Private hello" })
    expect(selections).toEqual([directConversation.id])
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      channelId: directConversation.id,
      body: "Private hello",
      parentMessageId: undefined
    })
  })

  it("adapts the Convex dogfood chat view into the chat data interface", async () => {
    const chatData = dogfoodChatToChatData({
      data: adapterData({
        members,
        channelMemberInviteCandidates: inviteCandidates,
        createChannelInviteCandidates: inviteCandidates
      }),
      commands: {
        startDirectConversation: mocks.startOrReopenDirectConversation,
        addChannelMember: mocks.addPrivateChannelMember,
        removeChannelMember: mocks.removePrivateChannelMember,
        sendMessage: mocks.sendMessage,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage,
        toggleMessageReaction: mocks.toggleMessageReaction
      }
    })

    expect(chatData.model.currentUser.displayName).toBe("Maya Patel")
    expect(chatData.model.currentUser).toEqual({ id: "user-1", displayName: "Maya Patel" })
    expect(chatData.model.workspace).toEqual({ name: "Aether Dogfood" })
    expect(chatData.model.channel).toEqual({ id: "channel-1", name: "general", visibility: "private" })
    expect(chatData.model.channels.map((channel) => channel.name)).toEqual(["general", "design"])
    expect(chatData.model.channelMembers?.map((member) => member.displayName)).toEqual(["Lee Chen", "Maya Patel"])
    expect(chatData.model.channelMembers?.map((member) => member.role)).toEqual(["member", "admin"])
    expect(chatData.model.channelMemberInviteCandidates).toEqual([{ id: "user-2", displayName: "Lee Chen" }])
    expect(chatData.model.createChannelInviteCandidates).toEqual([{ id: "user-2", displayName: "Lee Chen" }])
    await expect(chatData.startDirectConversation?.("user-2")).resolves.toEqual({
      id: "direct-1",
      otherUser: { id: "user-2", displayName: "Lee Chen" }
    })
    void chatData.addChannelMember?.({ channelId: "channel-1", userId: "user-2" })
    void chatData.removeChannelMember?.({ channelId: "channel-1", userId: "user-2" })
    expect(mocks.startOrReopenDirectConversation).toHaveBeenCalledWith("user-2")
    expect(mocks.addPrivateChannelMember).toHaveBeenCalledWith({ channelId: "channel-1", userId: "user-2" })
    expect(mocks.removePrivateChannelMember).toHaveBeenCalledWith({ channelId: "channel-1", userId: "user-2" })
    expect(chatData.model.channelMessages).toHaveLength(1)
    expect(chatData.model.channelMessages[0]).toMatchObject({
      authorType: "human",
      authorDisplayName: "Maya Patel",
      body: "Dogfood chat is live.",
      editedAt: null,
      deletedAt: null,
      parentMessageId: null,
      parentMessage: null
    })
  })

  it("falls back to the default Convex channel when selection is stale", () => {
    const chatData = dogfoodChatToChatData({
      data: adapterData({
        selectedConversation: { kind: "channel", id: "removed-channel" as Id<"channels"> },
      }),
      commands: {
        sendMessage: mocks.sendMessage,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage
      }
    })

    expect(chatData.model.channel).toEqual({ id: "channel-1", name: "general", visibility: "private" })
  })

  it("adapts reply parent ids and previews", async () => {
    const chatData = dogfoodChatToChatData({
      data: adapterData({
        messages: [{
          ...messages[0]!,
          id: "message-2" as Id<"messages">,
          authorUserId: "user-2" as Id<"users">,
          authorDisplayName: "Lee Chen",
          body: "Reply body.",
          parentMessageId: messages[0]!.id,
          parentMessage: {
            id: messages[0]!.id,
            authorDisplayName: "Maya Patel",
            bodyPreview: "Dogfood chat is live.",
            deleted: false
          },
          createdAt: 43
        }]
      }),
      commands: {
        sendMessage: mocks.sendMessage,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage
      }
    })

    expect(chatData.model.channelMessages[0]).toMatchObject({
      parentMessageId: String(messages[0]!.id),
      parentMessage: {
        id: String(messages[0]!.id),
        authorDisplayName: "Maya Patel",
        bodyPreview: "Dogfood chat is live.",
        deleted: false
      }
    })

    await chatData.createChannelMessage({
      channelId: chatData.model.channel.id,
      body: "Reply through adapter.",
      parentMessageId: chatData.model.channelMessages[0]!.parentMessageId
    })

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      channelId: workspace.channel.id,
      body: "Reply through adapter.",
      parentMessageId: messages[0]!.id
    })
  })

  it("adapts attachment metadata and forwards storage ids when sending", async () => {
    const chatData = dogfoodChatToChatData({
      data: adapterData({
        messages: [{
          ...messages[0]!,
          attachments: [{
            storageId: "storage-1" as Id<"_storage">,
            name: "brief.png",
            contentType: "image/png",
            size: 4096,
            kind: "image",
            url: "https://files.example/brief.png"
          }]
        }]
      }),
      commands: {
        sendMessage: mocks.sendMessage,
        discardMessageAttachment: mocks.deleteAttachmentUpload,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage
      }
    })

    expect(chatData.model.channelMessages[0]?.attachments).toEqual([
      {
        id: "storage-1",
        storageId: "storage-1",
        name: "brief.png",
        contentType: "image/png",
        size: 4096,
        kind: "image",
        url: "https://files.example/brief.png"
      }
    ])

    await chatData.createChannelMessage({
      channelId: chatData.model.channel.id,
      body: "Attachment included.",
      attachments: chatData.model.channelMessages[0]?.attachments
    })

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      channelId: workspace.channel.id,
      body: "Attachment included.",
      parentMessageId: undefined,
      attachments: [{ storageId: "storage-1", name: "brief.png" }]
    })

    await chatData.discardMessageAttachment?.(chatData.model.channelMessages[0]!.attachments[0]!)
    expect(mocks.deleteAttachmentUpload).toHaveBeenCalledWith({ storageId: "storage-1" })
  })

  it("preserves Convex editedAt in the chat data model", () => {
    const chatData = dogfoodChatToChatData({
      data: adapterData({
        messages: [{ ...messages[0]!, editedAt: 45 }]
      }),
      commands: {
        sendMessage: mocks.sendMessage,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage,
        toggleMessageReaction: mocks.toggleMessageReaction
      }
    })

    expect(chatData.model.channelMessages[0]?.editedAt).toBe(45)
  })

  it("adapts Convex reaction counts and current-user state", async () => {
    const chatData = dogfoodChatToChatData({
      data: adapterData({
        messages: [{
          ...messages[0]!,
          reactions: [{ emoji: "👍", count: 2, reactedByCurrentUser: true }]
        }]
      }),
      commands: {
        sendMessage: mocks.sendMessage,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage,
        toggleMessageReaction: mocks.toggleMessageReaction
      }
    })

    expect(chatData.model.channelMessages[0]?.reactions).toEqual([
      { emoji: "👍", count: 2, reactedByCurrentUser: true }
    ])

    await chatData.toggleMessageReaction?.({
      channelId: chatData.model.channel.id,
      messageId: chatData.model.channelMessages[0]!.id,
      emoji: "👍"
    })

    expect(mocks.toggleMessageReaction).toHaveBeenCalledWith({
      channelId: workspace.channel.id,
      messageId: messages[0]!.id,
      emoji: "👍"
    })
  })

  it("marks selected channel messages as loading without requiring message rows", () => {
    const chatData = dogfoodChatToChatData({
      data: adapterData({ selectedConversation: { kind: "channel", id: channels[1]!.id }, messages: [], members: [] }),
      state: { messagesLoading: true, membersLoading: true },
      commands: {
        sendMessage: mocks.sendMessage,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage,
        toggleMessageReaction: mocks.toggleMessageReaction
      }
    })

    expect(chatData.model.channel.name).toBe("design")
    expect(chatData.model.channelMessages).toEqual([])
    expect(chatData.model.channelMessagesLoading).toBe(true)
    expect(chatData.model.channelMembers).toEqual([])
    expect(chatData.model.channelMembersLoading).toBe(true)
  })

  it("adapts per-channel unread and mention indicators", () => {
    const chatData = dogfoodChatToChatData({
      data: adapterData({
        channelIndicators: [{ channelId: channels[1]!.id, indicator: "mentioned" }]
      }),
      commands: {
        sendMessage: mocks.sendMessage,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage
      }
    })

    expect(chatData.model.channelIndicators).toEqual([{ channelId: channels[1]!.id, indicator: "mentioned" }])
  })

  it("adapts and updates the active conversation notification preference", async () => {
    const updateNotificationPreference = vi.fn().mockResolvedValue({
      mode: "all" as const,
      options: ["all", "mentions", "off"] as const
    })
    const chatData = dogfoodChatToChatData({
      data: adapterData({
        notificationPreference: { mode: "mentions", options: ["all", "mentions", "off"] }
      }),
      commands: {
        sendMessage: mocks.sendMessage,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage,
        updateNotificationPreference
      }
    })

    expect(chatData.model.notificationPreference).toEqual({
      mode: "mentions",
      options: ["all", "mentions", "off"]
    })
    await chatData.updateNotificationPreference?.({ channelId: workspace.channel.id, mode: "all" })
    expect(updateNotificationPreference).toHaveBeenCalledWith({
      channelId: workspace.channel.id,
      mode: "all"
    })
  })

  it("uses Convex ids for chat commands without exposing snapshot-era fields", async () => {
    const chatData = dogfoodChatToChatData({
      data: adapterData(),
      commands: {
        sendMessage: mocks.sendMessage,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage
      }
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

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      channelId: workspace.channel.id,
      body: "Ship chat first.",
      parentMessageId: undefined
    })
    expect(mocks.editMessage).toHaveBeenCalledWith({
      channelId: workspace.channel.id,
      messageId: messages[0]!.id,
      body: "Edited dogfood"
    })
    expect(mocks.deleteMessage).toHaveBeenCalledWith({ channelId: workspace.channel.id, messageId: messages[0]!.id })
    expect("workspaceAgents" in chatData.model).toBe(false)
    expect("agentRuns" in chatData.model).toBe(false)
  })

  it("authorizes edit and delete commands only for the current user", () => {
    const chatData = dogfoodChatToChatData({
      data: adapterData({
        messages: messagesWithAnotherAuthor
      }),
      commands: {
        sendMessage: mocks.sendMessage,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage
      }
    })

    expect(chatData.canEditMessage?.(chatData.model.channelMessages[0]!)).toBe(true)
    expect(chatData.canDeleteMessage?.(chatData.model.channelMessages[0]!)).toBe(true)
    expect(chatData.canEditMessage?.(chatData.model.channelMessages[1]!)).toBe(false)
    expect(chatData.canDeleteMessage?.(chatData.model.channelMessages[1]!)).toBe(false)
  })

  it("uses the selected Convex channel and exposes create/select channel commands", async () => {
    const selections: Array<Id<"channels">> = []
    const chatData = dogfoodChatToChatData({
      data: adapterData({ selectedConversation: { kind: "channel", id: channels[1]!.id }, messages: designMessages }),
      commands: {
        createChannel: mocks.createChannel,
        selectChannel: (channelId) => selections.push(channelId),
        sendMessage: mocks.sendMessage,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage
      }
    })

    expect(chatData.model.channel.name).toBe("design")
    chatData.selectChannel?.(chatData.model.channels[0]!.id)
    await chatData.createChannel?.({
      name: "product",
      visibility: "private",
      initialMemberIds: ["user-2"]
    })

    expect(selections).toEqual([channels[0]!.id])
    expect(mocks.createChannel).toHaveBeenCalledWith({
      name: "product",
      visibility: "private",
      initialMemberIds: ["user-2"]
    })
  })
})

describe("ConvexDogfoodApp", () => {
  it("shows the sign-in entry state when signed out", async () => {

    render(<ConvexDogfoodApp />)

    expect(screen.getByRole("heading", { name: "Welcome to Aether" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy()
  })

  it("opens notifications from a server cursor and advances after consuming a page", async () => {
    const showDesktopNotification = vi.fn().mockResolvedValue("shown")
    Object.defineProperty(window, "aetherShell", {
      configurable: true,
      value: {
        accountContext: vi.fn().mockResolvedValue(null),
        updateDesktopNotificationContext: vi.fn().mockResolvedValue(undefined),
        showDesktopNotification
      }
    })
    mocks.openNotificationFeed.mockResolvedValue({ cursor: 41 })
    mocks.notificationEvents = {
      cursor: 42,
      notifications: [{
        id: "event-42",
        messageId: "message-42",
        channelId: "channel-1",
        conversationKind: "channel",
        title: "#general",
        body: "Lee Chen: Cursor-backed notification",
        createdAt: 1
      }]
    }
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = messages

    render(<ConvexDogfoodApp />)

    await waitFor(() => expect(mocks.openNotificationFeed).toHaveBeenCalledWith({}))
    await waitFor(() => expect(mocks.notificationFeedArgs).toContainEqual({ cursor: 41 }))
    await waitFor(() => expect(showDesktopNotification).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.notificationFeedArgs).toContainEqual({ cursor: 42 }))
  })

  it("binds system-browser sign-in to the initiating account window", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const openNativeAuth = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, "aetherShell", {
      configurable: true,
      value: {
        openExternal,
        openNativeAuth,
        accountContext: vi.fn().mockResolvedValue({
          windowId: "window-2",
          currentAccountId: "account-2",
          accounts: [{
            id: "account-2",
            displayName: "Sign in",
            email: null,
            avatarUrl: null,
            current: true,
            pending: true
          }]
        })
      }
    })

    render(<ConvexDogfoodApp />)
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }))

    await waitFor(() => expect(mocks.auth.getSignInUrl).toHaveBeenCalledWith({
      state: {
        aetherWindowId: "window-2",
        aetherAccountId: "account-2"
      }
    }))
    expect(openExternal).not.toHaveBeenCalled()
    expect(openNativeAuth).toHaveBeenCalledWith("https://api.workos.com/user_management/authorize")
  })

  it("shows access setup errors from ensureViewer", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.ensureViewer.mockRejectedValue(new Error("This email is not on the Aether dogfood allowlist"))

    render(<ConvexDogfoodApp />)

    expect(await screen.findByRole("heading", { name: "Could Not Join" })).toBeTruthy()
    expect(screen.getByText("This email is not on the Aether dogfood allowlist")).toBeTruthy()
    expect(screen.getByText(/^VIEWER-/)).toBeTruthy()
    expect(screen.getByText("Use Try again after checking the connection or allowlist.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
    expect(warnSpy).toHaveBeenCalledWith("Dogfood chat diagnostic", expect.objectContaining({
      message: "Error: details redacted"
    }))
  })

  it("can retry viewer setup after an access setup error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.ensureViewer.mockRejectedValueOnce(new Error("WorkOS user profile is missing an email address"))

    render(<ConvexDogfoodApp />)

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }))

    await waitFor(() => expect(mocks.ensureViewer).toHaveBeenCalledTimes(2))
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it("wires the profile sign-out action through the reused chat surface", async () => {
    renderAuthenticatedDogfood({ messages })
    const props = await waitFor(capturedWorkspaceChatProps)
    await act(async () => props.profileMenuActions?.find(({ label }) => label === "Sign out")?.onSelect())

    expect(mocks.auth.signOut).toHaveBeenCalledWith({
      returnTo: "http://localhost:3000/"
    })
  })

  it("exposes saved accounts and account lifecycle actions in the profile menu", async () => {
    const switchAccount = vi.fn().mockResolvedValue(undefined)
    const addAccount = vi.fn().mockResolvedValue(undefined)
    const removeCurrentAccount = vi.fn().mockResolvedValue(undefined)
    const signOutAllAccounts = vi.fn().mockResolvedValue(undefined)
    const accountContext = {
      windowId: "window-1",
      currentAccountId: "default",
      accounts: [
        { id: "default", displayName: "Maya Patel", email: "maya@example.com", avatarUrl: null, current: true, pending: false },
        { id: "account-2", displayName: "Archer", email: "archer@example.com", avatarUrl: null, current: false, pending: false }
      ]
    }
    Object.defineProperty(window, "aetherShell", {
      configurable: true,
      value: {
        accountContext: vi.fn().mockResolvedValue(accountContext),
        updateAccountProfile: vi.fn().mockResolvedValue(accountContext),
        switchAccount,
        addAccount,
        removeCurrentAccount,
        signOutAllAccounts
      }
    })
    renderAuthenticatedDogfood({ messages })
    const props = await waitFor(capturedWorkspaceChatProps)
    props.profileMenuActions?.find(({ label }) => label === "Archer")?.onSelect()
    expect(switchAccount).toHaveBeenCalledWith("account-2")
    expect(props.profileMenuActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Archer", detail: "archer@example.com" })
    ]))

    props.profileMenuActions?.find(({ label }) => label === "Add account")?.onSelect()
    expect(addAccount).toHaveBeenCalledTimes(1)

    props.profileMenuActions?.find(({ label }) => label === "Sign out all accounts")?.onSelect()
    await waitFor(() => expect(signOutAllAccounts).toHaveBeenCalledTimes(1))
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ navigate: false })
  })

  it("updates an already-open window when another window changes the shared account list", async () => {
    const initialContext = {
      windowId: "window-1",
      currentAccountId: "default",
      accounts: [
        { id: "default", displayName: "Maya Patel", email: "maya@example.com", avatarUrl: null, current: true, pending: false }
      ]
    }
    let accountContextListener!: (context: typeof initialContext) => void
    const unsubscribe = vi.fn()
    Object.defineProperty(window, "aetherShell", {
      configurable: true,
      value: {
        accountContext: vi.fn().mockResolvedValue(initialContext),
        onAccountContextChanged: vi.fn((listener: (context: typeof initialContext) => void) => {
          accountContextListener = listener
          return unsubscribe
        }),
        updateAccountProfile: vi.fn().mockResolvedValue(initialContext),
        switchAccount: vi.fn().mockResolvedValue(undefined),
        addAccount: vi.fn().mockResolvedValue(undefined),
        removeCurrentAccount: vi.fn().mockResolvedValue(undefined),
        signOutAllAccounts: vi.fn().mockResolvedValue(undefined)
      }
    })
    const { unmount } = renderAuthenticatedDogfood({ messages })
    await waitFor(() => expect(capturedWorkspaceChatProps().profileMenuActions)
      .toEqual(expect.arrayContaining([expect.objectContaining({ label: "Maya Patel" })])))

    await act(async () => accountContextListener({
      ...initialContext,
      accounts: [
        ...initialContext.accounts,
        { id: "account-2", displayName: "Priya Rao", email: "priya@example.com", avatarUrl: null, current: false, pending: false }
      ]
    }))

    await waitFor(() => expect(capturedWorkspaceChatProps().profileMenuActions)
      .toEqual(expect.arrayContaining([expect.objectContaining({ label: "Priya Rao" })])))
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("sends messages through the Convex mutation using the active channel", async () => {
    renderAuthenticatedDogfood({ messages })
    const props = await waitFor(capturedWorkspaceChatProps)
    await act(async () => props.createChannelMessage({
      channelId: String(workspace.channel.id),
      body: "Hello from dogfood"
    }))

    await waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith({
        channelId: workspace.channel.id,
        body: "Hello from dogfood"
      })
    )
  })

  it("passes membership-backed channel members to the reused chat surface", async () => {
    renderAuthenticatedDogfood({ messages, members })
    await waitFor(() => expect(capturedWorkspaceChatProps().model.channelMembers)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ displayName: "Lee Chen" }),
        expect.objectContaining({ displayName: "Maya Patel" })
      ])))
  })

  it("wires private membership commands and moves a self-removed viewer to the default channel", async () => {
    const safeChannel: DogfoodChannelView = {
      id: "channel-safe" as Id<"channels">,
      key: "general",
      name: "general",
      visibility: "public",
      createdAt: 2
    }
    const safeWorkspace: DogfoodWorkspaceView = {
      ...workspace,
      channel: safeChannel
    }
    const privateChannel: DogfoodChannelView = {
      id: "channel-private" as Id<"channels">,
      key: "leadership",
      name: "leadership",
      visibility: "private",
      createdAt: 3
    }
    renderAuthenticatedDogfood({
      workspace: safeWorkspace,
      channels: [safeChannel, privateChannel],
      messagesByChannel: { "channel-safe": [], "channel-private": [] },
      membersByChannel: { "channel-safe": members, "channel-private": members },
      managementCandidates: inviteCandidates
    })

    const initialProps = await waitFor(capturedWorkspaceChatProps)
    await act(async () => initialProps.selectChannel?.(String(privateChannel.id)))
    await waitFor(() => expect(capturedWorkspaceChatProps().model.channel.id).toBe("channel-private"))
    await act(async () => capturedWorkspaceChatProps().addChannelMember?.({
      channelId: String(privateChannel.id),
      userId: String(inviteCandidates[0]!.id)
    }))
    await waitFor(() => expect(mocks.addPrivateChannelMember).toHaveBeenCalledWith({
      channelId: privateChannel.id,
      userId: inviteCandidates[0]!.id
    }))

    await act(async () => capturedWorkspaceChatProps().removeChannelMember?.({
      channelId: String(privateChannel.id),
      userId: String(workspace.currentUser.id)
    }))
    await waitFor(() => expect(mocks.removePrivateChannelMember).toHaveBeenCalledWith({
      channelId: privateChannel.id,
      userId: workspace.currentUser.id
    }))
    await waitFor(() => expect(capturedWorkspaceChatProps().model.channel.id).toBe("channel-safe"))
  })

  it("keeps the workspace shell mounted while selected channel messages and members load", async () => {
    renderAuthenticatedDogfood({ messages: undefined, members: undefined })
    const props = await waitFor(capturedWorkspaceChatProps)
    expect(props.model.workspace.name).toBe("Aether Dogfood")
    expect(props.model.channelMessagesLoading).toBe(true)
    expect(props.model.channelMembersLoading).toBe(true)
    expect(screen.queryByRole("heading", { name: "Loading Chat" })).toBeNull()
  })

  it("opens a direct conversation without public-channel auto-join", async () => {
    const directConversation: DogfoodDirectConversationView = {
      id: "direct-1" as Id<"channels">,
      otherUser: { id: "user-2" as Id<"users">, displayName: "Lee Chen" },
      createdAt: 44
    }
    const { rerender } = renderAuthenticatedDogfood({
      directConversations: [directConversation],
      messagesByChannel: { "channel-1": messages, "direct-1": [] }
    })
    await waitFor(() => expect(capturedWorkspaceChatProps().model.directConversations).toHaveLength(1))
    mocks.directConversations = undefined
    rerender(<ConvexDogfoodApp />)
    expect(capturedWorkspaceChatProps().model.directConversations).toHaveLength(1)
    mocks.ensureChannelMember.mockClear()
    await act(async () => capturedWorkspaceChatProps().selectDirectConversation?.("direct-1"))

    await waitFor(() => expect(capturedWorkspaceChatProps().model.activeConversation)
      .toMatchObject({ kind: "direct", directConversation: { id: "direct-1" } }))
    expect(mocks.ensureChannelMember).not.toHaveBeenCalled()
  })

  it("uses server-side user search without subscribing to the legacy candidate scan", async () => {
    mocks.convexQuery.mockResolvedValue([{ id: "user-2", displayName: "Lee Chen", username: "lee", canStartDirectMessage: true }])

    renderAuthenticatedDogfood({ directConversations: [], messagesByChannel: { "channel-1": messages } })
    const props = await waitFor(capturedWorkspaceChatProps)
    await props.searchDirectConversationCandidates?.("lee")

    await waitFor(() => expect(mocks.convexQuery).toHaveBeenCalledTimes(1))
    const [query, args] = mocks.convexQuery.mock.calls[0]!
    expect(getFunctionName(query as never)).toBe("social:searchUsers")
    expect(args).toEqual({ query: "lee" })
  })

  it("exposes incremental history loading from the Convex pagination state", async () => {
    renderAuthenticatedDogfood({ messages, paginationStatus: "CanLoadMore" })
    const props = await waitFor(capturedWorkspaceChatProps)
    props.loadOlderChannelMessages?.()
    expect(mocks.loadMore).toHaveBeenCalledWith(50)
  })

  it("switches channels and scopes messages and sends to the active channel", async () => {
    renderAuthenticatedDogfood({ messagesByChannel: {
      "channel-1": messages,
      "channel-2": designMessages
    } })

    const initialProps = await waitFor(capturedWorkspaceChatProps)
    await act(async () => initialProps.selectChannel?.(String(channels[1]!.id)))
    await waitFor(() => expect(mocks.ensureChannelMember).toHaveBeenCalledWith({ channelId: channels[1]!.id }))
    await waitFor(() => expect(capturedWorkspaceChatProps().model.channelMessages[0]?.body)
      .toBe("Design kickoff is scoped here."))
    await act(async () => capturedWorkspaceChatProps().createChannelMessage({
      channelId: String(channels[1]!.id),
      body: "Hello from dogfood"
    }))

    await waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith({
        channelId: channels[1]!.id,
        body: "Hello from dogfood"
      })
    )
  })

  it("marks the active channel read after its messages load", async () => {
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = messages

    render(<ConvexDogfoodApp />)

    await waitFor(() =>
      expect(mocks.markChannelRead).toHaveBeenCalledWith({
        channelId: workspace.channel.id,
        readThroughMessageId: messages[0]!.id
      })
    )
  })

  it("does not mark a background conversation read until the window becomes active", async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false)
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = messages

    render(<ConvexDogfoodApp />)
    await screen.findByLabelText("mock workspace chat")
    expect(mocks.markChannelRead).not.toHaveBeenCalled()

    vi.mocked(document.hasFocus).mockReturnValue(true)
    act(() => window.dispatchEvent(new Event("focus")))
    await waitFor(() => expect(mocks.markChannelRead).toHaveBeenCalledWith({
      channelId: workspace.channel.id,
      readThroughMessageId: messages[0]!.id
    }))
  })

  it("marks the active channel read through the newest loaded message without repeating the same marker", async () => {
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = messagesWithAnotherAuthor

    const { rerender } = render(<ConvexDogfoodApp />)

    await waitFor(() =>
      expect(mocks.markChannelRead).toHaveBeenCalledWith({
        channelId: workspace.channel.id,
        readThroughMessageId: messagesWithAnotherAuthor[1]!.id
      })
    )
    expect(mocks.markChannelRead).toHaveBeenCalledTimes(1)

    rerender(<ConvexDogfoodApp />)

    await waitFor(() => expect(mocks.markChannelRead).toHaveBeenCalledTimes(1))
  })

  it("passes per-channel indicators through to the reused chat surface", async () => {
    renderAuthenticatedDogfood({
      messages,
      channelIndicators: [{ channelId: channels[1]!.id, indicator: "unread" }]
    })
    await waitFor(() => expect(capturedWorkspaceChatProps().model.channelIndicators)
      .toEqual([{ channelId: String(channels[1]!.id), indicator: "unread" }]))
  })

  it("creates channels through the Convex mutation", async () => {
    renderAuthenticatedDogfood({ messages })
    const props = await waitFor(capturedWorkspaceChatProps)
    await act(async () => props.createChannel?.({ name: "design" }))

    await waitFor(() => expect(mocks.createChannel).toHaveBeenCalledWith({ name: "design" }))
  })

  it("loads eligible invitees and sends private creation through the typed adapter", async () => {
    renderAuthenticatedDogfood({ messages, inviteCandidates })
    const props = await waitFor(capturedWorkspaceChatProps)
    await act(async () => props.createChannel?.({
      name: "leadership",
      visibility: "private",
      initialMemberIds: [String(inviteCandidates[0]!.id)]
    }))

    await waitFor(() => expect(mocks.createChannel).toHaveBeenCalledWith({
      name: "leadership",
      visibility: "private",
      initialMemberIds: [inviteCandidates[0]!.id]
    }))
  })

  it("joins a selected shared channel before loading its messages", async () => {
    let finishJoin!: () => void
    mocks.ensureChannelMember.mockReturnValue(new Promise<void>((resolve) => { finishJoin = resolve }))
    renderAuthenticatedDogfood({ messagesByChannel: {
      "channel-1": messages,
      "channel-2": designMessages
    } })

    const initialProps = await waitFor(capturedWorkspaceChatProps)
    await act(async () => initialProps.selectChannel?.(String(channels[1]!.id)))
    await waitFor(() => expect(capturedWorkspaceChatProps().model.channelMessagesLoading).toBe(true))
    await waitFor(() => expect(mocks.ensureChannelMember).toHaveBeenCalledWith({ channelId: channels[1]!.id }))
    await act(async () => finishJoin())
    await waitFor(() => expect(capturedWorkspaceChatProps().model.channelMessages[0]?.body)
      .toBe("Design kickoff is scoped here."))
  })

  it("wires edit and hard delete mutations for the current author only", async () => {
    renderAuthenticatedDogfood({ messages: messagesWithAnotherAuthor })
    await waitFor(() => expect(capturedWorkspaceChatProps().model.channelMessages).toHaveLength(2))
    const props = capturedWorkspaceChatProps()
    expect(props.canEditMessage?.(props.model.channelMessages[0]!)).toBe(true)
    expect(props.canDeleteMessage?.(props.model.channelMessages[0]!)).toBe(true)
    expect(props.canEditMessage?.(props.model.channelMessages[1]!)).toBe(false)
    expect(props.canDeleteMessage?.(props.model.channelMessages[1]!)).toBe(false)

    await act(async () => props.editChannelMessage?.({
      channelId: String(workspace.channel.id),
      messageId: String(messages[0]!.id),
      body: "Edited dogfood"
    }))
    await act(async () => props.deleteChannelMessage({
      channelId: String(workspace.channel.id),
      messageId: String(messages[0]!.id)
    }))

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

  it("wires reaction toggles through the Convex mutation", async () => {
    renderAuthenticatedDogfood({ messages })
    const props = await waitFor(capturedWorkspaceChatProps)
    await act(async () => props.toggleMessageReaction?.({
      channelId: String(workspace.channel.id),
      messageId: String(messages[0]!.id),
      emoji: "👍"
    }))

    await waitFor(() =>
      expect(mocks.toggleMessageReaction).toHaveBeenCalledWith({
        channelId: workspace.channel.id,
        messageId: messages[0]!.id,
        emoji: "👍"
      })
    )
  })

  it("retries attachment registration after the upload succeeds", async () => {
    mocks.registerAttachmentUpload
      .mockRejectedValueOnce(new Error("temporary registration failure"))
      .mockRejectedValueOnce(new Error("temporary registration failure"))
      .mockResolvedValueOnce({ status: "registered", storageId: "storage-1" })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ storageId: "storage-1" })
    }))

    renderAuthenticatedDogfood({ messages })
    const props = await waitFor(capturedWorkspaceChatProps)
    await props.uploadMessageAttachment?.(
      new File(["file"], "brief.txt", { type: "text/plain" })
    ).catch(() => {})

    await waitFor(() => expect(mocks.registerAttachmentUpload).toHaveBeenCalledTimes(3))
    expect(mocks.deleteAttachmentUpload).not.toHaveBeenCalled()
  })

  it("cleans up a direct upload after terminal registration failure", async () => {
    mocks.registerAttachmentUpload.mockRejectedValue(new Error("registration unavailable"))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ storageId: "storage-1" })
    }))

    renderAuthenticatedDogfood({ messages })
    const props = await waitFor(capturedWorkspaceChatProps)
    await props.uploadMessageAttachment?.(
      new File(["file"], "brief.txt", { type: "text/plain" })
    ).catch(() => {})

    await waitFor(() => expect(mocks.deleteAttachmentUpload).toHaveBeenCalledWith({
      intentId: "intent-1",
      storageId: "storage-1"
    }))
    expect(mocks.registerAttachmentUpload).toHaveBeenCalledTimes(3)
  })

  it("passes compact dogfood mutation errors into the reused chat surface", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    renderAuthenticatedDogfood({ messages })
    const props = await waitFor(capturedWorkspaceChatProps)
    const message = props.operationErrorMessage?.(
      "send",
      new Error("secret mutation details")
    )
    expect(message).toMatch(/^Could not send message\. Check your connection and try again\. Diagnostic: MUTATION-/)
    const logs = JSON.stringify(warnSpy.mock.calls)
    expect(logs).toContain("details redacted")
    expect(logs).not.toContain("secret mutation details")
    expect(logs).not.toContain("friend@example.com")
    expect(logs).not.toContain("https://private.example")
    expect(logs).not.toContain("Bearer token")
    expect(logs).not.toContain("api_key")
  })

  it("sanitizes render-boundary failures and offers a recovery action", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const BrokenChat = () => {
      throw new Error("secret render text https://private.example friend@example.com Bearer token api_key=oops")
    }

    render(<DogfoodErrorBoundary><BrokenChat /></DogfoodErrorBoundary>)

    expect(screen.getByRole("heading", { name: "Chat Failed" })).toBeTruthy()
    expect(screen.getByText("Something unexpected interrupted chat.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reload chat" })).toBeTruthy()
    expect(screen.queryByText(/secret render text/)).toBeNull()
    const logs = JSON.stringify(errorSpy.mock.calls)
    expect(logs).toContain("details redacted")
    expect(logs).not.toContain("secret render text")
    expect(logs).not.toContain("private.example")
    expect(logs).not.toContain("friend@example.com")
    expect(logs).not.toContain("Bearer token")
    expect(logs).not.toContain("api_key")
  })

  it("waits for Convex to authenticate before initializing the viewer", async () => {
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isLoading = true
    mocks.convexAuth.isAuthenticated = false

    render(<ConvexDogfoodApp />)

    expect(screen.getByRole("heading", { name: "Checking Session" })).toBeTruthy()
    expect(screen.getByText("Waiting for your AuthKit session to reach Convex...")).toBeTruthy()
    expect(mocks.ensureViewer).not.toHaveBeenCalled()
  })
})
