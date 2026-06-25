// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { cn } from "../lib/cn"
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  ScrollArea,
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

  it("renders native app-owned primitives with accessible defaults", () => {
    render(
      <section>
        <Button>Send</Button>
        <Input aria-label="Channel name" />
        <Textarea aria-label="Message" />
        <Badge>Beta</Badge>
        <Avatar name="Maya Patel" />
      </section>
    )

    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Send" }).className).toContain("bg-foreground")
    expect(screen.getByRole("textbox", { name: "Channel name" })).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "Channel name" }).className).toContain("border-border-strong")
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy()
    expect(screen.getByText("Beta")).toBeTruthy()
    expect(screen.getByText("Beta").className).toContain("bg-surface-muted")
    expect(screen.getByLabelText("Maya Patel").textContent).toBe("MP")
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

    expect(screen.getByRole("dialog", { name: "Delete message" })).toBeTruthy()
    expect(screen.getByText("Confirm before removing this message.")).toBeTruthy()
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

    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeTruthy()
    expect(screen.getByText("Helpful context").textContent).toBe("Helpful context")
    expect(screen.getByText("Scrollable content")).toBeTruthy()
  })
})
