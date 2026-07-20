// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { cn } from "../lib/cn"
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Radio,
  RadioGroup,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "."

afterEach(cleanup)

describe("renderer UI foundation", () => {
  it("merges utility classes predictably", () => {
    expect(cn("px-2", false, "px-4", "text-sm")).toBe("px-4 text-sm")
  })

  it("preserves explicit icon sizes inside buttons", () => {
    render(
      <Button aria-label="Custom icon">
        <span>
          <svg className="size-[9px]" aria-hidden="true" />
        </span>
      </Button>
    )

    const button = screen.getByRole("button", { name: "Custom icon" })
    expect(button.className).toContain("[&_svg:not([class*='size-'])]:size-4")
    expect(button.className).not.toContain("[&_svg]:size-4")
    expect(button.querySelector("svg")?.getAttribute("class")).toContain("size-[9px]")
  })

  it("renders native app-owned primitives with accessible defaults", () => {
    render(
      <section>
        <Button>Send</Button>
        <Input aria-label="Channel name" />
        <Textarea aria-label="Message" />
        <Badge>Beta</Badge>
        <Avatar name="Maya Patel" />
        <Switch aria-label="Enable notifications" />
        <Checkbox aria-label="Select message" defaultChecked />
        <RadioGroup aria-label="Visibility" defaultValue="private">
          <Radio value="public" aria-label="Public" />
          <Radio value="private" aria-label="Private" />
        </RadioGroup>
      </section>
    )

    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Enable notifications" })).toHaveClass("rounded-full")
    expect(screen.getByRole("checkbox", { name: "Select message" })).toBeChecked()
    expect(screen.getByRole("radio", { name: "Private" })).toBeChecked()
    expect(screen.getByRole("button", { name: "Send" })).toHaveClass("bg-foreground")
    expect(screen.getByRole("textbox", { name: "Channel name" })).toHaveClass("border-border-strong")
    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument()
    expect(screen.getByText("Beta")).toHaveClass("bg-surface-muted")
    expect(screen.getByLabelText("Maya Patel")).toHaveTextContent("MP")
  })

  it("wraps Base UI dialog parts", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Delete message</DialogTitle>
          <DialogDescription>Confirm before removing this message.</DialogDescription>
        </DialogContent>
      </Dialog>
    )

    expect(screen.getByRole("dialog", { name: "Delete message" })).toBeInTheDocument()
    expect(screen.getByText("Confirm before removing this message.")).toBeInTheDocument()
  })

  it("wraps Base UI menu, tooltip, and scroll area parts", () => {
    render(
      <TooltipProvider>
        <DropdownMenu open>
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Copy</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip open>
          <TooltipTrigger>Help</TooltipTrigger>
          <TooltipContent>Helpful context</TooltipContent>
        </Tooltip>

        <ScrollArea className="h-24 w-24">
          <p>Scrollable content</p>
        </ScrollArea>
      </TooltipProvider>
    )

    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeInTheDocument()
    expect(screen.getByText("Helpful context")).toHaveTextContent("Helpful context")
    expect(screen.getByText("Scrollable content")).toBeInTheDocument()
  })

  it("wraps Base UI select and context menu behavior", async () => {
    const user = userEvent.setup()
    render(
      <>
        <Select defaultValue="mentions">
          <SelectTrigger aria-label="Notifications">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All messages</SelectItem>
            <SelectItem value="mentions">Mentions only</SelectItem>
          </SelectContent>
        </Select>

        <ContextMenu>
          <ContextMenuTrigger aria-label="Message surface">Message</ContextMenuTrigger>
          <ContextMenuContent aria-label="Message actions">
            <ContextMenuItem>Copy</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </>
    )

    await user.click(screen.getByRole("combobox", { name: "Notifications" }))
    expect(await screen.findByRole("option", { name: "Mentions only" })).toBeInTheDocument()
    expect(
      screen
        .getByRole("option", { name: "All messages" })
        .firstElementChild?.classList.contains("selectItemIndicatorSlot")
    ).toBe(true)

    await user.pointer({ keys: "[MouseRight]", target: screen.getByLabelText("Message surface") })
    expect(await screen.findByRole("menuitem", { name: "Copy" })).toBeInTheDocument()
  })
})
