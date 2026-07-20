import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ChatChannel, ChatDataModel, ChatMessage } from "../chat-data"
import { WorkspaceChat, type WorkspaceChatProps } from "../workspace-chat"

export const userId = "human-1"
export const channelId = "channel-1"
export const secondChannelId = "channel-2"
export const messageId = "message-1"

export const makeChannel = (channel: ChatChannel): ChatChannel => channel

export type MessageFixture = Pick<
  ChatMessage,
  "id" | "channelId" | "authorType" | "authorId" | "authorDisplayName" | "body" | "createdAt"
> &
  Partial<
    Omit<ChatMessage, "id" | "channelId" | "authorType" | "authorId" | "authorDisplayName" | "body" | "createdAt">
  >

export const makeMessage = (message: MessageFixture): ChatMessage => ({
  editedAt: null,
  deletedAt: null,
  parentMessageId: null,
  parentMessage: null,
  reactions: [],
  attachments: [],
  ...message
})

export const makeChatModel = (
  messages: ReadonlyArray<ChatMessage> = [
    makeMessage({
      id: messageId,
      channelId,
      authorType: "human",
      authorId: userId,
      authorDisplayName: "Maya Patel",
      body: "The partner brief needs a concise risk summary.",
      createdAt: 2,
      deletedAt: null
    })
  ]
): ChatDataModel => ({
  currentUser: { id: userId, displayName: "Maya Patel" },
  workspace: { name: "Aether Labs" },
  channel: makeChannel({ id: channelId, name: "origination", visibility: "private" }),
  activeConversation: {
    kind: "channel",
    channel: makeChannel({ id: channelId, name: "origination", visibility: "private" })
  },
  channels: [makeChannel({ id: channelId, name: "origination", visibility: "private" })],
  directMessages: {
    conversations: { status: "ready", data: [] },
    profile: { status: "loading" },
    incomingFriendRequests: { status: "loading" }
  },
  conversation: {
    messages: { status: "ready", data: messages, hasMore: false, loadingMore: false },
    members: { status: "unavailable" },
    memberInviteCandidates: { status: "unavailable" },
    notificationPreference: { status: "unavailable" }
  },
  channelCreation: { inviteCandidates: { status: "loading" } },
  indicators: { status: "ready", data: [] }
})

export const withDirectConversations = (
  model: ChatDataModel,
  conversations: Extract<ChatDataModel["directMessages"]["conversations"], { readonly data: unknown }>["data"]
): ChatDataModel => ({
  ...model,
  directMessages: { ...model.directMessages, conversations: { status: "ready", data: conversations } }
})

export const withMessages = (model: ChatDataModel, messages: ReadonlyArray<ChatMessage>): ChatDataModel => ({
  ...model,
  conversation: {
    ...model.conversation,
    messages: { status: "ready", data: messages, hasMore: false, loadingMore: false }
  }
})

export const messagesOf = (model: ChatDataModel): ReadonlyArray<ChatMessage> =>
  model.conversation.messages.status === "ready" ? model.conversation.messages.data : []

export const withMembers = (
  model: ChatDataModel,
  members: Extract<ChatDataModel["conversation"]["members"], { readonly data: unknown }>["data"]
): ChatDataModel => ({
  ...model,
  conversation: { ...model.conversation, members: { status: "ready", data: members } }
})

export const withMemberInviteCandidates = (
  model: ChatDataModel,
  candidates: Extract<ChatDataModel["conversation"]["memberInviteCandidates"], { readonly data: unknown }>["data"]
): ChatDataModel => ({
  ...model,
  conversation: { ...model.conversation, memberInviteCandidates: { status: "ready", data: candidates } }
})

export const withChannelInviteCandidates = (
  model: ChatDataModel,
  candidates: Extract<ChatDataModel["channelCreation"]["inviteCandidates"], { readonly data: unknown }>["data"]
): ChatDataModel => ({
  ...model,
  channelCreation: { inviteCandidates: { status: "ready", data: candidates } }
})

export const withIndicators = (
  model: ChatDataModel,
  indicators: Extract<ChatDataModel["indicators"], { readonly data: unknown }>["data"]
): ChatDataModel => ({ ...model, indicators: { status: "ready", data: indicators } })

export const makeMessageCapabilities = (
  overrides: Partial<WorkspaceChatProps["messages"]> = {}
): WorkspaceChatProps["messages"] => ({
  create: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  canDeleteMessages: true,
  ...overrides
})

export const TestWorkspaceChat = ({
  model,
  ...props
}: { readonly model: ChatDataModel } & Partial<WorkspaceChatProps>) => (
  <WorkspaceChat model={model} navigation={{}} messages={makeMessageCapabilities()} {...props} />
)

export const renderWorkspaceChat = (model: ChatDataModel) => {
  const calls: Array<{ method: string; args: unknown }> = []
  render(
    <TestWorkspaceChat
      model={model}
      messages={{
        create: (input) => {
          calls.push({ method: "createChannelMessage", args: input })
          return Promise.resolve()
        },
        delete: (input) => {
          calls.push({ method: "deleteChannelMessage", args: input.messageId })
          return Promise.resolve()
        },
        canDeleteMessages: true
      }}
    />
  )
  return calls
}

export const openMessageMenu = async (authorDisplayName: string) => {
  await userEvent.setup().click(await screen.findByLabelText(`More actions for message from ${authorDisplayName}`))
  return screen.findByRole("menu", { name: new RegExp(`message from ${authorDisplayName}`) })
}

export const openMessageSearch = async () => {
  await userEvent.setup().click(await screen.findByRole("button", { name: "Show search" }))
  return screen.findByPlaceholderText("Search origination")
}

export const replaceText = async (element: Element, value: string) => {
  if (!(element instanceof HTMLElement)) throw new Error("Expected a text control")
  const user = userEvent.setup()
  await user.clear(element)
  if (value.length > 0) await user.type(element, value)
}

export const uploadFiles = async (element: Element, files: File | ReadonlyArray<File>) => {
  if (!(element instanceof HTMLInputElement)) throw new Error("Expected a file input")
  await userEvent.setup().upload(element, files instanceof File ? files : [...files])
}
