// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { getFunctionName } from "convex/server"
import type { ComponentType } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Id } from "../../convex/_generated/dataModel"
import type { ChatMessage } from "./chat-data"
import {
  dogfoodChatToChatData,
  type DogfoodChannelMemberView,
  type DogfoodChannelMessageView,
  type DogfoodChannelView,
  type DogfoodDirectConversationView,
  type DogfoodPrivateChannelInviteCandidateView,
  type DogfoodWorkspaceView
} from "./dogfood-chat-adapter"

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
  convexQuery: vi.fn(),
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
  loadMore: vi.fn(),
  paginationStatus: undefined as "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted" | undefined,
  mutationCallCount: 0,
  workspace: undefined as DogfoodWorkspaceView | null | undefined,
  channels: undefined as ReadonlyArray<DogfoodChannelView> | undefined,
  directConversations: [] as ReadonlyArray<DogfoodDirectConversationView> | undefined,
  directConversationCandidates: undefined as ReadonlyArray<{ readonly id: Id<"users">; readonly displayName: string }> | undefined,
  messages: undefined as ReadonlyArray<DogfoodChannelMessageView> | undefined,
  messagesByChannel: undefined as Record<string, ReadonlyArray<DogfoodChannelMessageView>> | undefined,
  members: undefined as ReadonlyArray<DogfoodChannelMemberView> | undefined,
  membersByChannel: undefined as Record<string, ReadonlyArray<DogfoodChannelMemberView>> | undefined,
  inviteCandidates: undefined as ReadonlyArray<DogfoodPrivateChannelInviteCandidateView> | undefined,
  managementCandidates: undefined as ReadonlyArray<DogfoodPrivateChannelInviteCandidateView> | undefined,
  channelIndicators: undefined as ReadonlyArray<{ readonly channelId: string; readonly indicator: "unread" | "mentioned" }> | undefined
}))

vi.mock("@workos-inc/authkit-react", () => ({
  useAuth: () => mocks.auth
}))

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.convexQuery }),
  useConvexAuth: () => mocks.convexAuth,
  useAction: () => mocks.ensureViewer,
  useMutation: () => {
    const mutation = [
      mocks.sendMessage,
      mocks.editMessage,
      mocks.deleteMessage,
      mocks.toggleMessageReaction,
      mocks.createChannel,
      mocks.editChannel,
      mocks.deleteChannel,
      mocks.addPrivateChannelMember,
      mocks.removePrivateChannelMember,
      mocks.ensureChannelMember,
      mocks.markChannelRead,
      mocks.generateAttachmentUploadUrl,
      mocks.registerAttachmentUpload,
      mocks.deleteAttachmentUpload,
      mocks.startOrReopenDirectConversation
    ][mocks.mutationCallCount % 15]
    mocks.mutationCallCount += 1
    return mutation
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
    if (args === "skip") return undefined
    if (getFunctionName(query as never) === "direct_conversations:list") return mocks.directConversations
    if (getFunctionName(query as never) === "direct_conversations:candidates") return mocks.directConversationCandidates
    if (getFunctionName(query as never) === "chat:eligiblePrivateChannelMembers") {
      return typeof args === "object" && args !== null && "channelId" in args
        ? mocks.managementCandidates
        : mocks.inviteCandidates
    }
    if (typeof args === "object" && args !== null && "channelId" in args) {
      const channelId = String(args.channelId)
      if (getFunctionName(query as never) === "chat:channelMembers") {
        return mocks.membersByChannel?.[channelId] ?? mocks.members
      }
      return mocks.membersByChannel?.[channelId] ?? mocks.members
    }
    if (getFunctionName(query as never) === "chat:channelIndicators") return mocks.channelIndicators
    if (typeof args === "object" && args !== null && "workspaceId" in args) return mocks.channels
    return mocks.workspace
  }
}))

