// @vitest-environment happy-dom
import { cleanup, act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ChatChannelMember } from "./chat-data"
import {
  channelId,
  makeChannel,
  makeChatModel,
  makeMessage,
  renderWorkspaceChat,
  replaceText,
  secondChannelId,
  TestWorkspaceChat,
  userId,
  withChannelInviteCandidates,
  withDirectConversations,
  withIndicators
} from "./workspace-chat/test-support"

afterEach(cleanup)

describe("WorkspaceChat", () => {
  it("shows the latest message when entering a channel after its messages load", async () => {
    const scrollHeight = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(720)
    const base = makeChatModel([])
    const { rerender } = render(
      <TestWorkspaceChat
        model={{
          ...base,
          conversation: { ...base.conversation, messages: { status: "loading" } }
        }}
      />
    )

    const timeline = screen.getByRole("list", { name: "Channel messages" })
    expect(timeline.scrollTop).toBe(0)

    rerender(
      <TestWorkspaceChat
        model={{
          ...base,
          conversation: {
            ...base.conversation,
            messages: {
              status: "ready",
              data: [
                makeMessage({
                  id: "latest-message",
                  channelId,
                  authorType: "human",
                  authorId: userId,
                  authorDisplayName: "Maya Patel",
                  body: "This is the latest update.",
                  createdAt: 10
                })
              ],
              hasMore: false,
              loadingMore: false
            }
          }
        }}
      />
    )

    await waitFor(() => expect(timeline.scrollTop).toBe(720))
    scrollHeight.mockRestore()
  })

  it("keeps the compact lock badge in the private-channel glyph", async () => {
    renderWorkspaceChat(makeChatModel())

    const channels = within(await screen.findByLabelText("Workspace navigation")).getByRole("navigation", {
      name: "Channels"
    })
    const privateChannel = within(channels).getByRole("button", { name: /origination/ })
    const glyph = privateChannel.querySelector(".channelGlyph.private")

    expect(glyph?.querySelector(".channelHashIcon")?.classList.contains("size-[18px]")).toBe(true)
    expect(glyph?.querySelector(".channelLockBadge")?.classList.contains("size-[9px]")).toBe(true)
  })

  it("offers channel notification modes and saves the selected preference", async () => {
    const user = userEvent.setup()
    const updates: Array<{ readonly channelId: string; readonly mode: "all" | "mentions" | "off" }> = []
    render(
      <TestWorkspaceChat
        model={{
          ...makeChatModel(),
          conversation: {
            ...makeChatModel().conversation,
            notificationPreference: {
              status: "ready",
              data: { mode: "mentions", options: ["all", "mentions", "off"] }
            }
          }
        }}
        notifications={{
          updatePreference: (input) => {
            updates.push(input)
            return Promise.resolve({ mode: input.mode, options: ["all", "mentions", "off"] })
          }
        }}
      />
    )

    const preference = await screen.findByRole("combobox", { name: "Notifications for origination" })
    await user.click(preference)
    expect(await screen.findByRole("option", { name: "Mentions only" })).toBeInTheDocument()
    const allMessages = screen.getByRole("option", { name: "All messages" })
    await user.click(allMessages)
    await waitFor(() => expect(updates).toEqual([{ channelId, mode: "all" }]))
  })

  it("omits mention-only notification mode for direct conversations", async () => {
    const user = userEvent.setup()
    const directConversation = { id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }
    render(
      <TestWorkspaceChat
        model={{
          ...makeChatModel(),
          activeConversation: { kind: "direct", directConversation },
          directMessages: {
            ...makeChatModel().directMessages,
            conversations: { status: "ready", data: [directConversation] }
          },
          conversation: {
            ...makeChatModel().conversation,
            notificationPreference: { status: "ready", data: { mode: "all", options: ["all", "off"] } }
          }
        }}
        notifications={{
          updatePreference: (input) => Promise.resolve({ mode: input.mode, options: ["all", "off"] })
        }}
      />
    )

    const preference = await screen.findByRole("combobox", { name: "Notifications for Lee Chen" })
    await user.click(preference)
    expect(await screen.findByRole("option", { name: "All messages" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Muted" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Mentions only" })).not.toBeInTheDocument()
  })

  it("presents explicit direct conversations in the global rail", async () => {
    const model = makeChatModel()
    render(
      <TestWorkspaceChat
        model={withDirectConversations(model, [
          { id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }
        ])}
      />
    )

    const globalNavigation = await screen.findByLabelText("Global navigation")
    const workspaceNavigation = screen.getByLabelText("Workspace navigation")
    const directMessages = within(globalNavigation).getByRole("navigation", { name: "Direct messages" })

    expect(directMessages).toBeTruthy()
    const directMessageButton = within(directMessages).getByRole("button", { name: "Lee Chen" })
    expect(directMessageButton).toBeTruthy()
    expect(directMessageButton.textContent).toBe("LC")
    expect(directMessageButton.childElementCount).toBe(0)
    expect(directMessageButton.className).toContain("rounded-full")
    expect(directMessageButton.hasAttribute("data-base-ui-tooltip-trigger")).toBe(true)
    expect(within(workspaceNavigation).queryByRole("navigation", { name: "Direct messages" })).toBeNull()
    expect(within(workspaceNavigation).queryByText("Maya Patel")).toBeNull()
  })

  it("announces inactive direct-message unread state in the rail button label", async () => {
    const directConversation = { id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }
    render(
      <TestWorkspaceChat
        model={withIndicators(withDirectConversations(makeChatModel(), [directConversation]), [
          { channelId: directConversation.id, indicator: "unread" }
        ])}
      />
    )

    const directMessages = within(await screen.findByLabelText("Global navigation")).getByRole("navigation", {
      name: "Direct messages"
    })
    const unreadDirectMessage = within(directMessages).getByRole("button", {
      name: "Lee Chen, Unread direct messages with Lee Chen since you last opened it."
    })

    expect(unreadDirectMessage).toBeTruthy()
    expect(
      unreadDirectMessage.querySelector("[title='Unread direct messages with Lee Chen since you last opened it.']")
    ).toBeTruthy()
    expect(within(directMessages).queryByRole("button", { name: "Lee Chen" })).toBeNull()
  })

  it("announces inactive direct-message mention state in the rail button label", async () => {
    const directConversation = { id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }
    render(
      <TestWorkspaceChat
        model={withIndicators(withDirectConversations(makeChatModel(), [directConversation]), [
          { channelId: directConversation.id, indicator: "mentioned" }
        ])}
      />
    )

    const directMessages = within(await screen.findByLabelText("Global navigation")).getByRole("navigation", {
      name: "Direct messages"
    })

    expect(
      within(directMessages).getByRole("button", {
        name: "Lee Chen, Mention in direct message with Lee Chen since you last opened it."
      })
    ).toBeTruthy()
    expect(
      within(directMessages).queryByRole("button", {
        name: "Lee Chen, Unread direct messages with Lee Chen since you last opened it."
      })
    ).toBeNull()
  })

  it("does not announce stale unread state on the active direct message", async () => {
    const directConversation = { id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }
    render(
      <TestWorkspaceChat
        model={withIndicators(
          withDirectConversations({ ...makeChatModel(), activeConversation: { kind: "direct", directConversation } }, [
            directConversation
          ]),
          [{ channelId: directConversation.id, indicator: "mentioned" }]
        )}
      />
    )

    const directMessages = within(await screen.findByLabelText("Global navigation")).getByRole("navigation", {
      name: "Direct messages"
    })
    const activeDirectMessage = within(directMessages).getByRole("button", { name: "Lee Chen" })

    expect(activeDirectMessage.getAttribute("aria-current")).toBe("page")
    expect(activeDirectMessage.querySelector("[title]")).toBeNull()
    expect(
      within(directMessages).queryByRole("button", {
        name: "Lee Chen, Mention in direct message with Lee Chen since you last opened it."
      })
    ).toBeNull()
  })

  it("starts a direct message from eligible members and prevents duplicate submission", async () => {
    const user = userEvent.setup()
    let resolveStart!: (conversation: { id: string; otherUser: { id: string; displayName: string } }) => void
    const pending = new Promise<{ id: string; otherUser: { id: string; displayName: string } }>((resolve) => {
      resolveStart = resolve
    })
    const starts = vi.fn(() => pending)
    const searchCandidates = vi.fn().mockResolvedValue([
      {
        id: "user-2",
        displayName: "Lee Chen",
        username: "lee",
        canStartDirectMessage: true
      }
    ])
    render(
      <TestWorkspaceChat
        model={makeChatModel()}
        directMessages={{
          startConversation: starts,
          searchCandidates
        }}
      />
    )

    await user.click(await screen.findByRole("button", { name: "Start direct message" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByPlaceholderText("Search usernames"), "lee")
    const recipient = await within(dialog).findByRole("button", { name: "Lee Chen" })
    await user.click(recipient)
    await user.click(recipient)

    expect(starts).toHaveBeenCalledTimes(1)
    expect(starts).toHaveBeenCalledWith("user-2")
    resolveStart({ id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByRole("button", { name: "Start direct message" })).toHaveFocus()
  })

  it("shows direct-message candidate loading, empty search, and retryable failure states", async () => {
    const starts = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        id: "direct-1",
        otherUser: { id: "user-2", displayName: "Lee Chen" }
      })
    let resolveSearch!: (results: ReadonlyArray<ChatChannelMember>) => void
    const searchCandidates = vi.fn((query: string) =>
      query.toLowerCase() === "nobody"
        ? Promise.resolve([])
        : new Promise<ReadonlyArray<ChatChannelMember>>((resolve) => {
            resolveSearch = resolve
          })
    )
    render(
      <TestWorkspaceChat model={makeChatModel()} directMessages={{ startConversation: starts, searchCandidates }} />
    )

    await userEvent.setup().click(await screen.findByRole("button", { name: "Start direct message" }))
    const search = await screen.findByPlaceholderText("Search usernames")
    await replaceText(search, "Lee")
    expect(await screen.findByText("Loading accounts...")).toBeTruthy()
    act(() => resolveSearch([{ id: "user-2", displayName: "Lee Chen", username: "lee" }]))
    await replaceText(search, "nobody")
    expect(await screen.findByText("No accounts are available.")).toBeTruthy()
    await replaceText(search, "Lee")
    act(() => resolveSearch([{ id: "user-2", displayName: "Lee Chen", username: "lee" }]))
    await userEvent.setup().click(await screen.findByRole("button", { name: "Lee Chen" }))
    expect((await screen.findByRole("alert")).textContent).toContain("Check your connection and try again")
    await userEvent.setup().click(await screen.findByRole("button", { name: "Lee Chen" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(starts).toHaveBeenCalledTimes(2)
  })

  it("removes stale remote recipients immediately when the search query changes", async () => {
    let resolveLee!: (
      results: ReadonlyArray<{ id: string; displayName: string; username: string; canStartDirectMessage: boolean }>
    ) => void
    let resolveMaya!: (
      results: ReadonlyArray<{ id: string; displayName: string; username: string; canStartDirectMessage: boolean }>
    ) => void
    const searchCandidates = vi.fn(
      (query: string) =>
        new Promise<
          ReadonlyArray<{ id: string; displayName: string; username: string; canStartDirectMessage: boolean }>
        >((resolve) => {
          if (query === "lee") resolveLee = resolve
          if (query === "maya") resolveMaya = resolve
        })
    )

    render(
      <TestWorkspaceChat
        model={makeChatModel()}
        directMessages={{
          startConversation: () => Promise.reject(new Error("not used")),
          searchCandidates
        }}
      />
    )

    await userEvent.setup().click(await screen.findByRole("button", { name: "Start direct message" }))
    const search = await screen.findByPlaceholderText("Search usernames")
    await replaceText(search, "lee")
    expect(screen.getByText("Loading accounts...")).toBeTruthy()
    act(() => resolveLee([{ id: "user-2", displayName: "Lee Chen", username: "lee", canStartDirectMessage: true }]))
    expect(await screen.findByRole("button", { name: "Lee Chen" })).toBeTruthy()

    await replaceText(search, "maya")

    expect(screen.queryByRole("button", { name: "Lee Chen" })).toBeNull()
    expect(screen.getByText("Loading accounts...")).toBeTruthy()
    act(() => resolveMaya([{ id: "user-3", displayName: "Maya Singh", username: "maya", canStartDirectMessage: true }]))
    expect(await screen.findByRole("button", { name: "Maya Singh" })).toBeTruthy()
  })

  it("accepts an incoming reciprocal friend request and refreshes the recipient action", async () => {
    let accepted = false
    const searchCandidates = vi.fn(() =>
      Promise.resolve([
        accepted
          ? {
              id: "user-2",
              displayName: "Lee Chen",
              username: "lee",
              canStartDirectMessage: true,
              friendship: "accepted" as const,
              friendRequestDirection: null
            }
          : {
              id: "user-2",
              displayName: "Lee Chen",
              username: "lee",
              canStartDirectMessage: false,
              friendship: "pending" as const,
              friendRequestDirection: "incoming" as const
            }
      ])
    )
    const sendFriendRequest = vi.fn(() => {
      accepted = true
      return Promise.resolve({ status: "accepted" })
    })

    render(
      <TestWorkspaceChat
        model={makeChatModel()}
        directMessages={{
          startConversation: () => Promise.reject(new Error("not used")),
          searchCandidates,
          sendFriendRequest
        }}
      />
    )

    await userEvent.setup().click(await screen.findByRole("button", { name: "Start direct message" }))
    await replaceText(await screen.findByPlaceholderText("Search usernames"), "lee")
    await userEvent.setup().click(await screen.findByRole("button", { name: "Accept friend request from Lee Chen" }))

    await waitFor(() => expect(sendFriendRequest).toHaveBeenCalledWith("user-2"))
    expect(await screen.findByRole("button", { name: "Lee Chen" })).toBeTruthy()
    expect(searchCandidates).toHaveBeenCalled()
  })

  it("keeps direct messages in the global rail while changing channels", async () => {
    const base = makeChatModel()
    const directConversations = [{ id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }]
    const secondChannel = makeChannel({
      id: secondChannelId,
      name: "design",
      visibility: "public"
    })
    const props = {}
    const { rerender } = render(
      <TestWorkspaceChat
        {...props}
        model={withDirectConversations({ ...base, channels: [base.channel, secondChannel] }, directConversations)}
      />
    )

    const globalNavigation = await screen.findByLabelText("Global navigation")
    const directMessages = within(globalNavigation).getByRole("navigation", { name: "Direct messages" })
    expect(await within(directMessages).findByRole("button", { name: "Lee Chen" })).toBeTruthy()

    rerender(
      <TestWorkspaceChat
        {...props}
        model={{
          ...withDirectConversations(base, directConversations),
          channel: secondChannel,
          channels: [base.channel, secondChannel],
          conversation: {
            ...base.conversation,
            messages: { status: "loading" },
            members: { status: "loading" }
          }
        }}
      />
    )

    const directMessageButton = within(directMessages).getByRole("button", { name: "Lee Chen" })
    expect(directMessageButton).toBeTruthy()
    expect(directMessageButton.hasAttribute("data-base-ui-tooltip-trigger")).toBe(true)
    expect(screen.getByLabelText("Channel members").querySelector("[aria-busy='true']")).toBeTruthy()
    expect(document.querySelector(".chatTimeline [class*='skeletonPulse']")).toBeTruthy()
    expect(document.querySelector("[class*='skeletonPulse']")).toBeTruthy()
  })

  it("returns to the workspace from a direct conversation without marking both active", async () => {
    const directConversation = { id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }
    const selectChannel = vi.fn()
    render(
      <TestWorkspaceChat
        model={withDirectConversations(
          { ...makeChatModel(), activeConversation: { kind: "direct", directConversation } },
          [directConversation]
        )}
        navigation={{ selectChannel }}
      />
    )
    expect(screen.queryByRole("complementary", { name: "Workspace navigation" })).toBeNull()
    expect(screen.queryByRole("navigation", { name: "Channels" })).toBeNull()
    const workspaceButton = screen.getByRole("button", { name: "Aether Labs" })
    const directMessageButton = screen.getByRole("button", { name: "Lee Chen" })
    expect(workspaceButton.getAttribute("aria-current")).toBeNull()
    expect(workspaceButton.classList.contains("active")).toBe(false)
    expect(directMessageButton.getAttribute("aria-current")).toBe("page")

    await userEvent.setup().click(workspaceButton)

    expect(selectChannel).toHaveBeenCalledOnce()
    expect(selectChannel).toHaveBeenCalledWith(channelId)
  })

  it("renders and switches channels from the model channel list", async () => {
    const base = makeChatModel()
    const secondChannel = makeChannel({
      id: secondChannelId,
      name: "design",
      visibility: "public"
    })
    const selections: Array<string> = []

    render(
      <TestWorkspaceChat
        model={{ ...base, channels: [base.channel, secondChannel] }}
        navigation={{ selectChannel: (id) => selections.push(id) }}
      />
    )

    const channels = await screen.findByRole("navigation", { name: "Channels" })
    const originationChannel = within(channels).getByRole("button", { name: "origination" })
    const designChannel = within(channels).getByRole("button", { name: "design" })
    expect(originationChannel.getAttribute("aria-current")).toBe("page")
    expect(originationChannel.className).toContain("bg-surface-rail")
    expect(designChannel.getAttribute("aria-current")).toBeNull()

    await userEvent.setup().click(designChannel)

    expect(selections).toEqual([secondChannelId])
  })

  it("uses icon-only channel visibility cues outside the channel header", async () => {
    const { container } = render(<TestWorkspaceChat model={makeChatModel()} />)

    const channels = await screen.findByRole("navigation", { name: "Channels" })

    expect(within(channels).queryByText("private channel")).toBeNull()
    expect(container.querySelector(".chatHeader")?.textContent).not.toContain("private channel")
  })

  it("creates a channel from the add channel dialog", async () => {
    const calls: Array<{ readonly name: string; readonly visibility?: "public" | "private" }> = []

    render(
      <TestWorkspaceChat
        model={makeChatModel()}
        channels={{
          create: (input) => {
            calls.push(input)
            return Promise.resolve(
              makeChannel({
                id: secondChannelId,
                name: input.name,
                visibility: input.visibility ?? "public"
              })
            )
          }
        }}
      />
    )

    await userEvent.setup().click(await screen.findByRole("button", { name: "Add channel" }))
    expect(await screen.findByRole("dialog", { name: "Create Channel" })).toBeTruthy()
    const form = await screen.findByRole("form", { name: "Create channel" })
    expect(within(form).getByRole("status").className).toContain("min-h-[17px]")
    await replaceText(within(form).getByLabelText("Channel name"), "  #Product Team  ")
    await userEvent.setup().click(within(form).getByRole("button", { name: "Create" }))

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
      <TestWorkspaceChat
        model={withChannelInviteCandidates(makeChatModel(), inviteCandidates)}
        channels={{
          create: (input) => {
            calls.push(input)
            return Promise.resolve(makeChannel({ id: secondChannelId, name: input.name, visibility: "private" }))
          }
        }}
      />
    )

    await userEvent.setup().click(await screen.findByRole("button", { name: "Add channel" }))
    const form = await screen.findByRole("form", { name: "Create channel" })
    await userEvent.setup().click(within(form).getByRole("radio", { name: /private/i }))

    const memberSearch = within(form).getByLabelText("Invite members")
    await replaceText(memberSearch, "lee")
    expect(within(form).getByRole("checkbox", { name: "Lee Chen" })).toBeTruthy()
    expect(within(form).queryByRole("checkbox", { name: "Priya Shah" })).toBeNull()
    await userEvent.setup().click(within(form).getByRole("checkbox", { name: "Lee Chen" }))

    await replaceText(memberSearch, "")
    const priya = within(form).getByRole("checkbox", { name: "Priya Shah" })
    priya.focus()
    await userEvent.setup().keyboard(" ")
    expect(within(form).getByText("2 of 3 selected")).toBeTruthy()

    await replaceText(within(form).getByLabelText("Channel name"), "Leadership")
    await userEvent.setup().click(within(form).getByRole("button", { name: "Create" }))

    await waitFor(() =>
      expect(calls).toEqual([
        {
          name: "leadership",
          visibility: "private",
          initialMemberIds: ["human-2", "human-3"]
        }
      ])
    )
    expect(screen.queryByRole("dialog", { name: "Create Channel" })).toBeNull()

    await userEvent.setup().click(screen.getByRole("button", { name: "Add channel" }))
    const nextForm = await screen.findByRole("form", { name: "Create channel" })
    expect(
      within(nextForm)
        .getByRole("radio", { name: /public/i })
        .getAttribute("aria-checked")
    ).toBe("true")
    expect(within(nextForm).queryByLabelText("Initial invitations")).toBeNull()
  })

  it("keeps private invitation loading and empty states compact", async () => {
    const props = { channels: { create: () => Promise.reject(new Error("not submitted")) } }
    const { rerender } = render(<TestWorkspaceChat {...props} model={makeChatModel()} />)

    await userEvent.setup().click(await screen.findByRole("button", { name: "Add channel" }))
    let form = await screen.findByRole("form", { name: "Create channel" })
    await userEvent.setup().click(within(form).getByRole("radio", { name: /private/i }))
    expect(within(form).getByText("Loading members...")).toBeTruthy()
    await replaceText(within(form).getByLabelText("Channel name"), "ops")
    expect(within(form).getByRole("button", { name: "Create" })).toBeDisabled()

    rerender(<TestWorkspaceChat {...props} model={withChannelInviteCandidates(makeChatModel(), [])} />)
    form = await screen.findByRole("form", { name: "Create channel" })
    expect(within(form).getByText(/No other eligible members yet/)).toBeTruthy()
    expect(within(form).getByRole("button", { name: "Create" })).not.toBeDisabled()
  })

  it("keeps the channel creation dialog state scoped to an open attempt", async () => {
    render(
      <TestWorkspaceChat
        model={makeChatModel()}
        channels={{
          create: () =>
            Promise.resolve(
              makeChannel({
                id: secondChannelId,
                name: "product",
                visibility: "public"
              })
            )
        }}
      />
    )

    await userEvent.setup().click(await screen.findByRole("button", { name: "Add channel" }))
    const form = await screen.findByRole("form", { name: "Create channel" })
    const channelName = within(form).getByLabelText("Channel name")
    const createButton = within(form).getByRole("button", { name: "Create" })
    expect(createButton).toBeDisabled()

    await replaceText(channelName, "   ")
    expect(createButton).toBeDisabled()

    await replaceText(channelName, "ops")
    expect(createButton).not.toBeDisabled()
    await userEvent.setup().click(within(form).getByRole("button", { name: "Cancel" }))

    expect(screen.queryByRole("dialog", { name: "Create Channel" })).toBeNull()

    await userEvent.setup().click(screen.getByRole("button", { name: "Add channel" }))
    const nextForm = await screen.findByRole("form", { name: "Create channel" })
    expect(within(nextForm).getByLabelText("Channel name")).toHaveValue("")
    expect(within(nextForm).queryByRole("switch", { name: "Private channel" })).toBeNull()
    expect(within(nextForm).getByRole("button", { name: "Create" })).toBeDisabled()
  })

  it("shows channel creation backend errors without collapsing reserved error space", async () => {
    render(
      <TestWorkspaceChat
        model={withChannelInviteCandidates(makeChatModel(), [{ id: "human-2", displayName: "Lee Chen" }])}
        channels={{ create: () => Promise.reject(new Error("raw backend details")) }}
      />
    )

    await userEvent.setup().click(await screen.findByRole("button", { name: "Add channel" }))
    const form = await screen.findByRole("form", { name: "Create channel" })
    const status = within(form).getByRole("status")
    expect(status.className).toContain("min-h-[17px]")
    expect(status.className).toContain("invisible")

    await userEvent.setup().click(within(form).getByRole("radio", { name: /private/i }))
    await userEvent.setup().click(within(form).getByRole("checkbox", { name: "Lee Chen" }))
    const channelName = within(form).getByLabelText("Channel name")
    await replaceText(channelName, "ops")
    await userEvent.setup().click(within(form).getByRole("button", { name: "Create" }))

    expect(await within(form).findByText("Could not create channel. Check your connection and try again.")).toBeTruthy()
    expect(status.className).not.toContain("invisible")
    expect(screen.queryByText(/raw backend details/)).toBeNull()
    expect(channelName).toHaveValue("ops")
    expect(within(form).getByRole("checkbox", { name: "Lee Chen" }).getAttribute("aria-checked")).toBe("true")
  })

  it("rejects empty and invalid channel names before creating", async () => {
    const calls: Array<{ readonly name: string }> = []

    render(
      <TestWorkspaceChat
        model={makeChatModel()}
        channels={{
          create: (input) => {
            calls.push(input)
            return Promise.resolve(
              makeChannel({
                id: secondChannelId,
                name: input.name,
                visibility: "public"
              })
            )
          }
        }}
      />
    )

    await userEvent.setup().click(await screen.findByRole("button", { name: "Add channel" }))
    const form = await screen.findByRole("form", { name: "Create channel" })
    const input = within(form).getByLabelText("Channel name")

    await replaceText(input, "###")
    fireEvent.submit(form)
    expect(await within(form).findByText("Channel name is required.")).toBeTruthy()

    await replaceText(input, "design!")
    fireEvent.submit(form)
    expect(await within(form).findByText("Use letters, numbers, dashes, or underscores.")).toBeTruthy()
    expect(calls).toEqual([])
  })

  it("shows compact duplicate channel errors and keeps the dialog usable", async () => {
    const calls: Array<{ readonly name: string }> = []

    render(
      <TestWorkspaceChat
        model={makeChatModel()}
        channels={{
          create: (input) => {
            calls.push(input)
            return Promise.reject(new Error("Channel already exists"))
          }
        }}
      />
    )

    await userEvent.setup().click(await screen.findByRole("button", { name: "Add channel" }))
    const form = await screen.findByRole("form", { name: "Create channel" })
    const input = within(form).getByLabelText("Channel name")
    await replaceText(input, "design")
    await userEvent.setup().click(within(form).getByRole("button", { name: "Create" }))

    expect(await within(form).findByText("Channel already exists.")).toBeTruthy()
    expect(within(form).getByRole("button", { name: "Create" })).toBeTruthy()

    await replaceText(input, "product")
    expect(within(form).queryByText("Channel already exists.")).toBeNull()
    expect(calls).toEqual([{ name: "design", visibility: "public" }])
  })

  it("opens profile settings from the rail avatar", async () => {
    let signOuts = 0
    const { container } = render(
      <TestWorkspaceChat
        model={makeChatModel()}
        profileMenuActions={[{ label: "Sign out", onSelect: () => signOuts++ }]}
      />
    )

    const profileRail = container.querySelector(".railProfile")
    expect(profileRail).toBeTruthy()
    expect(profileRail?.textContent).toBe("MP")
    expect(profileRail?.childElementCount).toBe(0)
    await userEvent.setup().click(profileRail!)

    const menu = await screen.findByRole("menu", { name: "Profile settings" })
    const actions = menu.querySelector(".profileMenuActions")
    expect(actions).toBeTruthy()
    expect(within(menu).getByText("Maya Patel")).toBeTruthy()
    expect(menu.className).toContain("max-h-[calc(100dvh-24px)]")
    expect(actions?.className).toContain("overflow-y-auto")
    await userEvent.setup().click(within(menu).getByRole("menuitem", { name: "Sign out" }))

    expect(signOuts).toBe(1)
    expect(screen.queryByRole("menu", { name: "Profile settings" })).toBeNull()
  })

  it("uses a dot instead of a count for inactive channel unread state", async () => {
    const base = makeChatModel()
    const secondChannel = makeChannel({
      id: secondChannelId,
      name: "design",
      visibility: "public"
    })

    render(
      <TestWorkspaceChat
        model={withIndicators({ ...base, channels: [base.channel, secondChannel] }, [
          { channelId: secondChannelId, indicator: "unread" }
        ])}
      />
    )

    const channels = await screen.findByRole("navigation", { name: "Channels" })

    const indicator = within(channels).getByLabelText(
      "Unread messages in #design since you last opened it. No native push is sent."
    )
    expect(indicator).toBeTruthy()
    expect(indicator.getAttribute("title")).toBe(
      "Unread messages in #design since you last opened it. No native push is sent."
    )
    expect(within(channels).queryByText("2")).toBeNull()
  })

  it("prioritizes mention state over unread state in inactive channel indicators", async () => {
    const base = makeChatModel()
    const secondChannel = makeChannel({
      id: secondChannelId,
      name: "design",
      visibility: "public"
    })

    render(
      <TestWorkspaceChat
        model={withIndicators({ ...base, channels: [base.channel, secondChannel] }, [
          { channelId: secondChannelId, indicator: "mentioned" }
        ])}
      />
    )

    const channels = await screen.findByRole("navigation", { name: "Channels" })

    const indicator = within(channels).getByLabelText(
      "Mention in #design since you last opened it. No native push is sent."
    )
    expect(indicator).toBeTruthy()
    expect(indicator.getAttribute("title")).toBe("Mention in #design since you last opened it. No native push is sent.")
    expect(
      within(channels).queryByLabelText("Unread messages in #design since you last opened it. No native push is sent.")
    ).toBeNull()
  })

  it("does not show stale unread state on the current channel", async () => {
    const base = makeChatModel()

    render(<TestWorkspaceChat model={withIndicators(base, [{ channelId, indicator: "mentioned" }])} />)

    const channels = await screen.findByRole("navigation", { name: "Channels" })

    expect(
      within(channels).queryByLabelText("Mention in #origination since you last opened it. No native push is sent.")
    ).toBeNull()
    expect(
      within(channels).queryByLabelText(
        "Unread messages in #origination since you last opened it. No native push is sent."
      )
    ).toBeNull()
  })

  it("opens and closes message search from the header toggle and keyboard shortcut", async () => {
    renderWorkspaceChat(makeChatModel())

    const showSearchButton = await screen.findByRole("button", { name: "Show search" })
    expect(showSearchButton.getAttribute("aria-pressed")).toBe("false")
    expect(document.querySelector(".channelMessageSearch")?.className).toContain("hidden")

    await userEvent.setup().click(showSearchButton)

    const searchInput = await screen.findByPlaceholderText("Search origination")
    expect(document.querySelector(".channelMessageSearch")?.className).not.toContain("hidden")
    expect(searchInput).toBe(document.activeElement)
    expect(screen.getByRole("button", { name: "Hide search" }).getAttribute("aria-pressed")).toBe("true")

    await userEvent.setup().keyboard("{Escape}")
    expect(document.querySelector(".channelMessageSearch")?.className).toContain("hidden")
    expect(screen.getByRole("button", { name: "Show search" }).getAttribute("aria-pressed")).toBe("false")

    await userEvent.setup().keyboard("{Meta>}f{/Meta}")
    const reopenedSearchInput = await screen.findByPlaceholderText("Search origination")
    expect(document.querySelector(".channelMessageSearch")?.className).not.toContain("hidden")
    expect(reopenedSearchInput).toBe(document.activeElement)

    screen.getByRole("button", { name: "Hide search" }).focus()
    await userEvent.setup().keyboard("{Meta>}f{/Meta}")
    expect(reopenedSearchInput).toBe(document.activeElement)
    expect(document.querySelector(".channelMessageSearch")?.className).not.toContain("hidden")

    await userEvent.setup().keyboard("{Meta>}f{/Meta}")
    expect(document.querySelector(".channelMessageSearch")?.className).toContain("hidden")
  })
})
