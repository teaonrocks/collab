import path from "node:path"
import { ESLint } from "eslint"
import { describe, expect, it } from "vitest"

const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: path.join(process.cwd(), "eslint.config.mjs") })

const boundaryMessages = async (filePath: string, source: string) => {
  const [result] = await eslint.lintText(source, { filePath })
  return result?.messages.filter(({ ruleId }) => ruleId === "boundaries/dependencies") ?? []
}

describe("renderer architecture boundaries", () => {
  it.each([
    ["src/renderer/chat-data.ts", 'import "./dogfood-chat-adapter"'],
    ["src/renderer/ui/button.tsx", 'import "../dogfood-chat-adapter"']
  ])(
    "blocks generic renderer code from importing dogfood modules from %s",
    async (filePath, source) => {
      await expect(boundaryMessages(filePath, source)).resolves.toHaveLength(1)
    },
    30_000
  )

  it.each([
    ["src/renderer/dogfood-chat.test.tsx", 'import "./dogfood-chat-adapter"'],
    ["src/renderer/main.tsx", 'import "./dogfood-chat"'],
    ["src/renderer/chat-data.ts", 'import "../shared/account-session"'],
    ["src/renderer/dogfood-chat/use-viewer-session.ts", 'import "../workspace-chat"'],
    ["convex/chat.ts", 'import "../src/shared/attachment-policy"']
  ])(
    "preserves an allowed dependency from %s",
    async (filePath, source) => {
      await expect(boundaryMessages(filePath, source)).resolves.toEqual([])
    },
    30_000
  )
})
