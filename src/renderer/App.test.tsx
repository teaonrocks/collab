// @vitest-environment happy-dom
import { Atom } from "@effect-atom/atom"
import { RegistryProvider } from "@effect-atom/atom-react"
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { Effect, Layer, Stream } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  Channel,
  type ChannelId,
  ChannelMessage,
  ChannelMessageAttachment,
  ChannelMessageParent,
  type ChannelMessageId,
  ChannelMessageReaction,
  CollabSnapshot,
  HumanAccount,
  type HumanAccountId,
  Workspace,
  type WorkspaceId
} from "../shared/collab-rpc"
import { App, WorkspaceChat } from "./App"
import { layerChatDataFromCollabApi, toChatDataModel } from "./chat-data"
import { CollabApi } from "./collab-api"
import { runtime } from "./collab-atoms"

afterEach(cleanup)

const userId = "human-1" as HumanAccountId
const workspaceId = "workspace-1" as WorkspaceId
const channelId = "channel-1" as Channel["id"]
const secondChannelId = "channel-2" as Channel["id"]
const messageId = "message-1" as ChannelMessageId

const makeSnapshot = (messages: ReadonlyArray<ChannelMessage> = [
  new ChannelMessage({
    id: messageId,
    channelId,
    authorType: "human",
    authorId: userId,
    authorDisplayName: "Maya Patel",
    body: "The partner brief needs a concise risk summary.",
    createdAt: 2,
    deletedAt: null
  })
]) =>
  new CollabSnapshot({
    currentUser: new HumanAccount({
      id: userId,
      displayName: "Maya Patel",
      email: "maya@example.test",
      createdAt: 1
    }),
    workspace: new Workspace({
      id: workspaceId,
      name: "Aether Labs",
      createdAt: 1
    }),
    workspaceRole: "admin",
    channel: new Channel({
      id: channelId,
      workspaceId,
      name: "origination",
      visibility: "private",
      createdBy: userId,
      createdAt: 1
    }),
    channelRole: "admin",
    channelMessages: messages,
    workspaceAgents: [],
    channelAgentEnablements: [],
    threads: [],
    threadMessages: [],
    agentRuns: [],
    auditEvents: []
  })

const makeChatModel = (messages?: ReadonlyArray<ChannelMessage>) => toChatDataModel(makeSnapshot(messages))

const renderApp = (model: CollabSnapshot) => {
  const calls: Array<{ method: string; args: unknown }> = []
  const layer = Layer.succeed(
    CollabApi,
    CollabApi.of({
      snapshot: () => Effect.succeed(model),
      registerAgent: () => Effect.die("not used"),
      enableAgent: () => Effect.die("not used"),
      createChannelMessage: (input) => {
        calls.push({ method: "createChannelMessage", args: input })
        return Effect.succeed(new ChannelMessage({
          id: "message-2" as ChannelMessageId,
          channelId: input.channelId,
          authorType: "human",
          authorId: userId,
          authorDisplayName: "Maya Patel",
          body: input.body,
          createdAt: 12,
          deletedAt: null
        }))
      },
      deleteChannelMessage: (input) => {
        calls.push({ method: "deleteChannelMessage", args: input.messageId })
        return Effect.succeed(new ChannelMessage({
          id: input.messageId,
          channelId: input.channelId,
          authorType: "human",
          authorId: userId,
          authorDisplayName: "Maya Patel",
          body: "The partner brief needs a concise risk summary.",
          createdAt: 2,
          deletedAt: 13
        }))
      },
      createDraftThread: () => Effect.die("not used"),
      startRun: () => Effect.die("not used"),
      changes: () => Stream.make(model)
    })
  )
  render(
    <RegistryProvider
      initialValues={[Atom.initialValue(runtime.layer, mockRendererDataLayer(layer))]}
      scheduleTask={(f) => f()}
    >
      <App />
    </RegistryProvider>
  )
  return calls
}

const mockRendererDataLayer = (layer: Layer.Layer<CollabApi>) =>
  Layer.merge(layer, layerChatDataFromCollabApi.pipe(Layer.provide(layer)))

