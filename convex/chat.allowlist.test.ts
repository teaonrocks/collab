/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { describe, expect, it, vi } from "vitest"
import {
  api,
  internal,
  createChatScenario,
  ensureViewer,
  leeIdentity,
  mayaIdentity,
  silenceExpectedDogfoodDiagnostics
} from "../src/test/convex-chat"

describe("dogfood allowlist administration", () => {
  it("adds dogfood allowlist entries through deployment-scoped tooling and audits the operator", async () => {
    const t = createChatScenario()
    const diegoIdentity = {
      tokenIdentifier: "https://issuer.example|diego",
      email: "DIEGO@EXAMPLE.COM",
      name: "Diego Rivera"
    }

    await expect(
      t.mutation(internal.chat.ensureViewerForIdentity, {
        tokenIdentifier: diegoIdentity.tokenIdentifier,
        email: diegoIdentity.email,
        displayName: diegoIdentity.name
      })
    ).rejects.toThrow("This email is not on the Aether dogfood allowlist")

    await expect(
      t.mutation(internal.chat.administerDogfoodAllowlist, {
        operator: "Archer Chua",
        email: "  Diego@Example.com ",
        action: "add",
        reason: "  first dogfood group  "
      })
    ).resolves.toEqual({ email: "diego@example.com", active: true })

    await expect(
      t.mutation(internal.chat.ensureViewerForIdentity, {
        tokenIdentifier: diegoIdentity.tokenIdentifier,
        email: diegoIdentity.email,
        displayName: diegoIdentity.name
      })
    ).resolves.toMatchObject({
      displayName: "Diego Rivera"
    })

    const records = await t.run(async (ctx) => ({
      entry: await ctx.db
        .query("dogfoodAllowlistEntries")
        .withIndex("by_email", (q) => q.eq("email", "diego@example.com"))
        .unique(),
      audit: await ctx.db
        .query("dogfoodAllowlistAudit")
        .withIndex("by_email", (q) => q.eq("email", "diego@example.com"))
        .collect()
    }))

    expect(records.entry).toMatchObject({
      email: "diego@example.com",
      active: true,
      createdBy: "Archer Chua",
      updatedBy: "Archer Chua"
    })
    expect(records.audit).toEqual([
      expect.objectContaining({
        email: "diego@example.com",
        action: "add",
        operator: "Archer Chua",
        reason: "first dogfood group"
      })
    ])
  })

  it("removes dogfood users, overrides bootstrap env entries, and keeps removed users blocked", async () => {
    silenceExpectedDogfoodDiagnostics()
    const t = createChatScenario()
    await ensureViewer(t, leeIdentity)

    await expect(
      t.mutation(internal.chat.administerDogfoodAllowlist, {
        operator: "Archer Chua",
        email: "Lee@Example.com",
        action: "remove",
        reason: "offboarded"
      })
    ).resolves.toEqual({ email: "lee@example.com", active: false })

    await expect(t.withIdentity(leeIdentity).query(api.chat.defaultWorkspace)).rejects.toThrow(
      "This email is not on the Aether dogfood allowlist"
    )
    await expect(
      t.mutation(internal.chat.ensureViewerForIdentity, {
        tokenIdentifier: leeIdentity.tokenIdentifier,
        email: leeIdentity.email,
        displayName: leeIdentity.name
      })
    ).rejects.toThrow("This email is not on the Aether dogfood allowlist")

    const audit = await t.run((ctx) =>
      ctx.db
        .query("dogfoodAllowlistAudit")
        .withIndex("by_email", (q) => q.eq("email", "lee@example.com"))
        .collect()
    )
    expect(audit).toEqual([
      expect.objectContaining({
        email: "lee@example.com",
        action: "remove",
        reason: "offboarded"
      })
    ])
  })

  it("rejects allowlist management without an attributable operator and logs no credentials", async () => {
    const t = createChatScenario()
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      t.mutation(internal.chat.administerDogfoodAllowlist, {
        operator: "   ",
        email: "friend@example.com",
        action: "add"
      })
    ).rejects.toThrow("Operator identity must contain between 1 and 120 characters")

    const audit = await t.run((ctx) =>
      ctx.db
        .query("dogfoodAllowlistAudit")
        .withIndex("by_email", (q) => q.eq("email", "friend@example.com"))
        .collect()
    )
    expect(audit).toEqual([])
    const serializedLogs = JSON.stringify(errorSpy.mock.calls)
    expect(serializedLogs).toContain("administerDogfoodAllowlist")
    expect(serializedLogs).not.toContain("friend@example.com")
    expect(serializedLogs).not.toContain("Operator identity must")
  })

  it("logs sanitized Convex diagnostic context when a dogfood function fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const t = createChatScenario()
    await ensureViewer(t, mayaIdentity)

    const unsafeInput = "https://private.example/friend@example.com?token=secret&api_key=oops"
    await expect(t.withIdentity(mayaIdentity).mutation(api.chat.createChannel, { name: unsafeInput })).rejects.toThrow(
      "Channel names can only use letters, numbers, dashes, and underscores"
    )

    expect(errorSpy).toHaveBeenCalledWith(
      "Dogfood Convex function failed",
      expect.objectContaining({
        operation: "createChannel",
        context: expect.objectContaining({
          nameLength: String(unsafeInput.length),
          visibility: "public"
        }),
        error: "Error: details redacted; use the diagnostic context and timestamp for support"
      })
    )
    const serializedLogs = JSON.stringify(errorSpy.mock.calls)
    expect(serializedLogs).not.toContain(mayaIdentity.email)
    expect(serializedLogs).not.toContain(mayaIdentity.tokenIdentifier)
    expect(serializedLogs).not.toContain("Channel names can only")
    expect(serializedLogs).not.toContain("https://private.example/path?token=secret")
    expect(serializedLogs).not.toContain("secret mutation details")
    expect(serializedLogs).not.toContain("friend@example.com")
    expect(serializedLogs).not.toContain("token=secret")
    expect(serializedLogs).not.toContain("api_key=oops")
  })
})
