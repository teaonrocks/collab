// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ChatMessage } from "./chat-data"
import {
  channelId,
  makeChatModel,
  makeMessage,
  openMessageSearch,
  replaceText,
  TestWorkspaceChat,
  userId,
  withDirectConversations,
  withMessages
} from "./workspace-chat/test-support"

afterEach(cleanup)

describe("WorkspaceChat", () => {
  it("searches current channel messages and highlights a selected result", async () => {
    render(
      <TestWorkspaceChat
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
      />
    )

    const search = await openMessageSearch()
    await replaceText(search, "risk")

    const results = await screen.findByRole("region", { name: "Message search results" })
    expect(within(results).getByText("Lee Chen")).toBeTruthy()
    expect(within(results).getByText("Risk summary needs one more pass.")).toBeTruthy()
    expect(within(results).getByText("#origination")).toBeTruthy()
    expect(within(results).queryByText("Mina Rao")).toBeNull()

    const resultOption = within(results).getByRole("option", { name: /Risk summary needs one more pass/ })
    expect(resultOption.hasAttribute("data-active")).toBe(true)
    await userEvent.setup().click(resultOption)

    await waitFor(() => {
      const message = screen
        .getAllByText("Risk summary needs one more pass.")
        .find((element) => element.closest(".chatTimeline") !== null)
      const article = message!.closest(".channelMessage")
      expect(article?.className).toContain("searchHighlighted")
      expect(article).toBe(document.activeElement)
    })

    expect(resultOption.hasAttribute("data-message-highlighted")).toBe(true)
    await userEvent.setup().click(resultOption)

    await waitFor(() => {
      const message = screen
        .getAllByText("Risk summary needs one more pass.")
        .find((element) => element.closest(".chatTimeline") !== null)
      expect(message!.closest(".channelMessage")?.className).not.toContain("searchHighlighted")
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
      <TestWorkspaceChat
        model={{
          ...makeChatModel([currentMessage]),
          conversation: {
            ...makeChatModel([currentMessage]).conversation,
            messages: { status: "ready", data: [currentMessage], hasMore: true, loadingMore: false }
          }
        }}
        messages={{
          create: () => Promise.resolve(),
          delete: () => Promise.resolve(),
          search: searchChannelMessages,
          canDeleteMessages: true
        }}
      />
    )

    const search = await openMessageSearch()
    expect(search.getAttribute("aria-describedby")).toBeNull()
    await replaceText(search, "archive")
    const result = await screen.findByRole("option", { name: /Archive decision from last week/ })
    expect(searchChannelMessages).toHaveBeenCalledWith({ channelId, query: "archive" })

    await userEvent.setup().click(result)

    await waitFor(() => {
      const messages = screen.getAllByText("Archive decision from last week.")
      expect(messages).toHaveLength(2)
      const article = messages.find((message) => message.closest(".channelMessage"))?.closest(".channelMessage")
      expect(article?.className).toContain("searchHighlighted")
      expect(article).toBe(document.activeElement)
    })
  })

  it("ignores stale remote search results after the active conversation changes", async () => {
    let resolveSearch!: (messages: ReadonlyArray<ChatMessage>) => void
    const searchChannelMessages = vi.fn(
      () =>
        new Promise<ReadonlyArray<ChatMessage>>((resolve) => {
          resolveSearch = resolve
        })
    )
    const base = makeChatModel([])
    const directConversation = { id: "direct-1", otherUser: { id: "user-2", displayName: "Lee Chen" } }
    const props = {
      messages: {
        create: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        search: searchChannelMessages,
        canDeleteMessages: true
      }
    }
    const { rerender } = render(
      <TestWorkspaceChat {...props} model={withDirectConversations(base, [directConversation])} />
    )

    await userEvent.setup().click(await screen.findByRole("button", { name: "Show search" }))
    await replaceText(await screen.findByPlaceholderText("Search origination"), "archive")
    await waitFor(() => expect(searchChannelMessages).toHaveBeenCalledWith({ channelId, query: "archive" }))

    rerender(
      <TestWorkspaceChat
        {...props}
        model={withMessages(
          withDirectConversations({ ...base, activeConversation: { kind: "direct", directConversation } }, [
            directConversation
          ]),
          []
        )}
      />
    )
    resolveSearch([
      makeMessage({
        id: "stale-message",
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "Stale channel result",
        createdAt: 1
      })
    ])

    await waitFor(() => expect(screen.queryByText("Stale channel result")).toBeNull())
    expect(screen.getByPlaceholderText("Message Lee Chen")).toBeTruthy()
  })

  it("navigates message search results with the keyboard", async () => {
    const user = userEvent.setup()
    render(
      <TestWorkspaceChat
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
      />
    )

    const search = await openMessageSearch()
    fireEvent.change(search, { target: { value: "risk" } })

    const listbox = await screen.findByRole("listbox", { name: "Message search matches" })
    const options = within(listbox).getAllByRole("option")
    expect(options).toHaveLength(2)
    expect(options[0]!.hasAttribute("data-active")).toBe(true)
    expect(options[1]!.hasAttribute("data-active")).toBe(false)

    await user.keyboard("{ArrowDown}")
    expect(options[0]!.hasAttribute("data-active")).toBe(false)
    expect(options[1]!.hasAttribute("data-active")).toBe(true)

    await user.keyboard("{Enter}")

    const secondMessage = screen
      .getAllByText("Another risk review is scheduled.")
      .find((element) => element.closest(".chatTimeline") !== null)
    const secondArticle = secondMessage!.closest(".channelMessage")!
    if (!(secondArticle instanceof HTMLElement)) throw new Error("Expected a focusable message row")
    await waitFor(() => expect(secondArticle).toBe(document.activeElement))
    expect(secondArticle.className).toContain("searchHighlighted")
    expect(options[1]!.hasAttribute("data-message-highlighted")).toBe(true)

    await user.keyboard("{Enter}")

    const firstMessage = screen
      .getAllByText("Risk summary needs one more pass.")
      .find((element) => element.closest(".chatTimeline") !== null)
    const firstArticle = firstMessage!.closest(".channelMessage")!
    await waitFor(() => expect(firstArticle).toBe(document.activeElement))
    expect(firstArticle.className).toContain("searchHighlighted")
    expect(options[0]!.hasAttribute("data-message-highlighted")).toBe(true)
    expect(options[1]!.hasAttribute("data-message-highlighted")).toBe(false)
  })

  it("moves Escape from a selected message to the input, then closes search without clearing the query", async () => {
    const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    render(
      <TestWorkspaceChat
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
      />
    )

    const search = await openMessageSearch()
    await replaceText(search, "risk")

    const listbox = await screen.findByRole("listbox", { name: "Message search matches" })
    const options = within(listbox).getAllByRole("option")

    await act(async () => {
      fireEvent.keyDown(search, { key: "Enter", code: "Enter" })
      await Promise.resolve()
    })
    await waitFor(() => expect(options[0]!.hasAttribute("data-message-highlighted")).toBe(true))
    expect(search).not.toBe(document.activeElement)

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" })
    expect(search).toBe(document.activeElement)
    expect(options[0]!.hasAttribute("data-message-highlighted")).toBe(true)
    expect((search as HTMLInputElement).value).toBe("risk")

    search.focus()
    fireEvent.keyDown(search, { key: "Escape", code: "Escape" })
    expect(document.querySelector(".channelMessageSearch")?.className).toContain("hidden")
    expect((search as HTMLInputElement).value).toBe("risk")
    if (previousActEnvironment === undefined) {
      delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
    } else {
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    }
  })

  it("shows message search empty and error states", async () => {
    render(<TestWorkspaceChat model={makeChatModel()} />)

    const search = await openMessageSearch()
    await replaceText(search, "nonexistent")

    expect((await screen.findByRole("status")).textContent).toBe("No matching messages.")

    await replaceText(search, "x".repeat(121))

    expect((await screen.findByRole("alert")).textContent).toBe("Search is limited to 120 characters.")
  })
})
