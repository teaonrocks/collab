// @vitest-environment happy-dom
import { cleanup, act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ChatMessageAttachment } from "./chat-data"
import {
  channelId,
  makeChannel,
  makeChatModel,
  makeMessage,
  messageId,
  openMessageMenu,
  renderWorkspaceChat,
  replaceText,
  secondChannelId,
  TestWorkspaceChat,
  uploadFiles,
  userId,
  withMembers,
  withMessages
} from "./workspace-chat/test-support"

afterEach(cleanup)

describe("WorkspaceChat", () => {
  it("shows edited message time with a trailing marker in the timestamp", async () => {
    renderWorkspaceChat(
      makeChatModel([
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
      ])
    )

    expect(await screen.findByText("The partner brief is ready.")).toBeTruthy()
    const timestamp = document.querySelector(".chatTimeline .messageMeta .messageTimestamp")
    expect(timestamp?.getAttribute("dateTime")).toBe(new Date(4).toISOString())
    expect(timestamp?.textContent).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}\*$/)
    expect(timestamp?.textContent?.endsWith("*")).toBe(true)
    expect(document.querySelector(".chatTimeline .messageEdited")).toBeNull()
  })

  it("sends a channel message from the bottom composer with Enter", async () => {
    const calls = renderWorkspaceChat(makeChatModel())
    const input = await screen.findByPlaceholderText("Message origination")

    await replaceText(input, "I will tighten the partner brief.")
    await userEvent.setup().keyboard("{Enter}")

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

    await replaceText(input, "Button send keeps mouse users covered.")
    await userEvent.setup().click(screen.getByRole("button", { name: "Send message" }))

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
      name: "design",
      visibility: "public"
    })
    const props = {
      messages: {
        create: () => pendingSend,
        delete: () => Promise.resolve(),
        canDeleteMessages: true
      }
    }
    const base = makeChatModel([])
    const { rerender } = render(
      <TestWorkspaceChat {...props} model={{ ...base, channels: [base.channel, secondChannel] }} />
    )

    const firstInput = await screen.findByPlaceholderText("Message origination")
    await replaceText(firstInput, "Sent from origination.")
    await userEvent.setup().click(screen.getByRole("button", { name: "Send message" }))

    rerender(
      <TestWorkspaceChat
        {...props}
        model={withMessages(
          {
            ...base,
            channel: secondChannel,
            channels: [base.channel, secondChannel]
          },
          []
        )}
      />
    )
    const nextInput = await screen.findByPlaceholderText("Message design")
    await replaceText(nextInput, "Keep this design draft.")

    await act(async () => {
      completeSend()
      await pendingSend
    })

    await waitFor(() => expect((nextInput as HTMLTextAreaElement).value).toBe("Keep this design draft."))
  })

  it("sends a reply with the selected parent and can cancel reply mode without clearing the draft", async () => {
    const user = userEvent.setup()
    const calls = renderWorkspaceChat(makeChatModel())
    const menu = await openMessageMenu("Maya Patel")
    await user.click(within(menu).getByRole("menuitem", { name: "Reply" }))

    expect(await screen.findByText("Replying to Maya Patel")).toBeTruthy()
    expect(screen.getAllByText("The partner brief needs a concise risk summary.")).toHaveLength(2)

    const input = await screen.findByPlaceholderText("Message origination")
    await replaceText(input, "I can add that risk summary.")
    await user.click(screen.getByRole("button", { name: "Cancel" }))

    expect(screen.queryByText("Replying to Maya Patel")).toBeNull()
    expect((input as HTMLTextAreaElement).value).toBe("I can add that risk summary.")

    const nextMenu = await openMessageMenu("Maya Patel")
    await user.click(within(nextMenu).getByRole("menuitem", { name: "Reply" }))
    await user.click(input)
    await user.keyboard("{Enter}")

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
    renderWorkspaceChat(
      makeChatModel([
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
          parentMessage: {
            id: messageId,
            authorDisplayName: "Maya Patel",
            bodyPreview: "The partner brief needs a concise risk summary.",
            deleted: false
          }
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
      ])
    )

    const parentPreview = await screen.findByRole("button", { name: /Reply to Maya Patel/ })
    expect(parentPreview.className).toContain("h-auto")
    expect(parentPreview.className).toContain("inline-grid")
    expect(parentPreview.className).toContain("grid-cols-[2px_auto_minmax(0,1fr)]")
    expect(parentPreview.className).toContain("bg-transparent")
    expect(parentPreview.className).toContain("border-0")
    expect(parentPreview.className).toContain("font-normal")
    expect(parentPreview.children).toHaveLength(3)
    expect(parentPreview.firstElementChild?.className).toContain("bg-border-strong")
    expect(screen.getByText("I will draft it.")).toBeTruthy()
    expect(screen.getByText("Original unavailable")).toBeTruthy()
  })

  it("renders image thumbnails and file attachment links without trusting unsafe URLs", async () => {
    renderWorkspaceChat(
      makeChatModel([
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
            {
              id: "attachment-1",
              storageId: "storage-1",
              name: "brief.png",
              contentType: "image/png",
              size: 4096,
              kind: "image",
              url: "https://files.example/brief.png"
            },
            {
              id: "attachment-2",
              storageId: "storage-2",
              name: "notes.pdf",
              contentType: "application/pdf",
              size: 2048,
              kind: "file",
              url: "javascript:alert(1)"
            },
            {
              id: "attachment-3",
              storageId: "storage-3",
              name: "insecure.txt",
              contentType: "text/plain",
              size: 1024,
              kind: "file",
              url: "http://files.example/insecure.txt"
            }
          ]
        })
      ])
    )

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

    await replaceText(input, "First line")
    await userEvent.setup().keyboard("{Shift>}{Enter}{/Shift}")

    expect(calls.some((call) => call.method === "createChannelMessage")).toBe(false)
    expect((input as HTMLTextAreaElement).value).toBe("First line\n")
  })

  it("filters and inserts mention suggestions from the composer with the keyboard", async () => {
    const calls: Array<{ readonly channelId: string; readonly body: string }> = []
    render(
      <TestWorkspaceChat
        model={withMembers(makeChatModel([]), [
          { id: "human-2", displayName: "Lee Chen" },
          { id: "human-3", displayName: "Mina Rao" }
        ])}
        messages={{
          create: (input) => {
            calls.push(input)
            return Promise.resolve()
          },
          delete: () => Promise.resolve(),
          canDeleteMessages: true
        }}
      />
    )
    const input = await screen.findByPlaceholderText("Message origination")

    await replaceText(input, "Thanks @le")

    const suggestions = await screen.findByRole("listbox", { name: "Mention suggestions" })
    const composer = screen.getByRole("form", { name: "Channel message composer" })
    expect(composer.contains(suggestions)).toBe(false)
    expect(within(suggestions).getByRole("option", { name: "Lee Chen" })).toBeTruthy()
    expect(within(suggestions).queryByRole("option", { name: "Mina Rao" })).toBeNull()

    await userEvent.setup().keyboard("{Enter}")

    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe("Thanks @Lee Chen "))
    expect(screen.queryByRole("listbox", { name: "Mention suggestions" })).toBeNull()

    await replaceText(input, "Thanks @Lee Chen for the pass.")
    await userEvent.setup().keyboard("{Enter}")

    await waitFor(() =>
      expect(calls).toEqual([
        {
          channelId,
          body: "Thanks @Lee Chen for the pass.",
          parentMessageId: null
        }
      ])
    )
  })

  it("inserts mention suggestions from the composer with the mouse", async () => {
    render(
      <TestWorkspaceChat
        model={withMembers(makeChatModel([]), [
          { id: "human-2", displayName: "Lee Chen" },
          { id: "human-3", displayName: "Mina Rao" }
        ])}
      />
    )
    const input = await screen.findByPlaceholderText("Message origination")

    await replaceText(input, "@mi")
    await userEvent.setup().click(await screen.findByRole("option", { name: "Mina Rao" }))

    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe("@Mina Rao "))
    expect(screen.queryByRole("listbox", { name: "Mention suggestions" })).toBeNull()
  })

  it("dismisses mention suggestions from the composer without changing the draft", async () => {
    render(<TestWorkspaceChat model={withMembers(makeChatModel([]), [{ id: "human-2", displayName: "Lee Chen" }])} />)
    const input = await screen.findByPlaceholderText("Message origination")

    await replaceText(input, "Loop in @zz")

    expect(await screen.findByRole("listbox", { name: "Mention suggestions" })).toBeTruthy()
    expect(screen.getByText("No matching members")).toBeTruthy()

    await userEvent.setup().keyboard("{Escape}")

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

    const { container } = render(<TestWorkspaceChat model={model} />)

    expect(await screen.findByText("First Maya message.")).toBeTruthy()
    expect(
      Array.from(container.querySelectorAll(".chatTimeline .messageRunAvatar")).map((avatar) => avatar.textContent)
    ).toEqual(["MP", "LC", "MP"])
    expect(
      container.querySelectorAll(".chatTimeline .messageRun").item(0).querySelectorAll(".channelMessage")
    ).toHaveLength(2)
    expect(
      Array.from(container.querySelectorAll(".chatTimeline .messageMeta strong")).map((name) => name.textContent)
    ).toEqual(["Maya Patel", "Lee Chen", "Maya Patel"])
    const compactTimestamp = container.querySelector(
      ".chatTimeline .channelMessage.compact .messageAvatarCell .messageTimestamp"
    )
    expect(compactTimestamp?.closest(".channelMessage")?.className).toContain("items-center")
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

  it("shows a compact send failure when an operation formatter is provided", async () => {
    render(
      <TestWorkspaceChat
        model={makeChatModel()}
        messages={{
          create: () => Promise.reject(new Error("backend token details")),
          delete: () => Promise.resolve(),
          canDeleteMessages: true,
          errorMessage: () => "Could not send message. Check your connection and try again."
        }}
      />
    )

    const input = await screen.findByPlaceholderText("Message origination")
    await replaceText(input, "I will tighten the partner brief.")
    await userEvent.setup().keyboard("{Enter}")

    expect((await screen.findByRole("status")).textContent).toBe(
      "Could not send message. Check your connection and try again."
    )
    expect(screen.queryByText(/backend token details/)).toBeNull()
  })

  it("shows attachment upload failures without clearing the draft and can send after retry", async () => {
    const calls: Array<unknown> = []
    const upload = vi.fn().mockRejectedValueOnce(new Error("upload token expired")).mockResolvedValueOnce({
      id: "storage-1",
      storageId: "storage-1",
      name: "brief.png",
      contentType: "image/png",
      size: 4096,
      kind: "image",
      url: null
    })

    const { container } = render(
      <TestWorkspaceChat
        model={makeChatModel([])}
        messages={{
          create: (input) => {
            calls.push(input)
            return Promise.resolve()
          },
          delete: () => Promise.resolve(),
          upload,
          canDeleteMessages: true,
          errorMessage: (operation) =>
            operation === "attach"
              ? "Could not upload attachment. Check your connection and try again."
              : "Could not send message. Check your connection and try again."
        }}
      />
    )
    const input = await screen.findByPlaceholderText("Message origination")
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement
    const file = new File(["image"], "brief.png", { type: "image/png" })

    await replaceText(input, "Retry keeps this draft.")
    await uploadFiles(fileInput, file)

    expect(await screen.findByText("Could not upload attachment. Check your connection and try again.")).toBeTruthy()
    expect((input as HTMLTextAreaElement).value).toBe("Retry keeps this draft.")

    await uploadFiles(fileInput, file)
    expect(await screen.findByText("brief.png")).toBeTruthy()
    await userEvent.setup().click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() =>
      expect(calls).toEqual([
        expect.objectContaining({
          channelId,
          body: "Retry keeps this draft.",
          attachments: [expect.objectContaining({ storageId: "storage-1", name: "brief.png" })]
        })
      ])
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
      name: "design",
      visibility: "public"
    })
    const base = makeChatModel([])
    const props = {
      messages: {
        create: () => Promise.resolve(),
        upload,
        discard,
        delete: () => Promise.resolve(),
        canDeleteMessages: true
      }
    }
    const { container, rerender } = render(
      <TestWorkspaceChat {...props} model={{ ...base, channels: [base.channel, secondChannel] }} />
    )
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement
    await uploadFiles(fileInput, new File(["image"], "brief.png", { type: "image/png" }))

    rerender(
      <TestWorkspaceChat
        {...props}
        model={withMessages(
          {
            ...base,
            channel: secondChannel,
            channels: [base.channel, secondChannel]
          },
          []
        )}
      />
    )
    const nextInput = await screen.findByPlaceholderText("Message design")
    await replaceText(nextInput, "Keep this design draft.")
    const uploaded: ChatMessageAttachment = {
      id: "storage-1",
      storageId: "storage-1",
      name: "brief.png",
      contentType: "image/png",
      size: 5,
      kind: "image",
      url: null
    }

    completeUpload(uploaded)

    await waitFor(() => expect(discard).toHaveBeenCalledWith(uploaded))
    expect(screen.queryByText("brief.png")).toBeNull()
    expect((nextInput as HTMLTextAreaElement).value).toBe("Keep this design draft.")
  })

  it("rejects invalid files before upload and cleans successful uploads after a partial batch failure", async () => {
    const uploaded: ChatMessageAttachment = {
      id: "storage-1",
      storageId: "storage-1",
      name: "brief.png",
      contentType: "image/png",
      size: 5,
      kind: "image",
      url: null
    }
    const upload = vi.fn().mockResolvedValueOnce(uploaded).mockRejectedValueOnce(new Error("second upload failed"))
    const discard = vi.fn(() => Promise.resolve())
    const { container } = render(
      <TestWorkspaceChat
        model={makeChatModel([])}
        messages={{
          create: () => Promise.resolve(),
          upload,
          discard,
          delete: () => Promise.resolve(),
          canDeleteMessages: true
        }}
      />
    )
    const fileInput = container.querySelector("input[type='file']") as HTMLInputElement
    const invalid = new File(["zip"], "archive.zip", { type: "application/zip" })
    fireEvent.change(fileInput, { target: { files: [invalid] } })
    expect(await screen.findByText(/must be PNG, JPEG, GIF, WebP, PDF, or plain text/)).toBeTruthy()
    expect(upload).not.toHaveBeenCalled()

    const first = new File(["one"], "one.png", { type: "image/png" })
    const second = new File(["two"], "two.png", { type: "image/png" })
    await uploadFiles(fileInput, [first, second])
    await waitFor(() => expect(discard).toHaveBeenCalledWith(uploaded))
    expect(screen.queryByText("brief.png")).toBeNull()
  })
})
