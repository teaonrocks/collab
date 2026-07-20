import { convexTest } from "convex-test"
import { afterEach, beforeEach, vi } from "vitest"
import { api, internal } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import schema from "../../convex/schema"
import { MESSAGE_REACTION_EMOJIS } from "../shared/reaction-policy"

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../../convex/**/*.ts")).map(([path, loader]) => [
    path.replace("../../convex/", "./"),
    loader
  ])
)

export { api, internal, MESSAGE_REACTION_EMOJIS }
export type { Id }

export const messagePageArgs = (channelId: Id<"channels">, numItems = 100, cursor: string | null = null) => ({
  channelId,
  paginationOpts: { numItems, cursor }
})

export const mayaIdentity = {
  tokenIdentifier: "https://issuer.example|maya",
  email: "maya@example.com",
  name: "Maya Patel"
}

export const leeIdentity = {
  tokenIdentifier: "https://issuer.example|lee",
  email: "lee@example.com",
  name: "Lee Chen"
}

export const diegoIdentity = {
  tokenIdentifier: "https://issuer.example|diego-private-membership",
  email: "diego@example.com",
  name: "Diego Rivera"
}

type ChatIdentity = typeof mayaIdentity
export const createChatScenario = () => convexTest(schema, modules)
type ChatScenario = ReturnType<typeof createChatScenario>

export const ensureViewer = (scenario: ChatScenario, identity: ChatIdentity) =>
  scenario.mutation(internal.chat.ensureViewerForIdentity, {
    tokenIdentifier: identity.tokenIdentifier,
    email: identity.email,
    displayName: identity.name
  })

export const ensureViewers = (scenario: ChatScenario, ...identities: ReadonlyArray<ChatIdentity>) =>
  Promise.all(identities.map((identity) => ensureViewer(scenario, identity)))

export const requireSeededUser = (scenario: ChatScenario, email: string) =>
  scenario.run(async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique()
    if (user === null) throw new Error(`Expected seeded user ${email}`)
    return user
  })

export const requireDogfoodWorkspace = (scenario: ChatScenario) =>
  scenario.run(async (ctx) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_key", (q) => q.eq("key", "aether-dogfood"))
      .unique()
    if (workspace === null) throw new Error("Expected dogfood workspace")
    return workspace
  })

export const silenceExpectedDogfoodDiagnostics = () => vi.spyOn(console, "error").mockImplementation(() => {})

beforeEach(() => {
  vi.stubEnv("AETHER_ALLOWED_EMAILS", "maya@example.com,lee@example.com")
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
