// @vitest-environment happy-dom
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  ChatChannel,
  ChatDataModel,
  ChatMessage,
  ChatMessageAttachment,
  ChatMessageParent,
  ChatMessageReaction
} from "./chat-data"
import { WorkspaceChat } from "./workspace-chat"

afterEach(cleanup)

const userId = "human-1"
const workspaceId = "workspace-1"
const channelId = "channel-1"
const secondChannelId = "channel-2"
const messageId = "message-1"

const makeChannel = <T extends ChatChannel>(channel: T): ChatChannel => ({
  id: channel.id,
  name: channel.name,
  visibility: channel.visibility
})

type MessageFixture = Pick<
  ChatMessage,
  "id" | "channelId" | "authorType" | "authorId" | "authorDisplayName" | "body" | "createdAt"
> & Partial<Omit<ChatMessage, "id" | "channelId" | "authorType" | "authorId" | "authorDisplayName" | "body" | "createdAt">>

const makeMessage = (message: MessageFixture): ChatMessage => ({
  editedAt: null,
  deletedAt: null,
  parentMessageId: null,
  parentMessage: null,
  reactions: [],
  attachments: [],
  ...message
})

const makeAttachment = <T extends ChatMessageAttachment>(attachment: T): ChatMessageAttachment => attachment
const makeParent = <T extends ChatMessageParent>(parent: T): ChatMessageParent => parent
const makeReaction = <T extends ChatMessageReaction>(reaction: T): ChatMessageReaction => reaction

const makeChatModel = (messages: ReadonlyArray<ChatMessage> = [
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
]): ChatDataModel => ({
  currentUser: { id: userId, displayName: "Maya Patel" },
  workspace: { name: "Aether Labs" },
  channel: makeChannel({ id: channelId, name: "origination", visibility: "private" }),
  activeConversation: {
    kind: "channel",
    channel: makeChannel({ id: channelId, name: "origination", visibility: "private" })
  },
  channels: [makeChannel({ id: channelId, name: "origination", visibility: "private" })],
  directConversations: [],
  channelMessages: messages,
  channelMessagesLoading: false
})

const renderWorkspaceChat = (model: ChatDataModel) => {
  const calls: Array<{ method: string; args: unknown }> = []
  render(
    <WorkspaceChat
      model={model}
      createChannelMessage={(input) => {
        calls.push({ method: "createChannelMessage", args: input })
        return Promise.resolve()
      }}
      deleteChannelMessage={(input) => {
        calls.push({ method: "deleteChannelMessage", args: input.messageId })
        return Promise.resolve()
      }}
    />
  )
  return calls
}

const openMessageMenu = async (authorDisplayName: string) => {
  fireEvent.click(await screen.findByLabelText(`More actions for message from ${authorDisplayName}`))
  return screen.findByRole("menu", { name: new RegExp(`message from ${authorDisplayName}`) })
}

const openMessageSearch = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Show search" }))
  return screen.findByPlaceholderText("Search origination")
}