vi.mock("./workspace-chat", () => ({
  WorkspaceChat: ((props: {
    readonly model: {
      readonly workspace: { readonly name: string }
      readonly channel: { readonly id: string }
      readonly activeConversation: { readonly kind: "channel"; readonly channel: { readonly id: string } } | { readonly kind: "direct"; readonly directConversation: { readonly id: string } }
      readonly channels: ReadonlyArray<{ readonly id: string; readonly name: string }>
      readonly directConversations: ReadonlyArray<{ readonly id: string; readonly otherUser: { readonly displayName: string } }>
      readonly directConversationCandidates?: ReadonlyArray<{ readonly id: string; readonly displayName: string }>
      readonly channelMessages: ReadonlyArray<ChatMessage>
      readonly channelMembers?: ReadonlyArray<{ readonly id: string; readonly displayName: string }>
      readonly channelMemberInviteCandidates?: ReadonlyArray<{ readonly id: string; readonly displayName: string }>
      readonly createChannelInviteCandidates?: ReadonlyArray<{ readonly id: string; readonly displayName: string }>
      readonly channelIndicators?: ReadonlyArray<{ readonly channelId: string; readonly indicator: "unread" | "mentioned" }>
      readonly channelMembersLoading?: boolean
      readonly channelMessagesLoading?: boolean
      readonly channelMessagesHasMore?: boolean
      readonly channelMessagesLoadingMore?: boolean
    }
  readonly createChannel?: (input: {
    readonly name: string
    readonly visibility?: "public" | "private"
    readonly initialMemberIds?: ReadonlyArray<string>
  }) => Promise<unknown>
  readonly selectChannel?: (channelId: string) => void
  readonly selectDirectConversation?: (conversationId: string) => void
  readonly startDirectConversation?: (recipientUserId: string) => Promise<unknown>
  readonly addChannelMember?: (input: { readonly channelId: string; readonly userId: string }) => Promise<unknown>
  readonly removeChannelMember?: (input: { readonly channelId: string; readonly userId: string }) => Promise<unknown>
  readonly createChannelMessage: (input: {
    readonly channelId: string
    readonly body: string
    readonly parentMessageId?: string | null
    readonly attachments?: ReadonlyArray<{ readonly storageId: string; readonly name: string }>
  }) => Promise<unknown>
  readonly uploadMessageAttachment?: (file: File) => Promise<unknown>
  readonly editChannelMessage?: (input: { readonly channelId: string; readonly messageId: string; readonly body: string }) => Promise<unknown>
  readonly deleteChannelMessage: (input: { readonly channelId: string; readonly messageId: string }) => Promise<unknown>
  readonly toggleMessageReaction?: (input: { readonly channelId: string; readonly messageId: string; readonly emoji: string }) => Promise<unknown>
  readonly operationErrorMessage?: (operation: "send" | "edit" | "delete" | "react", cause: unknown) => string
  readonly canEditMessage?: (message: ChatMessage) => boolean
  readonly canDeleteMessage?: (message: ChatMessage) => boolean
  readonly profileMenuActions?: ReadonlyArray<{ readonly label: string; readonly onSelect: () => void }>
  readonly loadOlderChannelMessages?: () => void
}) => {
    const firstMessage = props.model.channelMessages[0]
    const secondMessage = props.model.channelMessages[1]
    return (
      <section aria-label="mock workspace chat">
        <h2>{props.model.workspace.name}</h2>
        <output aria-label="active channel">{props.model.activeConversation.kind === "channel" ? props.model.channel.id : props.model.activeConversation.directConversation.id}</output>
        {props.model.channelMessagesLoading === true ? <p>messages loading</p> : null}
        {props.model.channelMessagesHasMore === true
          ? <button type="button" onClick={props.loadOlderChannelMessages}>Load older messages</button>
          : null}
        {props.model.channelMembersLoading === true ? <p>members loading</p> : null}
        <ul aria-label="mock members">
          {props.model.channelMembers?.map((member) => <li key={member.id}>{member.displayName}</li>)}
        </ul>
        <ul aria-label="mock channels">
          {props.model.channels.map((channel) => (
            <li key={channel.id}>
              <button type="button" onClick={() => props.selectChannel?.(channel.id)}>
                {channel.name}
              </button>
              <span>{props.model.channelIndicators?.find((state) => state.channelId === channel.id)?.indicator}</span>
            </li>
          ))}
        </ul>
        <ul aria-label="mock direct conversations">
          {props.model.directConversations.map((conversation) => (
            <li key={conversation.id}>
              <button type="button" onClick={() => props.selectDirectConversation?.(conversation.id)}>{conversation.otherUser.displayName}</button>
            </li>
          ))}
        </ul>
        <ul aria-label="mock direct candidates">
          {props.model.directConversationCandidates?.map((candidate) => (
            <li key={candidate.id}>
              <button type="button" onClick={() => void props.startDirectConversation?.(candidate.id)}>Start {candidate.displayName}</button>
            </li>
          ))}
        </ul>
        <p>{firstMessage?.body}</p>
        {firstMessage?.reactions.map((reaction) => (
          <span key={reaction.emoji}>{reaction.emoji} {reaction.count} {reaction.reactedByCurrentUser ? "active" : "idle"}</span>
        ))}
        {firstMessage?.editedAt === null ? null : <span>edited</span>}
        <button
          type="button"
          onClick={() => props.createChannelMessage({ channelId: props.model.channel.id, body: "Hello from dogfood" })}
        >
          Send mock message
        </button>
        <button type="button" onClick={() => props.createChannel?.({ name: "design" })}>
          Create design channel
        </button>
        <button
          type="button"
          onClick={() => props.createChannel?.({
            name: "leadership",
            visibility: "private",
            initialMemberIds: props.model.createChannelInviteCandidates?.slice(0, 1).map((member) => member.id)
          })}
        >
          Create private channel
        </button>
        <button
          type="button"
          onClick={() => props.model.channelMemberInviteCandidates?.[0] === undefined
            ? undefined
            : props.addChannelMember?.({
                channelId: props.model.channel.id,
                userId: props.model.channelMemberInviteCandidates[0].id
              })}
        >
          Add managed member
        </button>
        <button
          type="button"
          onClick={() => props.removeChannelMember?.({ channelId: props.model.channel.id, userId: "user-1" })}
        >
          Remove current member
        </button>
        <button
          type="button"
          onClick={() => void props.uploadMessageAttachment?.(
            new File(["file"], "brief.txt", { type: "text/plain" })
          ).catch(() => {})}
        >
          Upload mock attachment
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
        {firstMessage !== undefined && props.toggleMessageReaction !== undefined
          ? (
            <button
              type="button"
              onClick={() => props.toggleMessageReaction?.({
                channelId: props.model.channel.id,
                messageId: firstMessage.id,
                emoji: "👍"
              })}
            >
              Toggle first reaction
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
  vi.unstubAllGlobals()
})

beforeEach(() => {
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
  mocks.mutationCallCount = 0
  mocks.workspace = undefined
  mocks.channels = undefined
  mocks.directConversations = []
  mocks.directConversationCandidates = undefined
  mocks.messages = undefined
  mocks.messagesByChannel = undefined
  mocks.paginationStatus = undefined
  mocks.members = undefined
  mocks.membersByChannel = undefined
  mocks.inviteCandidates = undefined
  mocks.managementCandidates = undefined
  mocks.channelIndicators = undefined
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

describe("dogfoodChatToChatData", () => {
  it("adapts a direct conversation into the shared timeline without channel-only controls", async () => {
    const directConversation = {
      id: "direct-1" as Id<"channels">,
      workspaceId: workspace.workspace.id,
      otherUser: { id: "user-2" as Id<"users">, displayName: "Lee Chen" },
      createdAt: 44
    }
    const selections: Array<Id<"channels">> = []
    const chatData = dogfoodChatToChatData({
      data: {
        workspace,
        channels,
        directConversations: [directConversation],
        selectedConversation: { kind: "direct", id: directConversation.id },
        messages: []
      },
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
      data: {
        workspace,
        channels,
        selectedChannelId: workspace.channel.id,
        directConversationCandidates: inviteCandidates,
        messages,
        members,
        channelMemberInviteCandidates: inviteCandidates,
        createChannelInviteCandidates: inviteCandidates
      },
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
    expect(chatData.model.directConversationCandidates).toEqual([{ id: "user-2", displayName: "Lee Chen" }])
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
      data: {
        workspace,
        channels,
        selectedChannelId: "removed-channel" as Id<"channels">,
        messages
      },
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
      data: {
        workspace,
        channels,
        selectedChannelId: workspace.channel.id,
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
      },
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
      data: {
        workspace,
        channels,
        selectedChannelId: workspace.channel.id,
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
      },
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
      data: {
        workspace,
        channels,
        selectedChannelId: workspace.channel.id,
        messages: [{ ...messages[0]!, editedAt: 45 }]
      },
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
      data: {
        workspace,
        channels,
        selectedChannelId: workspace.channel.id,
        messages: [{
          ...messages[0]!,
          reactions: [{ emoji: "👍", count: 2, reactedByCurrentUser: true }]
        }]
      },
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
      data: { workspace, channels, selectedChannelId: channels[1]!.id, messages: [], members: [] },
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
      data: {
        workspace,
        channels,
        selectedChannelId: workspace.channel.id,
        messages,
        channelIndicators: [{ channelId: channels[1]!.id, indicator: "mentioned" }]
      },
      commands: {
        sendMessage: mocks.sendMessage,
        editMessage: mocks.editMessage,
        deleteMessage: mocks.deleteMessage
      }
    })

    expect(chatData.model.channelIndicators).toEqual([{ channelId: channels[1]!.id, indicator: "mentioned" }])
  })

  it("uses Convex ids for chat commands without exposing snapshot-era fields", async () => {
    const chatData = dogfoodChatToChatData({
      data: { workspace, channels, selectedChannelId: workspace.channel.id, messages },
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
      data: {
        workspace,
        channels,
        selectedChannelId: workspace.channel.id,
        messages: messagesWithAnotherAuthor
      },
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
      data: { workspace, channels, selectedChannelId: channels[1]!.id, messages: designMessages },
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
    const { ConvexDogfoodApp } = await import("./dogfood-chat")

    render(<ConvexDogfoodApp />)

    expect(screen.getByRole("heading", { name: "Welcome to Aether" })).toBeTruthy()
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
    expect(screen.getByText(/^VIEWER-/)).toBeTruthy()
    expect(screen.getByText("Use Try again after checking the connection or allowlist.")).toBeTruthy()
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
    mocks.channels = channels
    mocks.messages = messages

    render(<ConvexDogfoodApp />)

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }))

    expect(mocks.auth.signOut).toHaveBeenCalledWith({
      returnTo: "http://localhost:3000/"
    })
  })

  it("sends messages through the Convex mutation using the active channel", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
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

  it("passes membership-backed channel members to the reused chat surface", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = messages
    mocks.members = members

    render(<ConvexDogfoodApp />)

    const memberList = await screen.findByRole("list", { name: "mock members" })
    expect(await within(memberList).findByText("Lee Chen")).toBeTruthy()
    expect(within(memberList).getByText("Maya Patel")).toBeTruthy()
  })

  it("wires private membership commands and moves a self-removed viewer to the default channel", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
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
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = safeWorkspace
    mocks.channels = [safeChannel, privateChannel]
    mocks.messagesByChannel = { "channel-safe": [], "channel-private": [] }
    mocks.membersByChannel = {
      "channel-safe": members,
      "channel-private": members
    }
    mocks.managementCandidates = inviteCandidates

    render(<ConvexDogfoodApp />)

    fireEvent.click(await screen.findByRole("button", { name: "leadership" }))
    await waitFor(() => expect(screen.getByLabelText("active channel").textContent).toBe("channel-private"))
    fireEvent.click(screen.getByRole("button", { name: "Add managed member" }))
    await waitFor(() => expect(mocks.addPrivateChannelMember).toHaveBeenCalledWith({
      channelId: privateChannel.id,
      userId: inviteCandidates[0]!.id
    }))

    fireEvent.click(screen.getByRole("button", { name: "Remove current member" }))
    await waitFor(() => expect(mocks.removePrivateChannelMember).toHaveBeenCalledWith({
      channelId: privateChannel.id,
      userId: workspace.currentUser.id
    }))
    await waitFor(() => expect(screen.getByLabelText("active channel").textContent).toBe("channel-safe"))
  })

  it("keeps the workspace shell mounted while selected channel messages and members load", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = undefined
    mocks.members = undefined

    render(<ConvexDogfoodApp />)

    expect(await screen.findByRole("heading", { name: "Aether Dogfood" })).toBeTruthy()
    expect(screen.getByText("messages loading")).toBeTruthy()
    expect(screen.getByText("members loading")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Loading Chat" })).toBeNull()
  })

  it("opens a direct conversation without public-channel auto-join", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    const directConversation: DogfoodDirectConversationView = {
      id: "direct-1" as Id<"channels">,
      workspaceId: workspace.workspace.id,
      otherUser: { id: "user-2" as Id<"users">, displayName: "Lee Chen" },
      createdAt: 44
    }
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.directConversations = [directConversation]
    mocks.messagesByChannel = { "channel-1": messages, "direct-1": [] }

    const { rerender } = render(<ConvexDogfoodApp />)
    await screen.findByRole("button", { name: "Lee Chen" })
    mocks.directConversations = undefined
    rerender(<ConvexDogfoodApp />)
    expect(screen.getByRole("button", { name: "Lee Chen" })).toBeTruthy()
    mocks.ensureChannelMember.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Lee Chen" }))

    await waitFor(() => expect(screen.getByLabelText("active channel").textContent).toBe("direct-1"))
    expect(mocks.ensureChannelMember).not.toHaveBeenCalled()
  })

  it("starts or reopens a direct conversation from eligible workspace members", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    const directConversation: DogfoodDirectConversationView = {
      id: "direct-1" as Id<"channels">,
      workspaceId: workspace.workspace.id,
      otherUser: { id: "user-2" as Id<"users">, displayName: "Lee Chen" },
      createdAt: 44
    }
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.directConversations = []
    mocks.directConversationCandidates = [{ id: "user-2" as Id<"users">, displayName: "Lee Chen" }]
    mocks.messagesByChannel = { "channel-1": messages, "direct-1": [] }
    mocks.startOrReopenDirectConversation.mockResolvedValue(directConversation)

    render(<ConvexDogfoodApp />)
    fireEvent.click(await screen.findByRole("button", { name: "Start Lee Chen" }))

    await waitFor(() => expect(mocks.startOrReopenDirectConversation).toHaveBeenCalledWith({
      workspaceId: workspace.workspace.id,
      recipientUserId: "user-2"
    }))
    await waitFor(() => expect(screen.getByLabelText("active channel").textContent).toBe("direct-1"))
    expect(screen.getByRole("button", { name: "Lee Chen" })).toBeTruthy()
  })

  it("exposes incremental history loading from the Convex pagination state", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = messages
    mocks.paginationStatus = "CanLoadMore"

    render(<ConvexDogfoodApp />)

    fireEvent.click(await screen.findByRole("button", { name: "Load older messages" }))
    expect(mocks.loadMore).toHaveBeenCalledWith(50)
  })

  it("switches channels and scopes messages and sends to the active channel", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messagesByChannel = {
      "channel-1": messages,
      "channel-2": designMessages
    }

    render(<ConvexDogfoodApp />)

    fireEvent.click(await screen.findByRole("button", { name: "design" }))
    await waitFor(() => expect(mocks.ensureChannelMember).toHaveBeenCalledWith({ channelId: channels[1]!.id }))
    expect(await screen.findByText("Design kickoff is scoped here.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Send mock message" }))

    await waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith({
        channelId: channels[1]!.id,
        body: "Hello from dogfood"
      })
    )
  })

  it("marks the active channel read after its messages load", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
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

  it("marks the active channel read through the newest loaded message without repeating the same marker", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
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
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = messages
    mocks.channelIndicators = [{ channelId: channels[1]!.id, indicator: "unread" }]

    render(<ConvexDogfoodApp />)

    const channelList = await screen.findByRole("list", { name: "mock channels" })
    expect(within(channelList).getByText("unread")).toBeTruthy()
  })

  it("creates channels through the Convex mutation", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = messages

    render(<ConvexDogfoodApp />)

    fireEvent.click(await screen.findByRole("button", { name: "Create design channel" }))

    await waitFor(() => expect(mocks.createChannel).toHaveBeenCalledWith({ name: "design" }))
  })

  it("loads eligible invitees and sends private creation through the typed adapter", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = messages
    mocks.inviteCandidates = inviteCandidates

    render(<ConvexDogfoodApp />)

    fireEvent.click(await screen.findByRole("button", { name: "Create private channel" }))

    await waitFor(() => expect(mocks.createChannel).toHaveBeenCalledWith({
      name: "leadership",
      visibility: "private",
      initialMemberIds: [inviteCandidates[0]!.id]
    }))
  })

  it("joins a selected shared channel before loading its messages", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messagesByChannel = {
      "channel-1": messages,
      "channel-2": designMessages
    }
    mocks.ensureChannelMember.mockImplementation(async () => {
      await Promise.resolve()
    })

    render(<ConvexDogfoodApp />)

    fireEvent.click(await screen.findByRole("button", { name: "design" }))

    expect(screen.getByText("messages loading")).toBeTruthy()
    await waitFor(() => expect(mocks.ensureChannelMember).toHaveBeenCalledWith({ channelId: channels[1]!.id }))
    expect(await screen.findByText("Design kickoff is scoped here.")).toBeTruthy()
  })

  it("wires edit and hard delete mutations for the current author only", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
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

  it("wires reaction toggles through the Convex mutation", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = messages

    render(<ConvexDogfoodApp />)

    fireEvent.click(await screen.findByRole("button", { name: "Toggle first reaction" }))

    await waitFor(() =>
      expect(mocks.toggleMessageReaction).toHaveBeenCalledWith({
        channelId: workspace.channel.id,
        messageId: messages[0]!.id,
        emoji: "👍"
      })
    )
  })

  it("retries attachment registration after the upload succeeds", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = messages
    mocks.registerAttachmentUpload
      .mockRejectedValueOnce(new Error("temporary registration failure"))
      .mockRejectedValueOnce(new Error("temporary registration failure"))
      .mockResolvedValueOnce({ status: "registered", storageId: "storage-1" })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ storageId: "storage-1" })
    }))

    render(<ConvexDogfoodApp />)
    fireEvent.click(await screen.findByRole("button", { name: "Upload mock attachment" }))

    await waitFor(() => expect(mocks.registerAttachmentUpload).toHaveBeenCalledTimes(3))
    expect(mocks.deleteAttachmentUpload).not.toHaveBeenCalled()
  })

  it("cleans up a direct upload after terminal registration failure", async () => {
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = messages
    mocks.registerAttachmentUpload.mockRejectedValue(new Error("registration unavailable"))
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ storageId: "storage-1" })
    }))

    render(<ConvexDogfoodApp />)
    fireEvent.click(await screen.findByRole("button", { name: "Upload mock attachment" }))

    await waitFor(() => expect(mocks.deleteAttachmentUpload).toHaveBeenCalledWith({
      intentId: "intent-1",
      storageId: "storage-1"
    }))
    expect(mocks.registerAttachmentUpload).toHaveBeenCalledTimes(3)
  })

  it("passes compact dogfood mutation errors into the reused chat surface", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { ConvexDogfoodApp } = await import("./dogfood-chat")
    mocks.auth.user = { id: "user-1" }
    mocks.convexAuth.isAuthenticated = true
    mocks.workspace = workspace
    mocks.channels = channels
    mocks.messages = messages

    render(<ConvexDogfoodApp />)

    expect(await screen.findByText(/^Could not send message\. Check your connection and try again\. Diagnostic: MUTATION-/)).toBeTruthy()
    expect(screen.queryByText(/secret mutation details/)).toBeNull()
    const logs = JSON.stringify(warnSpy.mock.calls)
    expect(logs).toContain("details redacted")
    expect(logs).not.toContain("secret mutation details")
    expect(logs).not.toContain("friend@example.com")
    expect(logs).not.toContain("https://private.example")
    expect(logs).not.toContain("Bearer token")
    expect(logs).not.toContain("api_key")
  })

  it("sanitizes render-boundary failures and offers a recovery action", async () => {
    const { DogfoodErrorBoundary } = await import("./dogfood-chat")
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
