// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  channelId,
  makeChannel,
  makeChatModel,
  TestWorkspaceChat,
  userId,
  withMemberInviteCandidates,
  withMembers
} from "./workspace-chat/test-support"

afterEach(cleanup)

describe("WorkspaceChat", () => {
  it("shows channel skeletons while selected channel messages load", async () => {
    const { container } = render(
      <TestWorkspaceChat
        model={{
          ...makeChatModel([]),
          conversation: {
            ...makeChatModel([]).conversation,
            messages: { status: "loading" },
            members: { status: "loading" }
          }
        }}
      />
    )

    expect(await screen.findByRole("heading", { name: "Aether Labs" })).toBeTruthy()
    expect(screen.queryByText("No messages yet")).toBeNull()
    expect(container.querySelectorAll(".channelMessageSkeleton")).toHaveLength(7)
    expect(container.querySelectorAll(".chatTimeline [class*='skeletonPulse']")).toHaveLength(21)
    expect(screen.getByLabelText("Channel members").querySelectorAll("[class*='skeletonPulse']")).toHaveLength(12)
    expect(screen.getByPlaceholderText("Message origination")).toBeDisabled()
  })

  it("shows membership-backed channel members before they post", async () => {
    render(
      <TestWorkspaceChat
        model={withMembers(makeChatModel([]), [
          { id: "human-2", displayName: "Lee Chen" },
          { id: userId, displayName: "Maya Patel" }
        ])}
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
    const addChannelMember = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAdd = resolve
        })
    )
    const base = makeChatModel([])
    const props = {
      channels: {
        addMember: addChannelMember,
        removeMember: vi.fn(() => Promise.resolve())
      }
    }
    const { rerender } = render(
      <TestWorkspaceChat
        {...props}
        model={withMemberInviteCandidates(
          withMembers(base, [{ id: userId, displayName: "Maya Patel", role: "admin" }]),
          [{ id: "human-2", displayName: "Lee Chen" }]
        )}
      />
    )

    const manage = await screen.findByRole("button", { name: "Manage channel members" })
    expect(manage.getAttribute("aria-haspopup")).toBe("dialog")
    await userEvent.setup().click(manage)

    const dialog = await screen.findByRole("dialog", { name: "Manage #origination" })
    expect(within(dialog).getByText("Admin · You")).toBeTruthy()
    expect(within(dialog).getByText("Last admin")).toBeTruthy()
    expect(within(dialog).queryByRole("button", { name: "Remove Maya Patel" })).toBeNull()

    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Add" }))
    expect(addChannelMember).toHaveBeenCalledWith({ channelId, userId: "human-2" })
    expect(within(dialog).getByRole("button", { name: "Adding..." }).hasAttribute("disabled")).toBe(true)
    resolveAdd?.()
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Adding..." })).toBeNull())
    expect(within(dialog).queryByText("Lee Chen was added.")).toBeNull()

    rerender(
      <TestWorkspaceChat
        {...props}
        model={withMemberInviteCandidates(
          withMembers(base, [
            { id: userId, displayName: "Maya Patel", role: "admin" },
            { id: "human-2", displayName: "Lee Chen", role: "member" }
          ]),
          []
        )}
      />
    )
    expect(within(dialog).getByText("No eligible members to add.")).toBeTruthy()
    expect(within(dialog).getByText("Member")).toBeTruthy()
  })

  it("shows member-management failures and confirms that removal revokes access immediately", async () => {
    const addChannelMember = vi.fn(() => Promise.reject(new Error("private backend detail")))
    const removeChannelMember = vi.fn(() => Promise.resolve())
    render(
      <TestWorkspaceChat
        model={withMemberInviteCandidates(
          withMembers(makeChatModel([]), [
            { id: userId, displayName: "Maya Patel", role: "admin" },
            { id: "human-2", displayName: "Lee Chen", role: "admin" }
          ]),
          [{ id: "human-3", displayName: "Diego Rivera" }]
        )}
        channels={{ addMember: addChannelMember, removeMember: removeChannelMember }}
      />
    )

    await userEvent.setup().click(await screen.findByRole("button", { name: "Manage channel members" }))
    const managementDialog = await screen.findByRole("dialog", { name: "Manage #origination" })
    await userEvent.setup().click(within(managementDialog).getByRole("button", { name: "Add" }))
    expect((await within(managementDialog).findByRole("alert")).textContent).toBe(
      "Could not add Diego Rivera. Try again."
    )
    expect(within(managementDialog).queryByText("private backend detail")).toBeNull()

    const mayaRow = within(managementDialog).getByText("Maya Patel").closest("li")!
    await userEvent.setup().click(within(mayaRow).getByRole("button", { name: "Remove Maya Patel" }))
    const confirmation = await screen.findByRole("dialog", { name: "Remove Maya Patel?" })
    expect(within(confirmation).getByText(/access ends immediately/i)).toBeTruthy()
    expect(within(confirmation).getByText(/moved to an accessible channel/i)).toBeTruthy()
    await userEvent.setup().click(within(confirmation).getByRole("button", { name: "Leave channel" }))
    await waitFor(() => expect(removeChannelMember).toHaveBeenCalledWith({ channelId, userId }))
  })

  it("does not offer private-channel administration to ordinary members or on public channels", () => {
    const commands = {
      channels: {
        addMember: vi.fn(() => Promise.resolve()),
        removeMember: vi.fn(() => Promise.resolve())
      }
    }
    const base = makeChatModel([])
    const { rerender } = render(
      <TestWorkspaceChat
        {...commands}
        model={withMembers(base, [
          { id: userId, displayName: "Maya Patel", role: "member" },
          { id: "human-2", displayName: "Lee Chen", role: "admin" }
        ])}
      />
    )

    expect(screen.queryByRole("button", { name: "Manage channel members" })).toBeNull()
    rerender(
      <TestWorkspaceChat
        {...commands}
        model={withMembers(
          {
            ...base,
            channel: makeChannel({ id: channelId, name: "origination", visibility: "public" }),
            channels: [makeChannel({ id: channelId, name: "origination", visibility: "public" })]
          },
          [{ id: userId, displayName: "Maya Patel", role: "admin" }]
        )}
      />
    )
    expect(screen.queryByRole("button", { name: "Manage channel members" })).toBeNull()
    expect(screen.getByText("You")).toBeTruthy()
  })

  it("shows an empty channel members state", async () => {
    render(<TestWorkspaceChat model={withMembers(makeChatModel([]), [])} />)

    expect(await screen.findByText("No members yet")).toBeTruthy()
  })
})