describe("WorkspaceChat", () => {
  it("presents explicit direct conversations in the global rail", async () => {
    const model = makeChatModel()
    render(
      <WorkspaceChat
        model={{ ...model, directConversations: [{ id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }] }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const globalNavigation = await screen.findByLabelText("Global navigation")
    const workspaceNavigation = screen.getByLabelText("Workspace navigation")
    const directMessages = within(globalNavigation).getByRole("navigation", { name: "Direct messages" })

    expect(directMessages).toBeTruthy()
    expect(within(directMessages).getByRole("button", { name: "Lee Chen" })).toBeTruthy()
    expect(within(directMessages).getByRole("tooltip", { name: "Lee Chen" })).toBeTruthy()
    expect(within(workspaceNavigation).queryByRole("navigation", { name: "Direct messages" })).toBeNull()
    expect(within(workspaceNavigation).queryByText("Maya Patel")).toBeNull()
  })

  it("announces inactive direct-message unread state in the rail button label", async () => {
    const directConversation = { id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }
    render(
      <WorkspaceChat
        model={{
          ...makeChatModel(),
          directConversations: [directConversation],
          channelIndicators: [{ channelId: directConversation.id, indicator: "unread" }]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const directMessages = within(await screen.findByLabelText("Global navigation")).getByRole("navigation", { name: "Direct messages" })
    const unreadDirectMessage = within(directMessages).getByRole("button", {
      name: "Lee Chen, Unread direct messages with Lee Chen since you last opened it."
    })

    expect(unreadDirectMessage).toBeTruthy()
    expect(unreadDirectMessage.querySelector("[title='Unread direct messages with Lee Chen since you last opened it.']")).toBeTruthy()
    expect(within(directMessages).queryByRole("button", { name: "Lee Chen" })).toBeNull()
  })

  it("announces inactive direct-message mention state in the rail button label", async () => {
    const directConversation = { id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }
    render(
      <WorkspaceChat
        model={{
          ...makeChatModel(),
          directConversations: [directConversation],
          channelIndicators: [{ channelId: directConversation.id, indicator: "mentioned" }]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const directMessages = within(await screen.findByLabelText("Global navigation")).getByRole("navigation", { name: "Direct messages" })

    expect(within(directMessages).getByRole("button", {
      name: "Lee Chen, Mention in direct message with Lee Chen since you last opened it."
    })).toBeTruthy()
    expect(within(directMessages).queryByRole("button", {
      name: "Lee Chen, Unread direct messages with Lee Chen since you last opened it."
    })).toBeNull()
  })

  it("does not announce stale unread state on the active direct message", async () => {
    const directConversation = { id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }
    render(
      <WorkspaceChat
        model={{
          ...makeChatModel(),
          activeConversation: { kind: "direct", directConversation },
          directConversations: [directConversation],
          channelIndicators: [{ channelId: directConversation.id, indicator: "mentioned" }]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const directMessages = within(await screen.findByLabelText("Global navigation")).getByRole("navigation", { name: "Direct messages" })
    const activeDirectMessage = within(directMessages).getByRole("button", { name: "Lee Chen" })

    expect(activeDirectMessage.getAttribute("aria-current")).toBe("page")
    expect(activeDirectMessage.querySelector("[title]")).toBeNull()
    expect(within(directMessages).queryByRole("button", {
      name: "Lee Chen, Mention in direct message with Lee Chen since you last opened it."
    })).toBeNull()
  })

  it("starts a direct message from eligible members and prevents duplicate submission", async () => {
    let resolveStart!: (conversation: { id: string; otherUser: { id: string; displayName: string } }) => void
    const pending = new Promise<{ id: string; otherUser: { id: string; displayName: string } }>((resolve) => {
      resolveStart = resolve
    })
    const starts = vi.fn(() => pending)
    render(
      <WorkspaceChat
        model={{
          ...makeChatModel(),
          directConversationCandidates: [{ id: "user-2", displayName: "Lee Chen" }]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        startDirectConversation={starts}
      />
    )

    fireEvent.click(await screen.findByRole("button", { name: "Start direct message" }))
    const dialog = await screen.findByRole("dialog")
    const recipient = within(dialog).getByRole("button", { name: "Lee Chen" })
    fireEvent.click(recipient)
    fireEvent.click(recipient)

    expect(starts).toHaveBeenCalledTimes(1)
    expect(starts).toHaveBeenCalledWith("user-2")
    resolveStart({ id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Start direct message")
  })

  it("shows direct-message candidate loading, empty search, and retryable failure states", async () => {
    const starts = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({
      id: "direct-1",
      otherUser: { id: "user-2", displayName: "Lee Chen" }
    })
    const base = makeChatModel()
    const props = {
      createChannelMessage: () => Promise.resolve(),
      deleteChannelMessage: () => Promise.resolve(),
      startDirectConversation: starts
    }
    const { rerender } = render(<WorkspaceChat {...props} model={{ ...base, directConversationCandidates: undefined }} />)

    fireEvent.click(await screen.findByRole("button", { name: "Start direct message" }))
    expect(await screen.findByText("Loading accounts...")).toBeTruthy()

    rerender(<WorkspaceChat {...props} model={{ ...base, directConversationCandidates: [{ id: "user-2", displayName: "Lee Chen" }] }} />)
    const search = await screen.findByPlaceholderText("Search usernames")
    fireEvent.change(search, { target: { value: "nobody" } })
    expect(await screen.findByText("No matching accounts.")).toBeTruthy()
    fireEvent.change(search, { target: { value: "Lee" } })
    fireEvent.click(await screen.findByRole("button", { name: "Lee Chen" }))
    expect((await screen.findByRole("alert")).textContent).toContain("Check your connection and try again")
    fireEvent.click(await screen.findByRole("button", { name: "Lee Chen" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(starts).toHaveBeenCalledTimes(2)
  })

  it("keeps direct messages in the global rail while changing channels", async () => {
    const base = makeChatModel()
    const directConversations = [{ id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }]
    const secondChannel = makeChannel({
      id: secondChannelId,
      workspaceId,
      name: "design",
      visibility: "public",
      createdBy: userId,
      createdAt: 3
    })
    const props = {
      createChannelMessage: () => Promise.resolve(),
      deleteChannelMessage: () => Promise.resolve()
    }
    const { rerender } = render(
      <WorkspaceChat
        {...props}
        model={{ ...base, channels: [base.channel, secondChannel], directConversations }}
      />
    )

    const globalNavigation = await screen.findByLabelText("Global navigation")
    const directMessages = within(globalNavigation).getByRole("navigation", { name: "Direct messages" })
    expect(await within(directMessages).findByLabelText("Lee Chen")).toBeTruthy()

    rerender(
      <WorkspaceChat
        {...props}
        model={{
          ...base,
          channel: secondChannel,
          channels: [base.channel, secondChannel],
          directConversations,
          channelMessages: [],
          channelMessagesLoading: true
        }}
      />
    )

    expect(within(directMessages).getByRole("button", { name: "Lee Chen" })).toBeTruthy()
    expect(within(directMessages).getByRole("tooltip", { name: "Lee Chen" })).toBeTruthy()
    expect(screen.getByLabelText("Channel members").querySelector("[aria-busy='true']")).toBeTruthy()
    expect(document.querySelector(".chatTimeline [class*='skeletonPulse']")).toBeTruthy()
    expect(document.querySelector("[class*='skeletonPulse']")).toBeTruthy()
  })

  it("hides workspace channels while a direct conversation is active", () => {
    const directConversation = { id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }
    render(
      <WorkspaceChat
        model={{
          ...makeChatModel(),
          activeConversation: { kind: "direct", directConversation },
          directConversations: [directConversation]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )
    expect(screen.queryByRole("complementary", { name: "Workspace navigation" })).toBeNull()
    expect(screen.queryByRole("navigation", { name: "Channels" })).toBeNull()
  })

  it("renders and switches channels from the model channel list", async () => {
    const base = makeChatModel()
    const secondChannel = makeChannel({
      id: secondChannelId,
      workspaceId,
      name: "design",
      visibility: "public",
      createdBy: userId,
      createdAt: 3
    })
    const selections: Array<string> = []

    render(
      <WorkspaceChat
        model={{ ...base, channels: [base.channel, secondChannel] }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        selectChannel={(id) => selections.push(id)}
      />
    )

    const channels = await screen.findByRole("navigation", { name: "Channels" })
    const originationChannel = within(channels).getByRole("button", { name: "origination" })
    const designChannel = within(channels).getByRole("button", { name: "design" })
    expect(originationChannel.getAttribute("aria-current")).toBe("page")
    expect(originationChannel.className).toContain("bg-surface-rail")
    expect(designChannel.getAttribute("aria-current")).toBeNull()

    fireEvent.click(designChannel)

    expect(selections).toEqual([secondChannelId])
  })

  it("uses icon-only channel visibility cues outside the channel header", async () => {
    const { container } = render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const channels = await screen.findByRole("navigation", { name: "Channels" })

    expect(within(channels).queryByText("private channel")).toBeNull()
    expect(container.querySelector(".chatHeader")?.textContent).not.toContain("private channel")
  })

  it("creates a channel from the add channel dialog", async () => {
    const calls: Array<{ readonly name: string; readonly visibility?: "public" | "private" }> = []

    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        createChannel={(input) => {
          calls.push(input)
          return Promise.resolve(makeChannel({
            id: secondChannelId,
            workspaceId,
            name: input.name,
            visibility: input.visibility ?? "public",
            createdBy: userId,
            createdAt: 4
          }))
        }}
      />
    )

    fireEvent.click(await screen.findByRole("button", { name: "Add channel" }))
    expect(await screen.findByRole("dialog", { name: "Create Channel" })).toBeTruthy()
    const form = await screen.findByRole("form", { name: "Create channel" })
    expect(within(form).getByRole("status").className).toContain("min-h-[17px]")
    fireEvent.change(within(form).getByLabelText("Channel name"), { target: { value: "  #Product Team  " } })
    fireEvent.submit(form)

    await waitFor(() => expect(calls).toEqual([{ name: "product-team", visibility: "public" }]))
  })

  it("searches and selects private-channel invitees with pointer and keyboard interaction", async () => {
    const calls: Array<{
      readonly name: string
      readonly visibility?: "public" | "private"
      readonly initialMemberIds?: ReadonlyArray<string>
    }> = []
    const inviteCandidates = [
      { id: "human-2", displayName: "Lee Chen" },
      { id: "human-3", displayName: "Priya Shah" },
      { id: "human-4", displayName: "Diego Rivera" }
    ]

    render(
      <WorkspaceChat
        model={{ ...makeChatModel(), createChannelInviteCandidates: inviteCandidates }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        createChannel={(input) => {
          calls.push(input)
          return Promise.resolve(makeChannel({ id: secondChannelId, name: input.name, visibility: "private" }))
        }}
      />
    )

    fireEvent.click(await screen.findByRole("button", { name: "Add channel" }))
    const form = await screen.findByRole("form", { name: "Create channel" })
    fireEvent.click(within(form).getByRole("radio", { name: /private/i }))

    const memberSearch = within(form).getByLabelText("Invite members")
    fireEvent.change(memberSearch, { target: { value: "lee" } })
    expect(within(form).getByRole("checkbox", { name: "Lee Chen" })).toBeTruthy()
    expect(within(form).queryByRole("checkbox", { name: "Priya Shah" })).toBeNull()
    fireEvent.click(within(form).getByRole("checkbox", { name: "Lee Chen" }))

    fireEvent.change(memberSearch, { target: { value: "" } })
    const priya = within(form).getByRole("checkbox", { name: "Priya Shah" })
    priya.focus()
    fireEvent.keyDown(priya, { key: " " })
    expect(within(form).getByText("2 of 3 selected")).toBeTruthy()

    fireEvent.change(within(form).getByLabelText("Channel name"), { target: { value: "Leadership" } })
    fireEvent.submit(form)

    await waitFor(() => expect(calls).toEqual([{
      name: "leadership",
      visibility: "private",
      initialMemberIds: ["human-2", "human-3"]
    }]))
    expect(screen.queryByRole("dialog", { name: "Create Channel" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Add channel" }))
    const nextForm = await screen.findByRole("form", { name: "Create channel" })
    expect((within(nextForm).getByRole("radio", { name: /public/i }) as HTMLInputElement).checked).toBe(true)
    expect(within(nextForm).queryByLabelText("Initial invitations")).toBeNull()
  })

  it("keeps private invitation loading and empty states compact", async () => {
    const props = {
      createChannelMessage: () => Promise.resolve(),
      deleteChannelMessage: () => Promise.resolve(),
      createChannel: () => Promise.reject(new Error("not submitted"))
    }
    const { rerender } = render(<WorkspaceChat {...props} model={makeChatModel()} />)

    fireEvent.click(await screen.findByRole("button", { name: "Add channel" }))
    let form = await screen.findByRole("form", { name: "Create channel" })
    fireEvent.click(within(form).getByRole("radio", { name: /private/i }))
    expect(within(form).getByText("Loading members...")).toBeTruthy()
    fireEvent.change(within(form).getByLabelText("Channel name"), { target: { value: "ops" } })
    expect((within(form).getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<WorkspaceChat {...props} model={{ ...makeChatModel(), createChannelInviteCandidates: [] }} />)
    form = await screen.findByRole("form", { name: "Create channel" })
    expect(within(form).getByText(/No other eligible members yet/)).toBeTruthy()
    expect((within(form).getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("keeps the channel creation dialog state scoped to an open attempt", async () => {
    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        createChannel={() => Promise.resolve(makeChannel({
          id: secondChannelId,
          workspaceId,
          name: "product",
          visibility: "public",
          createdBy: userId,
          createdAt: 4
        }))}
      />
    )

    fireEvent.click(await screen.findByRole("button", { name: "Add channel" }))
    const form = await screen.findByRole("form", { name: "Create channel" })
    const channelName = within(form).getByLabelText("Channel name") as HTMLInputElement
    const createButton = within(form).getByRole("button", { name: "Create" }) as HTMLButtonElement
    expect(createButton.disabled).toBe(true)

    fireEvent.change(channelName, { target: { value: "   " } })
    expect(createButton.disabled).toBe(true)

    fireEvent.change(channelName, { target: { value: "ops" } })
    expect(createButton.disabled).toBe(false)
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }))

    expect(screen.queryByRole("dialog", { name: "Create Channel" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Add channel" }))
    const nextForm = await screen.findByRole("form", { name: "Create channel" })
    expect((within(nextForm).getByLabelText("Channel name") as HTMLInputElement).value).toBe("")
    expect(within(nextForm).queryByRole("switch", { name: "Private channel" })).toBeNull()
    expect((within(nextForm).getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows channel creation backend errors without collapsing reserved error space", async () => {
    render(
      <WorkspaceChat
        model={{
          ...makeChatModel(),
          createChannelInviteCandidates: [{ id: "human-2", displayName: "Lee Chen" }]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        createChannel={() => Promise.reject(new Error("raw backend details"))}
      />
    )

    fireEvent.click(await screen.findByRole("button", { name: "Add channel" }))
    const form = await screen.findByRole("form", { name: "Create channel" })
    const status = within(form).getByRole("status")
    expect(status.className).toContain("min-h-[17px]")
    expect(status.className).toContain("invisible")

    fireEvent.click(within(form).getByRole("radio", { name: /private/i }))
    fireEvent.click(within(form).getByRole("checkbox", { name: "Lee Chen" }))
    const channelName = within(form).getByLabelText("Channel name") as HTMLInputElement
    fireEvent.change(channelName, { target: { value: "ops" } })
    fireEvent.submit(form)

    expect(await within(form).findByText("Could not create channel. Check your connection and try again.")).toBeTruthy()
    expect(status.className).not.toContain("invisible")
    expect(screen.queryByText(/raw backend details/)).toBeNull()
    expect(channelName.value).toBe("ops")
    expect(within(form).getByRole("checkbox", { name: "Lee Chen" }).getAttribute("aria-checked")).toBe("true")
  })

  it("rejects empty and invalid channel names before creating", async () => {
    const calls: Array<{ readonly name: string }> = []

    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        createChannel={(input) => {
          calls.push(input)
          return Promise.resolve(makeChannel({
            id: secondChannelId,
            workspaceId,
            name: input.name,
            visibility: "public",
            createdBy: userId,
            createdAt: 4
          }))
        }}
      />
    )

    fireEvent.click(await screen.findByRole("button", { name: "Add channel" }))
    const form = await screen.findByRole("form", { name: "Create channel" })
    const input = within(form).getByLabelText("Channel name")

    fireEvent.change(input, { target: { value: "###" } })
    fireEvent.submit(form)
    expect(await within(form).findByText("Channel name is required.")).toBeTruthy()

    fireEvent.change(input, { target: { value: "design!" } })
    fireEvent.submit(form)
    expect(await within(form).findByText("Use letters, numbers, dashes, or underscores.")).toBeTruthy()
    expect(calls).toEqual([])
  })

  it("shows compact duplicate channel errors and keeps the dialog usable", async () => {
    const calls: Array<{ readonly name: string }> = []

    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        createChannel={(input) => {
          calls.push(input)
          return Promise.reject(new Error("Channel already exists"))
        }}
      />
    )

    fireEvent.click(await screen.findByRole("button", { name: "Add channel" }))
    const form = await screen.findByRole("form", { name: "Create channel" })
    const input = within(form).getByLabelText("Channel name")
    fireEvent.change(input, { target: { value: "design" } })
    fireEvent.submit(form)

    expect(await within(form).findByText("Channel already exists.")).toBeTruthy()
    expect(within(form).getByRole("button", { name: "Create" })).toBeTruthy()

    fireEvent.change(input, { target: { value: "product" } })
    expect(within(form).queryByText("Channel already exists.")).toBeNull()
    expect(calls).toEqual([{ name: "design", visibility: "public" }])
  })

  it("opens profile settings when hovering the rail avatar", async () => {
    let signOuts = 0
    const { container } = render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        profileMenuActions={[{ label: "Sign out", onSelect: () => signOuts++ }]}
      />
    )

    const profileRail = container.querySelector(".railProfile")
    expect(profileRail).toBeTruthy()
    fireEvent.mouseEnter(profileRail!)

    const menu = await screen.findByRole("menu", { name: "Profile settings" })
    const actions = within(menu).getByRole("group", { name: "Accounts and profile actions" })
    expect(within(menu).getByText("Maya Patel")).toBeTruthy()
    expect(menu.className).toContain("max-h-[calc(100dvh-24px)]")
    expect(actions.className).toContain("overflow-y-auto")
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Sign out" }))

    expect(signOuts).toBe(1)
    expect(screen.queryByRole("menu", { name: "Profile settings" })).toBeNull()
  })

  it("uses a dot instead of a count for inactive channel unread state", async () => {
    const base = makeChatModel()
    const secondChannel = makeChannel({
      id: secondChannelId,
      workspaceId,
      name: "design",
      visibility: "public",
      createdBy: userId,
      createdAt: 3
    })

    render(
      <WorkspaceChat
        model={{
          ...base,
          channels: [base.channel, secondChannel],
          channelIndicators: [{ channelId: secondChannelId, indicator: "unread" }]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const channels = await screen.findByRole("navigation", { name: "Channels" })

    const indicator = within(channels).getByLabelText("Unread messages in #design since you last opened it. No native push is sent.")
    expect(indicator).toBeTruthy()
    expect(indicator.getAttribute("title")).toBe("Unread messages in #design since you last opened it. No native push is sent.")
    expect(within(channels).queryByText("2")).toBeNull()
  })

  it("prioritizes mention state over unread state in inactive channel indicators", async () => {
    const base = makeChatModel()
    const secondChannel = makeChannel({
      id: secondChannelId,
      workspaceId,
      name: "design",
      visibility: "public",
      createdBy: userId,
      createdAt: 3
    })

    render(
      <WorkspaceChat
        model={{
          ...base,
          channels: [base.channel, secondChannel],
          channelIndicators: [{ channelId: secondChannelId, indicator: "mentioned" }]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const channels = await screen.findByRole("navigation", { name: "Channels" })

    const indicator = within(channels).getByLabelText("Mention in #design since you last opened it. No native push is sent.")
    expect(indicator).toBeTruthy()
    expect(indicator.getAttribute("title")).toBe("Mention in #design since you last opened it. No native push is sent.")
    expect(within(channels).queryByLabelText("Unread messages in #design since you last opened it. No native push is sent.")).toBeNull()
  })

  it("does not show stale unread state on the current channel", async () => {
    const base = makeChatModel()

    render(
      <WorkspaceChat
        model={{
          ...base,
          channelIndicators: [{ channelId, indicator: "mentioned" }]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const channels = await screen.findByRole("navigation", { name: "Channels" })

    expect(within(channels).queryByLabelText("Mention in #origination since you last opened it. No native push is sent.")).toBeNull()
    expect(within(channels).queryByLabelText("Unread messages in #origination since you last opened it. No native push is sent.")).toBeNull()
  })

  it("shows edited message time with a trailing marker in the timestamp", async () => {
    renderWorkspaceChat(makeChatModel([
      makeMessage({
        id: messageId,
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "The partner brief is ready.",
        createdAt: 2,
        editedAt: 4,
        deletedAt: null
      })
    ]))

    expect(await screen.findByText("The partner brief is ready.")).toBeTruthy()
    const timestamp = document.querySelector(".chatTimeline .messageMeta .messageTimestamp")
    expect(timestamp?.getAttribute("dateTime")).toBe(new Date(4).toISOString())
    expect(timestamp?.textContent).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}\*$/)
    expect(timestamp?.textContent?.endsWith("*")).toBe(true)
    expect(document.querySelector(".chatTimeline .messageEdited")).toBeNull()
  })

  it("searches current channel messages and highlights a selected result", async () => {
    render(
      <WorkspaceChat
        model={makeChatModel([
          makeMessage({
            id: "message-1",
            channelId,
            authorType: "human",
            authorId: userId,
            authorDisplayName: "Maya Patel",
            body: "The launch memo is ready for review.",
            createdAt: 2,
            deletedAt: null
          }),
          makeMessage({
            id: "message-2",
            channelId,
            authorType: "human",
            authorId: "human-2",
            authorDisplayName: "Lee Chen",
            body: "Risk summary needs one more pass.",
            createdAt: 4,
            deletedAt: null
          }),
          makeMessage({
            id: "message-3",
            channelId,
            authorType: "human",
            authorId: "human-3",
            authorDisplayName: "Mina Rao",
            body: "Risk summary was superseded.",
            createdAt: 5,
            deletedAt: 8
          })
        ])}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const search = await openMessageSearch()
    fireEvent.change(search, { target: { value: "risk" } })

    const results = await screen.findByRole("region", { name: "Message search results" })
    expect(within(results).getByText("Lee Chen")).toBeTruthy()
    expect(within(results).getByText("Risk summary needs one more pass.")).toBeTruthy()
    expect(within(results).getByText("#origination")).toBeTruthy()
    expect(within(results).queryByText("Mina Rao")).toBeNull()

    const resultOption = within(results).getByRole("option", { name: /Risk summary needs one more pass/ })
    expect(resultOption.hasAttribute("data-active")).toBe(true)
    fireEvent.click(resultOption)

    await waitFor(() => {
      const message = screen.getAllByText("Risk summary needs one more pass.")
        .find((element) => element.closest(".chatTimeline") !== null)
      const article = message!.closest("article")
      expect(article?.className).toContain("searchHighlighted")
      expect(article).toBe(document.activeElement)
    })

    expect(resultOption.hasAttribute("data-message-highlighted")).toBe(true)
    fireEvent.click(resultOption)

    await waitFor(() => {
      const message = screen.getAllByText("Risk summary needs one more pass.")
        .find((element) => element.closest(".chatTimeline") !== null)
      expect(message!.closest("article")?.className).not.toContain("searchHighlighted")
    })
    expect(resultOption.hasAttribute("data-message-highlighted")).toBe(false)
  })

  it("searches beyond loaded messages and focuses an older channel result", async () => {
    const currentMessage = makeMessage({
      id: "message-current",
      channelId,
      authorType: "human",
      authorId: userId,
      authorDisplayName: "Maya Patel",
      body: "Current launch note.",
      createdAt: 10,
      deletedAt: null
    })
    const olderMessage = makeMessage({
      id: "message-older",
      channelId,
      authorType: "human",
      authorId: "human-2",
      authorDisplayName: "Lee Chen",
      body: "Archive decision from last week.",
      createdAt: 2,
      deletedAt: null
    })
    const searchChannelMessages = vi.fn().mockResolvedValue([olderMessage])
    render(
      <WorkspaceChat
        model={{ ...makeChatModel([currentMessage]), channelMessagesHasMore: true }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        searchChannelMessages={searchChannelMessages}
      />
    )

    const search = await openMessageSearch()
    expect(search.getAttribute("aria-describedby")).toBeNull()
    fireEvent.change(search, { target: { value: "archive" } })
    const result = await screen.findByRole("option", { name: /Archive decision from last week/ })
    expect(searchChannelMessages).toHaveBeenCalledWith({ channelId, query: "archive" })

    fireEvent.click(result)

    await waitFor(() => {
      const messages = screen.getAllByText("Archive decision from last week.")
      expect(messages).toHaveLength(2)
      const article = messages.find((message) => message.closest("article"))?.closest("article")
      expect(article?.className).toContain("searchHighlighted")
      expect(article).toBe(document.activeElement)
    })
  })

  it("ignores stale remote search results after the active conversation changes", async () => {
    let resolveSearch!: (messages: ReadonlyArray<ChatMessage>) => void
    const searchChannelMessages = vi.fn(() => new Promise<ReadonlyArray<ChatMessage>>((resolve) => {
      resolveSearch = resolve
    }))
    const base = makeChatModel([])
    const directConversation = { id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }
    const props = {
      createChannelMessage: () => Promise.resolve(),
      deleteChannelMessage: () => Promise.resolve(),
      searchChannelMessages
    }
    const { rerender } = render(<WorkspaceChat {...props} model={{ ...base, directConversations: [directConversation] }} />)

    fireEvent.click(await screen.findByRole("button", { name: "Show search" }))
    fireEvent.change(await screen.findByPlaceholderText("Search origination"), { target: { value: "archive" } })
    await waitFor(() => expect(searchChannelMessages).toHaveBeenCalledWith({ channelId, query: "archive" }))

    rerender(
      <WorkspaceChat
        {...props}
        model={{
          ...base,
          directConversations: [directConversation],
          activeConversation: { kind: "direct", directConversation },
          channelMessages: []
        }}
      />
    )
    resolveSearch([makeMessage({
      id: "stale-message",
      channelId,
      authorType: "human",
      authorId: userId,
      authorDisplayName: "Maya Patel",
      body: "Stale channel result",
      createdAt: 1
    })])

    await waitFor(() => expect(screen.queryByText("Stale channel result")).toBeNull())
    expect(screen.getByPlaceholderText("Message Lee Chen")).toBeTruthy()
  })

  it("navigates message search results with the keyboard", async () => {
    render(
      <WorkspaceChat
        model={makeChatModel([
          makeMessage({
            id: "message-1",
            channelId,
            authorType: "human",
            authorId: userId,
            authorDisplayName: "Maya Patel",
            body: "The launch memo is ready for review.",
            createdAt: 2,
            deletedAt: null
          }),
          makeMessage({
            id: "message-2",
            channelId,
            authorType: "human",
            authorId: "human-2",
            authorDisplayName: "Lee Chen",
            body: "Risk summary needs one more pass.",
            createdAt: 4,
            deletedAt: null
          }),
          makeMessage({
            id: "message-4",
            channelId,
            authorType: "human",
            authorId: "human-4",
            authorDisplayName: "Alex Kim",
            body: "Another risk review is scheduled.",
            createdAt: 6,
            deletedAt: null
          })
        ])}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const search = await openMessageSearch()
    fireEvent.change(search, { target: { value: "risk" } })

    const listbox = await screen.findByRole("listbox", { name: "Message search matches" })
    const options = within(listbox).getAllByRole("option")
    expect(options).toHaveLength(2)
    expect(options[0]!.hasAttribute("data-active")).toBe(true)
    expect(options[1]!.hasAttribute("data-active")).toBe(false)

    fireEvent.keyDown(search, { key: "ArrowDown", code: "ArrowDown" })
    expect(options[0]!.hasAttribute("data-active")).toBe(false)
    expect(options[1]!.hasAttribute("data-active")).toBe(true)

    fireEvent.keyDown(search, { key: "Enter", code: "Enter" })

    const secondMessage = screen.getAllByText("Another risk review is scheduled.")
      .find((element) => element.closest(".chatTimeline") !== null)
    const secondArticle = secondMessage!.closest("article")!
    await waitFor(() => expect(secondArticle).toBe(document.activeElement))
    expect(secondArticle.className).toContain("searchHighlighted")
    expect(options[1]!.hasAttribute("data-message-highlighted")).toBe(true)

    fireEvent.keyDown(secondArticle, { key: "Enter", code: "Enter" })

    const firstMessage = screen.getAllByText("Risk summary needs one more pass.")
      .find((element) => element.closest(".chatTimeline") !== null)
    const firstArticle = firstMessage!.closest("article")!
    await waitFor(() => expect(firstArticle).toBe(document.activeElement))
    expect(firstArticle.className).toContain("searchHighlighted")
    expect(options[0]!.hasAttribute("data-message-highlighted")).toBe(true)
    expect(options[1]!.hasAttribute("data-message-highlighted")).toBe(false)
  })

  it("moves Escape from a selected message to the input, then closes search without clearing the query", async () => {
    render(
      <WorkspaceChat
        model={makeChatModel([
          makeMessage({
            id: "message-1",
            channelId,
            authorType: "human",
            authorId: userId,
            authorDisplayName: "Maya Patel",
            body: "The launch memo is ready for review.",
            createdAt: 2,
            deletedAt: null
          }),
          makeMessage({
            id: "message-2",
            channelId,
            authorType: "human",
            authorId: "human-2",
            authorDisplayName: "Lee Chen",
            body: "Risk summary needs one more pass.",
            createdAt: 4,
            deletedAt: null
          }),
          makeMessage({
            id: "message-4",
            channelId,
            authorType: "human",
            authorId: "human-4",
            authorDisplayName: "Alex Kim",
            body: "Another risk review is scheduled.",
            createdAt: 6,
            deletedAt: null
          })
        ])}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const search = await openMessageSearch()
    fireEvent.change(search, { target: { value: "risk" } })

    const listbox = await screen.findByRole("listbox", { name: "Message search matches" })
    const options = within(listbox).getAllByRole("option")

    fireEvent.keyDown(search, { key: "Enter", code: "Enter" })
    await waitFor(() => expect(options[0]!.hasAttribute("data-message-highlighted")).toBe(true))
    expect(search).not.toBe(document.activeElement)

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" })
    expect(search).toBe(document.activeElement)
    expect(options[0]!.hasAttribute("data-message-highlighted")).toBe(true)
    expect((search as HTMLInputElement).value).toBe("risk")

    fireEvent.keyDown(search, { key: "Escape", code: "Escape" })
    expect(document.querySelector(".channelMessageSearch")?.className).toContain("hidden")
    expect((search as HTMLInputElement).value).toBe("risk")
  })

  it("shows message search empty and error states", async () => {
    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const search = await openMessageSearch()
    fireEvent.change(search, { target: { value: "nonexistent" } })

    expect((await screen.findByRole("status")).textContent).toBe("No matching messages.")

    fireEvent.change(search, { target: { value: "x".repeat(121) } })

    expect((await screen.findByRole("alert")).textContent).toBe("Search is limited to 120 characters.")
  })

  it("sends a channel message from the bottom composer with Enter", async () => {
    const calls = renderWorkspaceChat(makeChatModel())
    const input = await screen.findByPlaceholderText("Message origination")

    fireEvent.change(input, { target: { value: "I will tighten the partner brief." } })
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" })

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "createChannelMessage",
        args: expect.objectContaining({
          channelId,
          body: "I will tighten the partner brief."
        })
      })
    )
  })

  it("sends a channel message from the composer send button", async () => {
    const calls = renderWorkspaceChat(makeChatModel())
    const input = await screen.findByPlaceholderText("Message origination")

    fireEvent.change(input, { target: { value: "Button send keeps mouse users covered." } })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "createChannelMessage",
        args: expect.objectContaining({
          channelId,
          body: "Button send keeps mouse users covered."
        })
      })
    )
  })

  it("does not clear the next channel draft when a pending send completes", async () => {
    let completeSend!: () => void
    const pendingSend = new Promise<void>((resolve) => {
      completeSend = resolve
    })
    const secondChannel = makeChannel({
      id: secondChannelId,
      workspaceId,
      name: "design",
      visibility: "public",
      createdBy: userId,
      createdAt: 3
    })
    const props = {
      createChannelMessage: () => pendingSend,
      deleteChannelMessage: () => Promise.resolve()
    }
    const base = makeChatModel([])
    const { rerender } = render(
      <WorkspaceChat {...props} model={{ ...base, channels: [base.channel, secondChannel] }} />
    )

    const firstInput = await screen.findByPlaceholderText("Message origination")
    fireEvent.change(firstInput, { target: { value: "Sent from origination." } })
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    rerender(
      <WorkspaceChat
        {...props}
        model={{
          ...base,
          channel: secondChannel,
          channels: [base.channel, secondChannel],
          channelMessages: []
        }}
      />
    )
    const nextInput = await screen.findByPlaceholderText("Message design")
    fireEvent.change(nextInput, { target: { value: "Keep this design draft." } })

    await act(async () => {
      completeSend()
      await pendingSend
    })

    await waitFor(() => expect((nextInput as HTMLTextAreaElement).value).toBe("Keep this design draft."))
  })

  it("sends a reply with the selected parent and can cancel reply mode without clearing the draft", async () => {
    const calls = renderWorkspaceChat(makeChatModel())
    const menu = await openMessageMenu("Maya Patel")
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Reply" }))

    expect(await screen.findByText("Replying to Maya Patel")).toBeTruthy()
    expect(screen.getAllByText("The partner brief needs a concise risk summary.")).toHaveLength(2)

    const input = await screen.findByPlaceholderText("Message origination")
    fireEvent.change(input, { target: { value: "I can add that risk summary." } })
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    expect(screen.queryByText("Replying to Maya Patel")).toBeNull()
    expect((input as HTMLTextAreaElement).value).toBe("I can add that risk summary.")

    const nextMenu = await openMessageMenu("Maya Patel")
    fireEvent.click(within(nextMenu).getByRole("menuitem", { name: "Reply" }))
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" })

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "createChannelMessage",
        args: expect.objectContaining({
          channelId,
          body: "I can add that risk summary.",
          parentMessageId: messageId
        })
      })
    )
    expect(screen.queryByText("Replying to Maya Patel")).toBeNull()
  })

  it("renders parent previews for replies and deleted parent fallbacks", async () => {
    const replyId = "message-2"
    renderWorkspaceChat(makeChatModel([
      makeMessage({
        id: messageId,
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "The partner brief needs a concise risk summary.",
        createdAt: 2,
        deletedAt: null
      }),
      makeMessage({
        id: replyId,
        channelId,
        authorType: "human",
        authorId: "human-2",
        authorDisplayName: "Lee Chen",
        body: "I will draft it.",
        createdAt: 3,
        deletedAt: null,
        parentMessageId: messageId,
        parentMessage: makeParent({
          id: messageId,
          authorDisplayName: "Maya Patel",
          bodyPreview: "The partner brief needs a concise risk summary.",
          deleted: false
        })
      }),
      makeMessage({
        id: "message-3",
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "Thanks.",
        createdAt: 4,
        deletedAt: null,
        parentMessageId: "message-missing",
        parentMessage: null
      })
    ]))

    expect(await screen.findByRole("button", { name: /Reply to Maya Patel/ })).toBeTruthy()
    expect(screen.getByText("I will draft it.")).toBeTruthy()
    expect(screen.getByText("Original message unavailable")).toBeTruthy()
  })

  it("renders image thumbnails and file attachment links without trusting unsafe URLs", async () => {
    renderWorkspaceChat(makeChatModel([
      makeMessage({
        id: messageId,
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "Attachments for review.",
        createdAt: 2,
        deletedAt: null,
        attachments: [
          makeAttachment({
            id: "attachment-1",
            storageId: "storage-1",
            name: "brief.png",
            contentType: "image/png",
            size: 4096,
            kind: "image",
            url: "https://files.example/brief.png"
          }),
          makeAttachment({
            id: "attachment-2",
            storageId: "storage-2",
            name: "notes.pdf",
            contentType: "application/pdf",
            size: 2048,
            kind: "file",
            url: "javascript:alert(1)"
          }),
          makeAttachment({
            id: "attachment-3",
            storageId: "storage-3",
            name: "insecure.txt",
            contentType: "text/plain",
            size: 1024,
            kind: "file",
            url: "http://files.example/insecure.txt"
          })
        ]
      })
    ]))

    const image = await screen.findByRole("img", { name: "brief.png" })
    expect(image.getAttribute("src")).toBe("https://files.example/brief.png")
    expect(screen.getByRole("link", { name: "Open image attachment brief.png" })).toBeTruthy()
    expect(screen.getByText("notes.pdf")).toBeTruthy()
    expect(screen.queryByRole("link", { name: /notes\.pdf/ })).toBeNull()
    expect(screen.getByText("insecure.txt")).toBeTruthy()
    expect(screen.queryByRole("link", { name: /insecure\.txt/ })).toBeNull()
  })

  it("keeps Shift+Enter inside the composer without sending", async () => {
    const calls = renderWorkspaceChat(makeChatModel())
    const input = await screen.findByPlaceholderText("Message origination")

    fireEvent.change(input, { target: { value: "First line" } })
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: true })

    expect(calls.some((call) => call.method === "createChannelMessage")).toBe(false)
    expect((input as HTMLTextAreaElement).value).toBe("First line")
  })

  it("filters and inserts mention suggestions from the composer with the keyboard", async () => {
    const calls: Array<{ readonly channelId: string; readonly body: string }> = []
    render(
      <WorkspaceChat
        model={{
          ...makeChatModel([]),
          channelMembers: [
            { id: "human-2", displayName: "Lee Chen" },
            { id: "human-3", displayName: "Mina Rao" }
          ]
        }}
        createChannelMessage={(input) => {
          calls.push(input)
          return Promise.resolve()
        }}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )
    const input = await screen.findByPlaceholderText("Message origination")

    fireEvent.change(input, { target: { value: "Thanks @le" } })

    const suggestions = await screen.findByRole("listbox", { name: "Mention suggestions" })
    const composer = screen.getByRole("form", { name: "Channel message composer" })
    expect(composer.contains(suggestions)).toBe(false)
    expect(within(suggestions).getByRole("option", { name: "Lee Chen" })).toBeTruthy()
    expect(within(suggestions).queryByRole("option", { name: "Mina Rao" })).toBeNull()

    fireEvent.keyDown(input, { key: "Enter", code: "Enter" })

    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe("Thanks @Lee Chen "))
    expect(screen.queryByRole("listbox", { name: "Mention suggestions" })).toBeNull()

    fireEvent.change(input, { target: { value: "Thanks @Lee Chen for the pass." } })
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" })

    await waitFor(() =>
      expect(calls).toEqual([{
        channelId,
        body: "Thanks @Lee Chen for the pass.",
        parentMessageId: null
      }])
    )
  })

  it("inserts mention suggestions from the composer with the mouse", async () => {
    render(
      <WorkspaceChat
        model={{
          ...makeChatModel([]),
          channelMembers: [
            { id: "human-2", displayName: "Lee Chen" },
            { id: "human-3", displayName: "Mina Rao" }
          ]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )
    const input = await screen.findByPlaceholderText("Message origination")

    fireEvent.change(input, { target: { value: "@mi" } })
    fireEvent.click(await screen.findByRole("option", { name: "Mina Rao" }))

    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe("@Mina Rao "))
    expect(screen.queryByRole("listbox", { name: "Mention suggestions" })).toBeNull()
  })

  it("dismisses mention suggestions from the composer without changing the draft", async () => {
    render(
      <WorkspaceChat
        model={{
          ...makeChatModel([]),
          channelMembers: [{ id: "human-2", displayName: "Lee Chen" }]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )
    const input = await screen.findByPlaceholderText("Message origination")

    fireEvent.change(input, { target: { value: "Loop in @zz" } })

    expect(await screen.findByRole("listbox", { name: "Mention suggestions" })).toBeTruthy()
    expect(screen.getByText("No matching members")).toBeTruthy()

    fireEvent.keyDown(input, { key: "Escape", code: "Escape" })

    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Mention suggestions" })).toBeNull())
    expect((input as HTMLTextAreaElement).value).toBe("Loop in @zz")
  })

  it("shows an empty chat state before the first channel message", async () => {
    renderWorkspaceChat(makeChatModel([]))

    expect(await screen.findByText("No messages yet")).toBeTruthy()
    expect(screen.getByText("Start the conversation in")).toBeTruthy()
    expect(screen.getByText("origination.")).toBeTruthy()
  })

  it("groups consecutive messages from the same author under one sticky avatar", async () => {
    const model = makeChatModel([
      makeMessage({
        id: "message-1",
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "First Maya message.",
        createdAt: 2,
        deletedAt: null
      }),
      makeMessage({
        id: "message-2",
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "Second Maya message.",
        createdAt: 3,
        editedAt: 6,
        deletedAt: null
      }),
      makeMessage({
        id: "message-3",
        channelId,
        authorType: "human",
        authorId: "human-2",
        authorDisplayName: "Lee Chen",
        body: "Lee breaks the chain.",
        createdAt: 4,
        deletedAt: null
      }),
      makeMessage({
        id: "message-4",
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "Maya starts a new chain.",
        createdAt: 5,
        deletedAt: null
      })
    ])

    const { container } = render(
      <WorkspaceChat
        model={model}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    expect(await screen.findByText("First Maya message.")).toBeTruthy()
    expect(Array.from(container.querySelectorAll(".chatTimeline .messageRunAvatar")).map((avatar) => avatar.textContent)).toEqual(["MP", "LC", "MP"])
    expect(container.querySelectorAll(".chatTimeline .messageRun").item(0).querySelectorAll(".channelMessage")).toHaveLength(2)
    expect(Array.from(container.querySelectorAll(".chatTimeline .messageMeta strong")).map((name) => name.textContent)).toEqual(["Maya Patel", "Lee Chen", "Maya Patel"])
    const compactTimestamp = container.querySelector(".chatTimeline .channelMessage.compact .messageAvatarCell .messageTimestamp")
    expect(compactTimestamp?.closest("article")?.className).toContain("items-center")
    expect(compactTimestamp).not.toBeNull()
    expect(compactTimestamp?.classList.contains("hidden")).toBe(false)
    expect(compactTimestamp?.className).toContain("mt-[3px]")
    expect(compactTimestamp?.className).toContain("inline-flex")
    expect(compactTimestamp?.className).toContain("flex-col")
    expect(compactTimestamp?.className).toContain("opacity-0")
    expect(compactTimestamp?.className).toContain("group-hover/message:opacity-100")
    expect(compactTimestamp?.getAttribute("dateTime")).toBe(new Date(6).toISOString())
    expect(Array.from(compactTimestamp?.querySelectorAll("span") ?? []).map((part) => part.textContent)).toEqual([
      expect.stringMatching(/^\d{2}\/\d{2}$/),
      expect.stringMatching(/^\d{2}:\d{2}\*$/)
    ])
    expect(compactTimestamp?.textContent?.endsWith("*")).toBe(true)
    expect(container.querySelector(".chatTimeline .channelMessage.compact .messageEdited")).toBeNull()
  })

  it("shows channel skeletons while selected channel messages load", async () => {
    const { container } = render(
      <WorkspaceChat
        model={{ ...makeChatModel([]), channelMessagesLoading: true }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    expect(await screen.findByRole("heading", { name: "Aether Labs" })).toBeTruthy()
    expect(screen.queryByText("No messages yet")).toBeNull()
    expect(container.querySelectorAll(".channelMessageSkeleton")).toHaveLength(7)
    expect(container.querySelectorAll(".chatTimeline [class*='skeletonPulse']")).toHaveLength(21)
    expect(screen.getByLabelText("Channel members").querySelectorAll("[class*='skeletonPulse']")).toHaveLength(12)
    expect((screen.getByPlaceholderText("Message origination") as HTMLTextAreaElement).disabled).toBe(true)
  })

  it("shows membership-backed channel members before they post", async () => {
    render(
      <WorkspaceChat
        model={{
          ...makeChatModel([]),
          channelMembers: [
            { id: "human-2", displayName: "Lee Chen" },
            { id: userId, displayName: "Maya Patel" }
          ]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const members = await screen.findByLabelText("Channel members")
    expect(within(members).getByText("Lee Chen")).toBeTruthy()
    expect(within(members).getByText("Maya Patel")).toBeTruthy()
    expect(within(members).getByText("You")).toBeTruthy()

    const globalNavigation = screen.getByLabelText("Global navigation")
    const directMessages = within(globalNavigation).getByRole("navigation", { name: "Direct messages" })
    expect(within(directMessages).queryByRole("button", { name: "Lee Chen" })).toBeNull()
    expect(within(directMessages).queryByRole("button", { name: "Maya Patel" })).toBeNull()
  })

  it("lets private-channel admins add members with pending feedback and realtime updates", async () => {
    let resolveAdd: (() => void) | undefined
    const addChannelMember = vi.fn(() => new Promise<void>((resolve) => {
      resolveAdd = resolve
    }))
    const base = makeChatModel([])
    const props = {
      createChannelMessage: () => Promise.resolve(),
      deleteChannelMessage: () => Promise.resolve(),
      addChannelMember,
      removeChannelMember: vi.fn(() => Promise.resolve())
    }
    const { rerender } = render(
      <WorkspaceChat
        {...props}
        model={{
          ...base,
          channelMembers: [{ id: userId, displayName: "Maya Patel", role: "admin" }],
          channelMemberInviteCandidates: [{ id: "human-2", displayName: "Lee Chen" }]
        }}
      />
    )

    const manage = await screen.findByRole("button", { name: "Manage channel members" })
    expect(manage.getAttribute("aria-haspopup")).toBe("dialog")
    fireEvent.click(manage)

    const dialog = await screen.findByRole("dialog", { name: "Manage #origination" })
    expect(within(dialog).getByText("Admin · You")).toBeTruthy()
    expect(within(dialog).getByText("Last admin")).toBeTruthy()
    expect(within(dialog).queryByRole("button", { name: "Remove Maya Patel" })).toBeNull()

    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }))
    expect(addChannelMember).toHaveBeenCalledWith({ channelId, userId: "human-2" })
    expect(within(dialog).getByRole("button", { name: "Adding..." }).hasAttribute("disabled")).toBe(true)
    resolveAdd?.()
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Adding..." })).toBeNull())
    expect(within(dialog).queryByText("Lee Chen was added.")).toBeNull()

    rerender(
      <WorkspaceChat
        {...props}
        model={{
          ...base,
          channelMembers: [
            { id: userId, displayName: "Maya Patel", role: "admin" },
            { id: "human-2", displayName: "Lee Chen", role: "member" }
          ],
          channelMemberInviteCandidates: []
        }}
      />
    )
    expect(within(dialog).getByText("No eligible members to add.")).toBeTruthy()
    expect(within(dialog).getByText("Member")).toBeTruthy()
  })

  it("shows member-management failures and confirms that removal revokes access immediately", async () => {
    const addChannelMember = vi.fn(() => Promise.reject(new Error("private backend detail")))
    const removeChannelMember = vi.fn(() => Promise.resolve())
    render(
      <WorkspaceChat
        model={{
          ...makeChatModel([]),
          channelMembers: [
            { id: userId, displayName: "Maya Patel", role: "admin" },
            { id: "human-2", displayName: "Lee Chen", role: "admin" }
          ],
          channelMemberInviteCandidates: [{ id: "human-3", displayName: "Diego Rivera" }]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        addChannelMember={addChannelMember}
        removeChannelMember={removeChannelMember}
      />
    )

    fireEvent.click(await screen.findByRole("button", { name: "Manage channel members" }))
    const managementDialog = await screen.findByRole("dialog", { name: "Manage #origination" })
    fireEvent.click(within(managementDialog).getByRole("button", { name: "Add" }))
    expect((await within(managementDialog).findByRole("alert")).textContent).toBe("Could not add Diego Rivera. Try again.")
    expect(within(managementDialog).queryByText("private backend detail")).toBeNull()

    const mayaRow = within(managementDialog).getByText("Maya Patel").closest("li")!
    fireEvent.click(within(mayaRow).getByRole("button", { name: "Remove Maya Patel" }))
    const confirmation = await screen.findByRole("dialog", { name: "Remove Maya Patel?" })
    expect(within(confirmation).getByText(/access ends immediately/i)).toBeTruthy()
    expect(within(confirmation).getByText(/moved to an accessible channel/i)).toBeTruthy()
    fireEvent.click(within(confirmation).getByRole("button", { name: "Leave channel" }))
    await waitFor(() => expect(removeChannelMember).toHaveBeenCalledWith({ channelId, userId }))
  })

  it("does not offer private-channel administration to ordinary members or on public channels", async () => {
    const commands = {
      addChannelMember: vi.fn(() => Promise.resolve()),
      removeChannelMember: vi.fn(() => Promise.resolve())
    }
    const base = makeChatModel([])
    const { rerender } = render(
      <WorkspaceChat
        {...commands}
        model={{
          ...base,
          channelMembers: [
            { id: userId, displayName: "Maya Patel", role: "member" },
            { id: "human-2", displayName: "Lee Chen", role: "admin" }
          ]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    expect(screen.queryByRole("button", { name: "Manage channel members" })).toBeNull()
    rerender(
      <WorkspaceChat
        {...commands}
        model={{
          ...base,
          channel: makeChannel({ id: channelId, name: "origination", visibility: "public" }),
          channels: [makeChannel({ id: channelId, name: "origination", visibility: "public" })],
          channelMembers: [{ id: userId, displayName: "Maya Patel", role: "admin" }]
        }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )
    expect(screen.queryByRole("button", { name: "Manage channel members" })).toBeNull()
    expect(screen.getByText("You")).toBeTruthy()
  })

  it("shows an empty channel members state", async () => {
    render(
      <WorkspaceChat
        model={{ ...makeChatModel([]), channelMembers: [] }}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    expect(await screen.findByText("No members yet")).toBeTruthy()
  })

  it("shows a compact send failure when an operation formatter is provided", async () => {
    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.reject(new Error("backend token details"))}
        deleteChannelMessage={() => Promise.resolve()}
        operationErrorMessage={() => "Could not send message. Check your connection and try again."}
      />
    )

    const input = await screen.findByPlaceholderText("Message origination")
    fireEvent.change(input, { target: { value: "I will tighten the partner brief." } })
    fireEvent.submit(input.closest("form")!)

    expect((await screen.findByRole("status")).textContent).toBe("Could not send message. Check your connection and try again.")
    expect(screen.queryByText(/backend token details/)).toBeNull()
  })

  it("shows attachment upload failures without clearing the draft and can send after retry", async () => {
    const calls: Array<unknown> = []
    const upload = vi.fn()
      .mockRejectedValueOnce(new Error("upload token expired"))
      .mockResolvedValueOnce(makeAttachment({
        id: "storage-1",
        storageId: "storage-1",
        name: "brief.png",
        contentType: "image/png",
        size: 4096,
        kind: "image",
        url: null
      }))

    const { container } = render(
      <WorkspaceChat
        model={makeChatModel([])}
        createChannelMessage={(input) => {
          calls.push(input)
          return Promise.resolve()
        }}
        uploadMessageAttachment={upload}
        deleteChannelMessage={() => Promise.resolve()}
        operationErrorMessage={(operation) =>
          operation === "attach"
            ? "Could not upload attachment. Check your connection and try again."
            : "Could not send message. Check your connection and try again."}
      />
    )
    const input = await screen.findByPlaceholderText("Message origination")
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement
    const file = new File(["image"], "brief.png", { type: "image/png" })

    fireEvent.change(input, { target: { value: "Retry keeps this draft." } })
    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(await screen.findByText("Could not upload attachment. Check your connection and try again.")).toBeTruthy()
    expect((input as HTMLTextAreaElement).value).toBe("Retry keeps this draft.")

    fireEvent.change(fileInput, { target: { files: [file] } })
    expect(await screen.findByText("brief.png")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() =>
      expect(calls).toEqual([expect.objectContaining({
        channelId,
        body: "Retry keeps this draft.",
        attachments: [expect.objectContaining({ storageId: "storage-1", name: "brief.png" })]
      })])
    )
  })

  it("discards an upload that completes after switching channels", async () => {
    let completeUpload!: (attachment: ChatMessageAttachment) => void
    const pendingUpload = new Promise<ChatMessageAttachment>((resolve) => {
      completeUpload = resolve
    })
    const upload = vi.fn(() => pendingUpload)
    const discard = vi.fn(() => Promise.resolve())
    const secondChannel = makeChannel({
      id: secondChannelId,
      workspaceId,
      name: "design",
      visibility: "public",
      createdBy: userId,
      createdAt: 3
    })
    const base = makeChatModel([])
    const props = {
      createChannelMessage: () => Promise.resolve(),
      uploadMessageAttachment: upload,
      discardMessageAttachment: discard,
      deleteChannelMessage: () => Promise.resolve()
    }
    const { container, rerender } = render(
      <WorkspaceChat {...props} model={{ ...base, channels: [base.channel, secondChannel] }} />
    )
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File(["image"], "brief.png", { type: "image/png" })] }
    })

    rerender(
      <WorkspaceChat
        {...props}
        model={{
          ...base,
          channel: secondChannel,
          channels: [base.channel, secondChannel],
          channelMessages: []
        }}
      />
    )
    const nextInput = await screen.findByPlaceholderText("Message design")
    fireEvent.change(nextInput, { target: { value: "Keep this design draft." } })
    const uploaded = makeAttachment({
      id: "storage-1",
      storageId: "storage-1",
      name: "brief.png",
      contentType: "image/png",
      size: 5,
      kind: "image",
      url: null
    })

    completeUpload(uploaded)

    await waitFor(() => expect(discard).toHaveBeenCalledWith(uploaded))
    expect(screen.queryByText("brief.png")).toBeNull()
    expect((nextInput as HTMLTextAreaElement).value).toBe("Keep this design draft.")
  })

  it("rejects invalid files before upload and cleans successful uploads after a partial batch failure", async () => {
    const uploaded = makeAttachment({
      id: "storage-1", storageId: "storage-1", name: "brief.png", contentType: "image/png",
      size: 5, kind: "image", url: null
    })
    const upload = vi.fn()
      .mockResolvedValueOnce(uploaded)
      .mockRejectedValueOnce(new Error("second upload failed"))
    const discard = vi.fn(() => Promise.resolve())
    const { container } = render(
      <WorkspaceChat
        model={makeChatModel([])}
        createChannelMessage={() => Promise.resolve()}
        uploadMessageAttachment={upload}
        discardMessageAttachment={discard}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement
    const invalid = new File(["zip"], "archive.zip", { type: "application/zip" })
    fireEvent.change(fileInput, { target: { files: [invalid] } })
    expect(await screen.findByText(/must be PNG, JPEG, GIF, WebP, PDF, or plain text/)).toBeTruthy()
    expect(upload).not.toHaveBeenCalled()

    const first = new File(["one"], "one.png", { type: "image/png" })
    const second = new File(["two"], "two.png", { type: "image/png" })
    fireEvent.change(fileInput, { target: { files: [first, second] } })
    await waitFor(() => expect(discard).toHaveBeenCalledWith(uploaded))
    expect(screen.queryByText("brief.png")).toBeNull()
  })

  it("places multi-select checkboxes before the avatar column", async () => {
    renderWorkspaceChat(makeChatModel([
      ...makeChatModel().channelMessages,
      makeMessage({
        id: "message-2",
        channelId,
        authorType: "human",
        authorId: "human-2",
        authorDisplayName: "Lee Chen",
        body: "I pulled the incidents into the notes.",
        createdAt: 3,
        deletedAt: null
      })
    ]))

    fireEvent.click(within(await openMessageMenu("Maya Patel")).getByRole("menuitem", { name: "Select" }))

    const mayaCheckbox = await screen.findByRole("checkbox", { name: "Deselect message from Maya Patel" })
    const mayaRow = mayaCheckbox.closest("article")
    expect(mayaRow).not.toBeNull()
    const mayaAvatar = within(mayaRow!).getByText("MP")
    expect(mayaCheckbox.compareDocumentPosition(mayaAvatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole("checkbox", { name: "Select message from Lee Chen" })).toBeTruthy()

    fireEvent.click(screen.getByText(/partner brief/))

    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Deselect message from Maya Patel" })).toBeNull())
  })

  it("aligns compact message checkboxes with the message body", async () => {
    renderWorkspaceChat(makeChatModel([
      ...makeChatModel().channelMessages,
      makeMessage({
        id: "message-2",
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "Follow-up without a repeated avatar.",
        createdAt: 3,
        deletedAt: null
      })
    ]))

    fireEvent.click((await screen.findAllByLabelText("More actions for message from Maya Patel"))[0]!)
    fireEvent.click(within(await screen.findByRole("menu", { name: /message from Maya Patel/ })).getByRole("menuitem", { name: "Select" }))

    const compactRow = (await screen.findByText("Follow-up without a repeated avatar.")).closest("article")
    expect(compactRow).not.toBeNull()
    expect(compactRow!.classList.contains("compact")).toBe(true)
    const compactCheckbox = within(compactRow!).getByRole("checkbox", { name: "Select message from Maya Patel" })
    expect(compactCheckbox.closest("label")?.classList.contains("mt-[5px]")).toBe(true)
  })

  it("pins the selection action bar to the top-most selected message", async () => {
    renderWorkspaceChat(makeChatModel([
      ...makeChatModel().channelMessages,
      makeMessage({
        id: "message-2",
        channelId,
        authorType: "human",
        authorId: "human-2",
        authorDisplayName: "Lee Chen",
        body: "I pulled the incidents into the notes.",
        createdAt: 3,
        deletedAt: null
      }),
      makeMessage({
        id: "message-3",
        channelId,
        authorType: "human",
        authorId: "human-3",
        authorDisplayName: "Rina Shah",
        body: "Launch blockers should stay separate.",
        createdAt: 4,
        deletedAt: null
      })
    ]))

    fireEvent.click(within(await openMessageMenu("Rina Shah")).getByRole("menuitem", { name: "Select" }))
    expect(screen.getByLabelText("More actions for message from Rina Shah")).toBeTruthy()

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select message from Lee Chen" }))

    expect(screen.getByLabelText("More actions for message from Lee Chen")).toBeTruthy()
    expect(screen.queryByLabelText("More actions for message from Rina Shah")).toBeNull()
    expect(screen.queryByLabelText("More actions for message from Maya Patel")).toBeNull()
  })

  it("opens a right-click message menu for selection", async () => {
    renderWorkspaceChat(makeChatModel())

    fireEvent.contextMenu(await screen.findByText(/partner brief/), { clientX: 20, clientY: 30 })

    const menu = await screen.findByRole("menu", { name: /message from Maya Patel/ })
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Select" }))

    expect((await screen.findAllByLabelText("Deselect message from Maya Patel")).length).toBeGreaterThan(0)
  })

  it("shows reaction buttons beside the icon More button in the inline message actions", async () => {
    const { container } = render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        toggleMessageReaction={() => Promise.resolve()}
      />
    )

    expect(await screen.findByText(/partner brief/)).toBeTruthy()
    const actions = container.querySelector(".messageActions")
    expect(actions).not.toBeNull()
    const buttons = Array.from(actions!.querySelectorAll("button"))
    expect(buttons).toHaveLength(4)
    expect(buttons.slice(0, 3).map((button) => button.textContent)).toEqual(["👍", "🎉", "👀"])
    expect(buttons[3]?.textContent).toBe("")
    expect(screen.getByLabelText("More actions for message from Maya Patel")).toBeTruthy()
  })

  it("renders message reactions under the message and toggles the selected emoji", async () => {
    const calls: Array<{ readonly messageId: string; readonly emoji: string }> = []
    render(
      <WorkspaceChat
        model={makeChatModel([
          makeMessage({
            id: messageId,
            channelId,
            authorType: "human",
            authorId: userId,
            authorDisplayName: "Maya Patel",
            body: "The partner brief needs a concise risk summary.",
            createdAt: 2,
            deletedAt: null,
            reactions: [makeReaction({ emoji: "👍", count: 2, reactedByCurrentUser: true })]
          })
        ])}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        toggleMessageReaction={(input) => {
          calls.push({ messageId: input.messageId, emoji: input.emoji })
          return Promise.resolve()
        }}
      />
    )

    const reaction = await screen.findByRole("button", { name: "Remove 👍 reaction to message from Maya Patel" })
    expect(reaction.getAttribute("aria-pressed")).toBe("true")
    expect(reaction.textContent).toContain("2")
    expect(reaction.className).toContain("hover:bg-surface-rail")
    expect(reaction.className).toContain("hover:text-foreground")

    const message = reaction.closest(".channelMessage")
    expect(reaction.closest(".messageContent")).not.toBeNull()
    expect(reaction.closest(".messageActions")).toBeNull()
    expect(message?.className).toContain("has-[:focus-visible]:bg-surface-muted")
    expect(message?.className).not.toContain("focus-within:bg-surface-muted")

    fireEvent.click(reaction)

    expect(within(screen.getByLabelText("Reactions for message from Maya Patel")).getByRole("button", { name: "Add 👍 reaction to message from Maya Patel" }).textContent).toContain("1")
    await waitFor(() => expect(calls).toEqual([{ messageId, emoji: "👍" }]))
  })

  it("rolls back an optimistic reaction and shows an error when the mutation fails", async () => {
    render(
      <WorkspaceChat
        model={makeChatModel([
          makeMessage({
            id: messageId,
            channelId,
            authorType: "human",
            authorId: userId,
            authorDisplayName: "Maya Patel",
            body: "The partner brief needs a concise risk summary.",
            createdAt: 2,
            deletedAt: null,
            reactions: [makeReaction({ emoji: "👍", count: 2, reactedByCurrentUser: true })]
          })
        ])}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        toggleMessageReaction={() => Promise.reject(new Error("offline"))}
      />
    )

    fireEvent.click(await screen.findByRole("button", { name: "Remove 👍 reaction to message from Maya Patel" }))

    expect(within(screen.getByLabelText("Reactions for message from Maya Patel")).getByRole("button", { name: "Add 👍 reaction to message from Maya Patel" }).textContent).toContain("1")
    expect(await screen.findByText("Could not update reaction.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Remove 👍 reaction to message from Maya Patel" }).textContent).toContain("2")
  })

  it("waits for delete confirmation before deleting a message", async () => {
    const calls = renderWorkspaceChat(makeChatModel())

    fireEvent.click(await screen.findByLabelText("More actions for message from Maya Patel"))
    const menu = await screen.findByRole("menu", { name: /message from Maya Patel/ })
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete message" }))

    const dialog = await screen.findByRole("dialog", { name: "Delete Message?" })
    expect(within(dialog).getByText(/Delete this message from Maya Patel/)).toBeTruthy()
    expect(calls).not.toContainEqual({ method: "deleteChannelMessage", args: messageId })

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(calls).toContainEqual({ method: "deleteChannelMessage", args: messageId }))
  })

  it("cancels a pending message delete", async () => {
    const calls = renderWorkspaceChat(makeChatModel())

    fireEvent.click(await screen.findByLabelText("More actions for message from Maya Patel"))
    const menu = await screen.findByRole("menu", { name: /message from Maya Patel/ })
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete message" }))

    const dialog = await screen.findByRole("dialog", { name: "Delete Message?" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))

    expect(screen.queryByRole("dialog", { name: "Delete Message?" })).toBeNull()
    expect(calls).not.toContainEqual({ method: "deleteChannelMessage", args: messageId })
  })

  it("shows edit and delete actions only for messages allowed by per-message guards", async () => {
    const calls: Array<{ method: string; args: unknown }> = []
    const model = makeChatModel([
      ...makeChatModel().channelMessages,
      makeMessage({
        id: "message-2",
        channelId,
        authorType: "human",
        authorId: "human-2",
        authorDisplayName: "Lee Chen",
        body: "I pulled the incidents into the notes.",
        createdAt: 3,
        deletedAt: null
      })
    ])

    render(
      <WorkspaceChat
        model={model}
        createChannelMessage={() => Promise.resolve()}
        editChannelMessage={(input) => {
          calls.push({ method: "editChannelMessage", args: input })
          return Promise.resolve()
        }}
        deleteChannelMessage={(input) => {
          calls.push({ method: "deleteChannelMessage", args: input.messageId })
          return Promise.resolve()
        }}
        canEditMessage={(message) => message.authorId === model.currentUser.id}
        canDeleteMessage={(message) => message.authorId === model.currentUser.id}
      />
    )

    const mayaMenu = await openMessageMenu("Maya Patel")
    expect(within(mayaMenu).getByRole("menuitem", { name: "Edit message" })).toBeTruthy()
    expect(within(mayaMenu).getByRole("menuitem", { name: "Delete message" })).toBeTruthy()

    fireEvent.contextMenu(screen.getByText(/incidents into the notes/), { clientX: 20, clientY: 30 })
    const menu = await screen.findByRole("menu", { name: /message from Lee Chen/ })
    expect(within(menu).queryByRole("menuitem", { name: "Edit message" })).toBeNull()
    expect(within(menu).queryByRole("menuitem", { name: "Delete message" })).toBeNull()
  })

  it("saves an inline message edit with Enter", async () => {
    const calls: Array<{ method: string; args: unknown }> = []

    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        editChannelMessage={(input) => {
          calls.push({ method: "editChannelMessage", args: input })
          return Promise.resolve()
        }}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    fireEvent.click(within(await openMessageMenu("Maya Patel")).getByRole("menuitem", { name: "Edit message" }))
    const editor = await screen.findByLabelText("Edit message text from Maya Patel")
    fireEvent.change(editor, { target: { value: "The partner brief is ready for review." } })
    fireEvent.keyDown(editor, { key: "Enter", code: "Enter" })

    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "editChannelMessage",
        args: {
          channelId,
          messageId,
          body: "The partner brief is ready for review."
        }
      })
    )
  })

  it("shows a compact edit failure and keeps the editor open", async () => {
    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        editChannelMessage={() => Promise.reject(new Error("raw mutation stack"))}
        deleteChannelMessage={() => Promise.resolve()}
        operationErrorMessage={() => "Could not save edit. Check your connection and try again."}
      />
    )

    fireEvent.click(within(await openMessageMenu("Maya Patel")).getByRole("menuitem", { name: "Edit message" }))
    const editor = await screen.findByLabelText("Edit message text from Maya Patel")
    fireEvent.change(editor, { target: { value: "The partner brief is ready for review." } })
    fireEvent.keyDown(editor, { key: "Enter", code: "Enter" })

    expect((await screen.findByRole("status")).textContent).toBe("Could not save edit. Check your connection and try again.")
    expect(screen.getByLabelText("Edit message text from Maya Patel")).toBeTruthy()
    expect(screen.queryByText(/raw mutation stack/)).toBeNull()
  })

  it("cancels an inline message edit with Escape", async () => {
    const calls: Array<{ method: string; args: unknown }> = []

    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        editChannelMessage={(input) => {
          calls.push({ method: "editChannelMessage", args: input })
          return Promise.resolve()
        }}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    fireEvent.click(within(await openMessageMenu("Maya Patel")).getByRole("menuitem", { name: "Edit message" }))
    const editor = await screen.findByLabelText("Edit message text from Maya Patel")
    fireEvent.change(editor, { target: { value: "Draft that should be discarded." } })
    fireEvent.keyDown(editor, { key: "Escape", code: "Escape" })

    expect(screen.queryByLabelText("Edit message text from Maya Patel")).toBeNull()
    expect(await screen.findByText("The partner brief needs a concise risk summary.")).toBeTruthy()
    expect(screen.queryByText("Draft that should be discarded.")).toBeNull()
    expect(calls).toEqual([])
  })

  it("shows a compact delete failure and keeps the confirmation open", async () => {
    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.reject(new Error("raw delete failure"))}
        operationErrorMessage={() => "Could not delete message. Check your connection and try again."}
      />
    )

    fireEvent.click(await screen.findByLabelText("More actions for message from Maya Patel"))
    const menu = await screen.findByRole("menu", { name: /message from Maya Patel/ })
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete message" }))
    const dialog = await screen.findByRole("dialog", { name: "Delete Message?" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))

    expect((await screen.findByRole("status")).textContent).toBe("Could not delete message. Check your connection and try again.")
    expect(screen.getByRole("dialog", { name: "Delete Message?" })).toBeTruthy()
    expect(screen.queryByText(/raw delete failure/)).toBeNull()
  })

  it("keeps Shift+Enter in an inline message edit without saving", async () => {
    const calls: Array<{ method: string; args: unknown }> = []

    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        editChannelMessage={(input) => {
          calls.push({ method: "editChannelMessage", args: input })
          return Promise.resolve()
        }}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    fireEvent.click(within(await openMessageMenu("Maya Patel")).getByRole("menuitem", { name: "Edit message" }))
    const editor = await screen.findByLabelText("Edit message text from Maya Patel")
    fireEvent.change(editor, { target: { value: "Line one" } })
    const enterEvent = createEvent.keyDown(editor, { key: "Enter", code: "Enter", shiftKey: true })
    fireEvent(editor, enterEvent)
    fireEvent.change(editor, { target: { value: "Line one\nLine two" } })

    expect(enterEvent.defaultPrevented).toBe(false)
    expect((editor as HTMLTextAreaElement).value).toBe("Line one\nLine two")
    expect(calls).toEqual([])
  })

  it("collapses and reopens the channel members panel", async () => {
    renderWorkspaceChat(makeChatModel())

    const hideMembersButton = await screen.findByRole("button", { name: "Hide members" })
    expect(hideMembersButton.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(hideMembersButton)

    const showMembersButton = screen.getByRole("button", { name: "Show members" })
    expect(showMembersButton.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(showMembersButton)

    expect(screen.getByRole("button", { name: "Hide members" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("offers edit, delete, and manage from a channel right-click menu", async () => {
    const edits: unknown[] = []
    const deletions: unknown[] = []
    const selections: string[] = []
    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        selectChannel={(id) => selections.push(id)}
        editChannel={(input) => {
          edits.push(input)
          return Promise.resolve(makeChannel({ id: input.channelId, name: input.name, visibility: "private" }))
        }}
        deleteChannel={(input) => {
          deletions.push(input)
          return Promise.resolve()
        }}
      />
    )

    const channelButton = within(screen.getByLabelText("Channels")).getByRole("button", { name: /origination/ })
    fireEvent.contextMenu(channelButton, { clientX: 24, clientY: 40 })
    let menu = await screen.findByRole("menu", { name: "Context menu for #origination" })
    expect(within(menu).getByRole("menuitem", { name: "Manage" })).toBeTruthy()
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Edit" }))

    const editDialog = await screen.findByRole("dialog", { name: "Edit channel" })
    fireEvent.change(within(editDialog).getByLabelText("Channel name"), { target: { value: "Product Team" } })
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(edits).toEqual([{ channelId, name: "product-team" }]))

    fireEvent.contextMenu(channelButton, { clientX: 24, clientY: 40 })
    menu = await screen.findByRole("menu", { name: "Context menu for #origination" })
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }))
    const deleteDialog = await screen.findByRole("dialog", { name: "Delete #origination?" })
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "Delete channel" }))
    await waitFor(() => expect(deletions).toEqual([{ channelId }]))

    fireEvent.contextMenu(channelButton, { clientX: 24, clientY: 40 })
    menu = await screen.findByRole("menu", { name: "Context menu for #origination" })
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Manage" }))
    expect(selections).toContain(channelId)
    expect(screen.getByRole("button", { name: "Hide members" })).toBeTruthy()
  })

  it("opens and closes message search from the header toggle and keyboard shortcut", async () => {
    renderWorkspaceChat(makeChatModel())

    const showSearchButton = await screen.findByRole("button", { name: "Show search" })
    expect(showSearchButton.getAttribute("aria-pressed")).toBe("false")
    expect(document.querySelector(".channelMessageSearch")?.className).toContain("hidden")

    fireEvent.click(showSearchButton)

    const searchInput = await screen.findByPlaceholderText("Search origination")
    expect(document.querySelector(".channelMessageSearch")?.className).not.toContain("hidden")
    expect(searchInput).toBe(document.activeElement)
    expect(screen.getByRole("button", { name: "Hide search" }).getAttribute("aria-pressed")).toBe("true")

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" })
    expect(document.querySelector(".channelMessageSearch")?.className).toContain("hidden")
    expect(screen.getByRole("button", { name: "Show search" }).getAttribute("aria-pressed")).toBe("false")

    fireEvent.keyDown(window, { key: "f", code: "KeyF", metaKey: true })
    const reopenedSearchInput = await screen.findByPlaceholderText("Search origination")
    expect(document.querySelector(".channelMessageSearch")?.className).not.toContain("hidden")
    expect(reopenedSearchInput).toBe(document.activeElement)

    screen.getByRole("button", { name: "Hide search" }).focus()
    fireEvent.keyDown(window, { key: "f", code: "KeyF", metaKey: true })
    expect(reopenedSearchInput).toBe(document.activeElement)
    expect(document.querySelector(".channelMessageSearch")?.className).not.toContain("hidden")

    fireEvent.keyDown(window, { key: "f", code: "KeyF", metaKey: true })
    expect(document.querySelector(".channelMessageSearch")?.className).toContain("hidden")
  })
})