const openMessageMenu = async (authorDisplayName: string) => {
  fireEvent.click(await screen.findByLabelText(`More actions for message from ${authorDisplayName}`))
  return screen.findByRole("menu", { name: new RegExp(`message from ${authorDisplayName}`) })
}

describe("App", () => {
  it("renders the chat workspace from CollabApi", async () => {
    renderApp(makeSnapshot())

    expect(await screen.findByRole("heading", { name: "Aether Labs" })).toBeTruthy()
    expect(await screen.findByText(/partner brief/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Hide members" })).toBeTruthy()
    expect(screen.getByRole("tooltip", { name: "Aether Labs" })).toBeTruthy()
    const members = screen.getByLabelText("Channel members")
    expect(members).toBeTruthy()
    expect(screen.getByText("Online -- 1")).toBeTruthy()
    expect(within(members).getByText("MP").className).toContain("bg-surface-rail")
    expect(within(members).getByText("Maya Patel").className).toContain("text-foreground")
  })

  it("keeps direct messages in the global rail instead of channel navigation", async () => {
    renderApp(makeSnapshot())

    const globalNavigation = await screen.findByLabelText("Global navigation")
    const workspaceNavigation = screen.getByLabelText("Workspace navigation")
    const directMessages = within(globalNavigation).getByRole("navigation", { name: "Direct messages" })

    expect(directMessages).toBeTruthy()
    expect(within(directMessages).getByRole("button", { name: "Maya Patel" })).toBeTruthy()
    expect(within(directMessages).getByRole("tooltip", { name: "Maya Patel" })).toBeTruthy()
    expect(within(workspaceNavigation).queryByRole("navigation", { name: "Direct messages" })).toBeNull()
    expect(within(workspaceNavigation).queryByText("Maya Patel")).toBeNull()
  })

  it("keeps direct messages in the global rail while changing channels", async () => {
    const base = makeChatModel()
    const secondChannel = new Channel({
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
        model={{ ...base, channels: [base.channel, secondChannel] }}
      />
    )

    const globalNavigation = await screen.findByLabelText("Global navigation")
    const directMessages = within(globalNavigation).getByRole("navigation", { name: "Direct messages" })
    expect(await within(directMessages).findByRole("button", { name: "Maya Patel" })).toBeTruthy()

    rerender(
      <WorkspaceChat
        {...props}
        model={{
          ...base,
          channel: secondChannel,
          channels: [base.channel, secondChannel],
          channelMessages: [],
          channelMessagesLoading: true
        }}
      />
    )

    expect(within(directMessages).getByRole("button", { name: "Maya Patel" })).toBeTruthy()
    expect(within(directMessages).getByRole("tooltip", { name: "Maya Patel" })).toBeTruthy()
    expect(screen.getByLabelText("Channel members").querySelector("[aria-busy='true']")).toBeTruthy()
    expect(document.querySelector(".chatTimeline [class*='skeletonPulse']")).toBeTruthy()
    expect(document.querySelector("[class*='skeletonPulse']")).toBeTruthy()
  })

  it("renders and switches channels from the model channel list", async () => {
    const base = makeChatModel()
    const secondChannel = new Channel({
      id: secondChannelId,
      workspaceId,
      name: "design",
      visibility: "public",
      createdBy: userId,
      createdAt: 3
    })
    const selections: Array<ChannelId> = []

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
          return Promise.resolve(new Channel({
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

  it("creates a private channel when the private switch is enabled", async () => {
    const calls: Array<{ readonly name: string; readonly visibility?: "public" | "private" }> = []

    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        createChannel={(input) => {
          calls.push(input)
          return Promise.resolve(new Channel({
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
    const form = await screen.findByRole("form", { name: "Create channel" })
    fireEvent.change(within(form).getByLabelText("Channel name"), { target: { value: "ops" } })
    fireEvent.click(within(form).getByRole("switch", { name: "Private channel" }))
    fireEvent.submit(form)

    await waitFor(() => expect(calls).toEqual([{ name: "ops", visibility: "private" }]))
  })

  it("keeps the channel creation dialog state scoped to an open attempt", async () => {
    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
        createChannel={() => Promise.resolve(new Channel({
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
    const privateSwitch = within(form).getByRole("switch", { name: "Private channel" }) as HTMLButtonElement
    expect(createButton.disabled).toBe(true)

    fireEvent.change(channelName, { target: { value: "   " } })
    expect(createButton.disabled).toBe(true)

    fireEvent.change(channelName, { target: { value: "ops" } })
    expect(createButton.disabled).toBe(false)
    fireEvent.click(privateSwitch)
    expect(privateSwitch.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }))

    expect(screen.queryByRole("dialog", { name: "Create Channel" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Add channel" }))
    const nextForm = await screen.findByRole("form", { name: "Create channel" })
    expect((within(nextForm).getByLabelText("Channel name") as HTMLInputElement).value).toBe("")
    expect((within(nextForm).getByRole("switch", { name: "Private channel" }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("false")
    expect((within(nextForm).getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows channel creation backend errors without collapsing reserved error space", async () => {
    render(
      <WorkspaceChat
        model={makeChatModel()}
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

    fireEvent.change(within(form).getByLabelText("Channel name"), { target: { value: "ops" } })
    fireEvent.submit(form)

    expect(await within(form).findByText("Could not create channel. Check your connection and try again.")).toBeTruthy()
    expect(status.className).not.toContain("invisible")
    expect(screen.queryByText(/raw backend details/)).toBeNull()
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
          return Promise.resolve(new Channel({
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
    expect(within(menu).getByText("Maya Patel")).toBeTruthy()
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Sign out" }))

    expect(signOuts).toBe(1)
    expect(screen.queryByRole("menu", { name: "Profile settings" })).toBeNull()
  })

  it("uses a dot instead of a count for inactive channel unread state", async () => {
    const base = makeChatModel()
    const secondChannel = new Channel({
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

    expect(within(channels).getByLabelText("Unread messages")).toBeTruthy()
    expect(within(channels).queryByText("2")).toBeNull()
  })

  it("prioritizes mention state over unread state in inactive channel indicators", async () => {
    const base = makeChatModel()
    const secondChannel = new Channel({
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

    expect(within(channels).getByLabelText("Mentioned")).toBeTruthy()
    expect(within(channels).queryByLabelText("Unread messages")).toBeNull()
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

    expect(within(channels).queryByLabelText("Mentioned")).toBeNull()
    expect(within(channels).queryByLabelText("Unread messages")).toBeNull()
  })

  it("shows edited message time with a trailing marker in the timestamp", async () => {
    renderApp(makeSnapshot([
      new ChannelMessage({
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
          new ChannelMessage({
            id: "message-1" as ChannelMessageId,
            channelId,
            authorType: "human",
            authorId: userId,
            authorDisplayName: "Maya Patel",
            body: "The launch memo is ready for review.",
            createdAt: 2,
            deletedAt: null
          }),
          new ChannelMessage({
            id: "message-2" as ChannelMessageId,
            channelId,
            authorType: "human",
            authorId: "human-2",
            authorDisplayName: "Lee Chen",
            body: "Risk summary needs one more pass.",
            createdAt: 4,
            deletedAt: null
          }),
          new ChannelMessage({
            id: "message-3" as ChannelMessageId,
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

    const search = await screen.findByPlaceholderText("Search origination")
    fireEvent.change(search, { target: { value: "risk" } })

    const results = await screen.findByRole("region", { name: "Message search results" })
    expect(within(results).getByText("Lee Chen")).toBeTruthy()
    expect(within(results).getByText("Risk summary needs one more pass.")).toBeTruthy()
    expect(within(results).getByText("#origination")).toBeTruthy()
    expect(within(results).queryByText("Mina Rao")).toBeNull()

    fireEvent.click(within(results).getByRole("button", { name: /Risk summary needs one more pass/ }))

    await waitFor(() => {
      const message = screen.getAllByText("Risk summary needs one more pass.")
        .find((element) => element.closest(".chatTimeline") !== null)
      expect(message!.closest("article")?.className).toContain("searchHighlighted")
    })
  })

  it("shows message search empty and error states", async () => {
    render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    const search = await screen.findByPlaceholderText("Search origination")
    fireEvent.change(search, { target: { value: "nonexistent" } })

    expect((await screen.findByRole("status")).textContent).toBe("No matching messages.")

    fireEvent.change(search, { target: { value: "x".repeat(121) } })

    expect((await screen.findByRole("alert")).textContent).toBe("Search is limited to 120 characters.")
  })

  it("sends a channel message from the bottom composer with Enter", async () => {
    const calls = renderApp(makeSnapshot())
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
    const calls = renderApp(makeSnapshot())
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

  it("sends a reply with the selected parent and can cancel reply mode without clearing the draft", async () => {
    const calls = renderApp(makeSnapshot())
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
    const replyId = "message-2" as ChannelMessageId
    renderApp(makeSnapshot([
      new ChannelMessage({
        id: messageId,
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "The partner brief needs a concise risk summary.",
        createdAt: 2,
        deletedAt: null
      }),
      new ChannelMessage({
        id: replyId,
        channelId,
        authorType: "human",
        authorId: "human-2",
        authorDisplayName: "Lee Chen",
        body: "I will draft it.",
        createdAt: 3,
        deletedAt: null,
        parentMessageId: messageId,
        parentMessage: new ChannelMessageParent({
          id: messageId,
          authorDisplayName: "Maya Patel",
          bodyPreview: "The partner brief needs a concise risk summary.",
          deleted: false
        })
      }),
      new ChannelMessage({
        id: "message-3" as ChannelMessageId,
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "Thanks.",
        createdAt: 4,
        deletedAt: null,
        parentMessageId: "message-missing" as ChannelMessageId,
        parentMessage: null
      })
    ]))

    expect(await screen.findByRole("button", { name: /Reply to Maya Patel/ })).toBeTruthy()
    expect(screen.getByText("I will draft it.")).toBeTruthy()
    expect(screen.getByText("Original message unavailable")).toBeTruthy()
  })

  it("renders image thumbnails and file attachment links without trusting unsafe URLs", async () => {
    renderApp(makeSnapshot([
      new ChannelMessage({
        id: messageId,
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "Attachments for review.",
        createdAt: 2,
        deletedAt: null,
        attachments: [
          new ChannelMessageAttachment({
            id: "attachment-1",
            storageId: "storage-1",
            name: "brief.png",
            contentType: "image/png",
            size: 4096,
            kind: "image",
            url: "https://files.example/brief.png"
          }),
          new ChannelMessageAttachment({
            id: "attachment-2",
            storageId: "storage-2",
            name: "notes.pdf",
            contentType: "application/pdf",
            size: 2048,
            kind: "file",
            url: "javascript:alert(1)"
          })
        ]
      })
    ]))

    const image = await screen.findByRole("img", { name: "brief.png" })
    expect(image.getAttribute("src")).toBe("https://files.example/brief.png")
    expect(screen.getByRole("link", { name: "Open image attachment brief.png" })).toBeTruthy()
    expect(screen.getByText("notes.pdf")).toBeTruthy()
    expect(screen.queryByRole("link", { name: /notes\.pdf/ })).toBeNull()
  })

  it("keeps Shift+Enter inside the composer without sending", async () => {
    const calls = renderApp(makeSnapshot())
    const input = await screen.findByPlaceholderText("Message origination")

    fireEvent.change(input, { target: { value: "First line" } })
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: true })

    expect(calls.some((call) => call.method === "createChannelMessage")).toBe(false)
    expect((input as HTMLTextAreaElement).value).toBe("First line")
  })

  it("filters and inserts mention suggestions from the composer with the keyboard", async () => {
    const calls: Array<{ readonly channelId: ChannelId; readonly body: string }> = []
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
    renderApp(makeSnapshot([]))

    expect(await screen.findByText("No messages yet")).toBeTruthy()
    expect(screen.getByText("Start the conversation in")).toBeTruthy()
    expect(screen.getByText("origination.")).toBeTruthy()
  })

  it("groups consecutive messages from the same author under one sticky avatar", async () => {
    const model = makeChatModel([
      new ChannelMessage({
        id: "message-1" as ChannelMessageId,
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "First Maya message.",
        createdAt: 2,
        deletedAt: null
      }),
      new ChannelMessage({
        id: "message-2" as ChannelMessageId,
        channelId,
        authorType: "human",
        authorId: userId,
        authorDisplayName: "Maya Patel",
        body: "Second Maya message.",
        createdAt: 3,
        editedAt: 6,
        deletedAt: null
      }),
      new ChannelMessage({
        id: "message-3" as ChannelMessageId,
        channelId,
        authorType: "human",
        authorId: "human-2",
        authorDisplayName: "Lee Chen",
        body: "Lee breaks the chain.",
        createdAt: 4,
        deletedAt: null
      }),
      new ChannelMessage({
        id: "message-4" as ChannelMessageId,
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
      .mockResolvedValueOnce(new ChannelMessageAttachment({
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

  it("places multi-select checkboxes before the avatar column", async () => {
    renderApp(makeSnapshot([
      ...makeSnapshot().channelMessages,
      new ChannelMessage({
        id: "message-2" as ChannelMessageId,
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
    renderApp(makeSnapshot([
      ...makeSnapshot().channelMessages,
      new ChannelMessage({
        id: "message-2" as ChannelMessageId,
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
    renderApp(makeSnapshot([
      ...makeSnapshot().channelMessages,
      new ChannelMessage({
        id: "message-2" as ChannelMessageId,
        channelId,
        authorType: "human",
        authorId: "human-2",
        authorDisplayName: "Lee Chen",
        body: "I pulled the incidents into the notes.",
        createdAt: 3,
        deletedAt: null
      }),
      new ChannelMessage({
        id: "message-3" as ChannelMessageId,
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
    renderApp(makeSnapshot())

    fireEvent.contextMenu(await screen.findByText(/partner brief/), { clientX: 20, clientY: 30 })

    const menu = await screen.findByRole("menu", { name: /message from Maya Patel/ })
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Select" }))

    expect((await screen.findAllByLabelText("Deselect message from Maya Patel")).length).toBeGreaterThan(0)
  })

  it("shows only the icon More button in the inline message actions", async () => {
    const { container } = render(
      <WorkspaceChat
        model={makeChatModel()}
        createChannelMessage={() => Promise.resolve()}
        deleteChannelMessage={() => Promise.resolve()}
      />
    )

    expect(await screen.findByText(/partner brief/)).toBeTruthy()
    const actions = container.querySelector(".messageActions")
    expect(actions).not.toBeNull()
    const buttons = Array.from(actions!.querySelectorAll("button"))
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.textContent).toBe("")
    expect(screen.getByLabelText("More actions for message from Maya Patel")).toBeTruthy()
  })

  it("renders compact message reactions and toggles the selected emoji", async () => {
    const calls: Array<{ readonly messageId: ChannelMessageId; readonly emoji: string }> = []
    render(
      <WorkspaceChat
        model={makeChatModel([
          new ChannelMessage({
            id: messageId,
            channelId,
            authorType: "human",
            authorId: userId,
            authorDisplayName: "Maya Patel",
            body: "The partner brief needs a concise risk summary.",
            createdAt: 2,
            deletedAt: null,
            reactions: [new ChannelMessageReaction({ emoji: "👍", count: 2, reactedByCurrentUser: true })]
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

    fireEvent.click(reaction)

    await waitFor(() => expect(calls).toEqual([{ messageId, emoji: "👍" }]))
  })

  it("waits for delete confirmation before deleting a message", async () => {
    const calls = renderApp(makeSnapshot())

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
    const calls = renderApp(makeSnapshot())

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
      ...makeSnapshot().channelMessages,
      new ChannelMessage({
        id: "message-2" as ChannelMessageId,
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
    renderApp(makeSnapshot())

    const hideMembersButton = await screen.findByRole("button", { name: "Hide members" })
    expect(hideMembersButton.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(hideMembersButton)

    const showMembersButton = screen.getByRole("button", { name: "Show members" })
    expect(showMembersButton.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(showMembersButton)

    expect(screen.getByRole("button", { name: "Hide members" }).getAttribute("aria-pressed")).toBe("true")
  })
})
