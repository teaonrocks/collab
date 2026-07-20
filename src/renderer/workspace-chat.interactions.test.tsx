// @vitest-environment happy-dom
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import {
  channelId,
  makeChannel,
  makeChatModel,
  makeMessage,
  makeMessageCapabilities,
  messageId,
  messagesOf,
  openMessageMenu,
  renderWorkspaceChat,
  replaceText,
  TestWorkspaceChat,
  userId
} from "./workspace-chat/test-support"

afterEach(cleanup)

describe("WorkspaceChat", () => {
  it("places multi-select checkboxes before the avatar column", async () => {
    renderWorkspaceChat(
      makeChatModel([
        ...messagesOf(makeChatModel()),
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
    )

    await userEvent.setup().click(within(await openMessageMenu("Maya Patel")).getByRole("menuitem", { name: "Select" }))

    const mayaCheckbox = await screen.findByRole("checkbox", { name: "Deselect message from Maya Patel" })
    const mayaRow = mayaCheckbox.closest(".channelMessage")
    expect(mayaRow).not.toBeNull()
    if (!(mayaRow instanceof HTMLElement)) throw new Error("Expected a message row")
    const mayaAvatar = within(mayaRow).getByText("MP")
    expect(mayaCheckbox.compareDocumentPosition(mayaAvatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole("checkbox", { name: "Select message from Lee Chen" })).toBeTruthy()

    await userEvent.setup().click(screen.getByText(/partner brief/))

    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Deselect message from Maya Patel" })).toBeNull())
  })

  it("aligns compact message checkboxes with the message body", async () => {
    renderWorkspaceChat(
      makeChatModel([
        ...messagesOf(makeChatModel()),
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
      ])
    )

    await userEvent.setup().click((await screen.findAllByLabelText("More actions for message from Maya Patel"))[0]!)
    await userEvent.setup().click(
      within(await screen.findByRole("menu", { name: /message from Maya Patel/ })).getByRole("menuitem", {
        name: "Select"
      })
    )

    const compactRow = (await screen.findByText("Follow-up without a repeated avatar.")).closest(".channelMessage")
    expect(compactRow).not.toBeNull()
    if (!(compactRow instanceof HTMLElement)) throw new Error("Expected a compact message row")
    expect(compactRow.classList.contains("compact")).toBe(true)
    within(compactRow).getByRole("checkbox", { name: "Select message from Maya Patel" })
    expect(compactRow.querySelector(".messageCheckbox")?.classList.contains("mt-[5px]")).toBe(true)
  })

  it("pins the selection action bar to the top-most selected message", async () => {
    renderWorkspaceChat(
      makeChatModel([
        ...messagesOf(makeChatModel()),
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
      ])
    )

    await userEvent.setup().click(within(await openMessageMenu("Rina Shah")).getByRole("menuitem", { name: "Select" }))
    expect(screen.getByLabelText("More actions for message from Rina Shah")).toBeTruthy()

    await userEvent.setup().click(await screen.findByRole("checkbox", { name: "Select message from Lee Chen" }))

    expect(await screen.findByLabelText("More actions for message from Lee Chen")).toBeInTheDocument()
    expect(screen.queryByLabelText("More actions for message from Rina Shah")).toBeNull()
    expect(screen.queryByLabelText("More actions for message from Maya Patel")).toBeNull()
  })

  it("opens a right-click message menu for selection", async () => {
    renderWorkspaceChat(makeChatModel())

    fireEvent.contextMenu(await screen.findByText(/partner brief/), { clientX: 20, clientY: 30 })

    const menu = await screen.findByRole("menu", { name: /message from Maya Patel/ })
    await userEvent.setup().click(within(menu).getByRole("menuitem", { name: "Select" }))

    expect((await screen.findAllByLabelText("Deselect message from Maya Patel")).length).toBeGreaterThan(0)
  })

  it("shows reaction buttons beside the icon More button in the inline message actions", async () => {
    const { container } = render(
      <TestWorkspaceChat
        model={makeChatModel()}
        messages={makeMessageCapabilities({ toggleReaction: () => Promise.resolve() })}
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
      <TestWorkspaceChat
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
            reactions: [{ emoji: "👍", count: 2, reactedByCurrentUser: true }]
          })
        ])}
        messages={makeMessageCapabilities({
          toggleReaction: (input) => {
            calls.push({ messageId: input.messageId, emoji: input.emoji })
            return Promise.resolve()
          }
        })}
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

    await userEvent.setup().click(reaction)

    expect(
      within(screen.getByLabelText("Reactions for message from Maya Patel")).getByRole("button", {
        name: "Add 👍 reaction to message from Maya Patel"
      }).textContent
    ).toContain("1")
    await waitFor(() => expect(calls).toEqual([{ messageId, emoji: "👍" }]))
  })

  it("rolls back an optimistic reaction and shows an error when the mutation fails", async () => {
    render(
      <TestWorkspaceChat
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
            reactions: [{ emoji: "👍", count: 2, reactedByCurrentUser: true }]
          })
        ])}
        messages={makeMessageCapabilities({ toggleReaction: () => Promise.reject(new Error("offline")) })}
      />
    )

    fireEvent.click(await screen.findByRole("button", { name: "Remove 👍 reaction to message from Maya Patel" }))

    expect(
      within(screen.getByLabelText("Reactions for message from Maya Patel")).getByRole("button", {
        name: "Add 👍 reaction to message from Maya Patel"
      }).textContent
    ).toContain("1")
    expect(await screen.findByText("Could not update reaction.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Remove 👍 reaction to message from Maya Patel" }).textContent).toContain(
      "2"
    )
  })

  it("waits for delete confirmation before deleting a message", async () => {
    const calls = renderWorkspaceChat(makeChatModel())

    await userEvent.setup().click(await screen.findByLabelText("More actions for message from Maya Patel"))
    const menu = await screen.findByRole("menu", { name: /message from Maya Patel/ })
    await userEvent.setup().click(within(menu).getByRole("menuitem", { name: "Delete message" }))

    const dialog = await screen.findByRole("dialog", { name: "Delete Message?" })
    expect(within(dialog).getByText(/Delete this message from Maya Patel/)).toBeTruthy()
    expect(calls).not.toContainEqual({ method: "deleteChannelMessage", args: messageId })

    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(calls).toContainEqual({ method: "deleteChannelMessage", args: messageId }))
  })

  it("cancels a pending message delete", async () => {
    const calls = renderWorkspaceChat(makeChatModel())

    await userEvent.setup().click(await screen.findByLabelText("More actions for message from Maya Patel"))
    const menu = await screen.findByRole("menu", { name: /message from Maya Patel/ })
    await userEvent.setup().click(within(menu).getByRole("menuitem", { name: "Delete message" }))

    const dialog = await screen.findByRole("dialog", { name: "Delete Message?" })
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Cancel" }))

    expect(screen.queryByRole("dialog", { name: "Delete Message?" })).toBeNull()
    expect(calls).not.toContainEqual({ method: "deleteChannelMessage", args: messageId })
  })

  it("shows edit and delete actions only for messages allowed by per-message guards", async () => {
    const calls: Array<{ method: string; args: unknown }> = []
    const model = makeChatModel([
      ...messagesOf(makeChatModel()),
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
      <TestWorkspaceChat
        model={model}
        messages={makeMessageCapabilities({
          edit: (input) => {
            calls.push({ method: "editChannelMessage", args: input })
            return Promise.resolve()
          },
          delete: (input) => {
            calls.push({ method: "deleteChannelMessage", args: input.messageId })
            return Promise.resolve()
          },
          canEdit: (message) => message.authorId === model.currentUser.id,
          canDelete: (message) => message.authorId === model.currentUser.id
        })}
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
      <TestWorkspaceChat
        model={makeChatModel()}
        messages={makeMessageCapabilities({
          edit: (input) => {
            calls.push({ method: "editChannelMessage", args: input })
            return Promise.resolve()
          }
        })}
      />
    )

    await userEvent
      .setup()
      .click(within(await openMessageMenu("Maya Patel")).getByRole("menuitem", { name: "Edit message" }))
    const editor = await screen.findByLabelText("Edit message text from Maya Patel")
    await replaceText(editor, "The partner brief is ready for review.")
    await userEvent.setup().keyboard("{Enter}")

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
      <TestWorkspaceChat
        model={makeChatModel()}
        messages={makeMessageCapabilities({
          edit: () => Promise.reject(new Error("raw mutation stack")),
          errorMessage: () => "Could not save edit. Check your connection and try again."
        })}
      />
    )

    await userEvent
      .setup()
      .click(within(await openMessageMenu("Maya Patel")).getByRole("menuitem", { name: "Edit message" }))
    const editor = await screen.findByLabelText("Edit message text from Maya Patel")
    await replaceText(editor, "The partner brief is ready for review.")
    await userEvent.setup().keyboard("{Enter}")

    expect((await screen.findByRole("status")).textContent).toBe(
      "Could not save edit. Check your connection and try again."
    )
    expect(screen.getByLabelText("Edit message text from Maya Patel")).toBeTruthy()
    expect(screen.queryByText(/raw mutation stack/)).toBeNull()
  })

  it("cancels an inline message edit with Escape", async () => {
    const calls: Array<{ method: string; args: unknown }> = []

    render(
      <TestWorkspaceChat
        model={makeChatModel()}
        messages={makeMessageCapabilities({
          edit: (input) => {
            calls.push({ method: "editChannelMessage", args: input })
            return Promise.resolve()
          }
        })}
      />
    )

    await userEvent
      .setup()
      .click(within(await openMessageMenu("Maya Patel")).getByRole("menuitem", { name: "Edit message" }))
    const editor = await screen.findByLabelText("Edit message text from Maya Patel")
    await replaceText(editor, "Draft that should be discarded.")
    await userEvent.setup().keyboard("{Escape}")

    expect(screen.queryByLabelText("Edit message text from Maya Patel")).toBeNull()
    expect(await screen.findByText("The partner brief needs a concise risk summary.")).toBeTruthy()
    expect(screen.queryByText("Draft that should be discarded.")).toBeNull()
    expect(calls).toEqual([])
  })

  it("shows a compact delete failure and keeps the confirmation open", async () => {
    render(
      <TestWorkspaceChat
        model={makeChatModel()}
        messages={makeMessageCapabilities({
          delete: () => Promise.reject(new Error("raw delete failure")),
          errorMessage: () => "Could not delete message. Check your connection and try again."
        })}
      />
    )

    await userEvent.setup().click(await screen.findByLabelText("More actions for message from Maya Patel"))
    const menu = await screen.findByRole("menu", { name: /message from Maya Patel/ })
    await userEvent.setup().click(within(menu).getByRole("menuitem", { name: "Delete message" }))
    const dialog = await screen.findByRole("dialog", { name: "Delete Message?" })
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Delete" }))

    expect((await screen.findByRole("status")).textContent).toBe(
      "Could not delete message. Check your connection and try again."
    )
    expect(screen.getByRole("dialog", { name: "Delete Message?" })).toBeTruthy()
    expect(screen.queryByText(/raw delete failure/)).toBeNull()
  })

  it("keeps Shift+Enter in an inline message edit without saving", async () => {
    const calls: Array<{ method: string; args: unknown }> = []

    render(
      <TestWorkspaceChat
        model={makeChatModel()}
        messages={makeMessageCapabilities({
          edit: (input) => {
            calls.push({ method: "editChannelMessage", args: input })
            return Promise.resolve()
          }
        })}
      />
    )

    await userEvent
      .setup()
      .click(within(await openMessageMenu("Maya Patel")).getByRole("menuitem", { name: "Edit message" }))
    const editor = await screen.findByLabelText("Edit message text from Maya Patel")
    await replaceText(editor, "Line one")
    const enterEvent = createEvent.keyDown(editor, { key: "Enter", code: "Enter", shiftKey: true })
    fireEvent(editor, enterEvent)
    await replaceText(editor, "Line one\nLine two")

    expect(enterEvent.defaultPrevented).toBe(false)
    expect((editor as HTMLTextAreaElement).value).toBe("Line one\nLine two")
    expect(calls).toEqual([])
  })

  it("collapses and reopens the channel members panel", async () => {
    renderWorkspaceChat(makeChatModel())

    const hideMembersButton = await screen.findByRole("button", { name: "Hide members" })
    expect(hideMembersButton.getAttribute("aria-pressed")).toBe("true")
    await userEvent.setup().click(hideMembersButton)

    const showMembersButton = screen.getByRole("button", { name: "Show members" })
    expect(showMembersButton.getAttribute("aria-pressed")).toBe("false")
    await userEvent.setup().click(showMembersButton)

    expect(screen.getByRole("button", { name: "Hide members" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("offers edit, delete, and manage from a channel right-click menu", async () => {
    const edits: unknown[] = []
    const deletions: unknown[] = []
    const selections: string[] = []
    render(
      <TestWorkspaceChat
        model={makeChatModel()}
        navigation={{ selectChannel: (id) => selections.push(id) }}
        channels={{
          edit: (input) => {
            edits.push(input)
            return Promise.resolve(makeChannel({ id: input.channelId, name: input.name, visibility: "private" }))
          },
          delete: (input) => {
            deletions.push(input)
            return Promise.resolve()
          }
        }}
      />
    )

    const channelButton = within(screen.getByLabelText("Channels")).getByRole("button", { name: /origination/ })
    fireEvent.contextMenu(channelButton, { clientX: 24, clientY: 40 })
    let menu = await screen.findByRole("menu", { name: "Context menu for #origination" })
    expect(within(menu).getByRole("menuitem", { name: "Manage" })).toBeTruthy()
    await userEvent.setup().click(within(menu).getByRole("menuitem", { name: "Edit" }))

    const editDialog = await screen.findByRole("dialog", { name: "Edit channel" })
    await replaceText(within(editDialog).getByLabelText("Channel name"), "Product Team")
    await userEvent.setup().click(within(editDialog).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(edits).toEqual([{ channelId, name: "product-team" }]))

    fireEvent.contextMenu(channelButton, { clientX: 24, clientY: 40 })
    menu = await screen.findByRole("menu", { name: "Context menu for #origination" })
    await userEvent.setup().click(within(menu).getByRole("menuitem", { name: "Delete" }))
    const deleteDialog = await screen.findByRole("dialog", { name: "Delete #origination?" })
    await userEvent.setup().click(within(deleteDialog).getByRole("button", { name: "Delete channel" }))
    await waitFor(() => expect(deletions).toEqual([{ channelId }]))

    fireEvent.contextMenu(channelButton, { clientX: 24, clientY: 40 })
    menu = await screen.findByRole("menu", { name: "Context menu for #origination" })
    await userEvent.setup().click(within(menu).getByRole("menuitem", { name: "Manage" }))
    expect(selections).toContain(channelId)
    expect(screen.getByRole("button", { name: "Hide members" })).toBeTruthy()
  })
})
