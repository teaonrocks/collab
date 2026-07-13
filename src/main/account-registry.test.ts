import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import { createAccountRegistry } from "./account-registry"

const directories: Array<string> = []

const makeRegistry = async () => {
  const directory = await mkdtemp(join(tmpdir(), "aether-account-registry-"))
  directories.push(directory)
  const path = join(directory, "accounts.json")
  let timestamp = 100
  const registry = createAccountRegistry(path, () => ++timestamp)
  await registry.initialize()
  return { path, registry }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("account registry", () => {
  it("starts with a default account and persists only display metadata", async () => {
    const { path, registry } = await makeRegistry()

    expect(registry.preferredAccountId()).toBe("default")
    await registry.updateProfile("default", {
      userId: "user-1",
      displayName: "Maya Patel",
      email: "maya@example.com",
      avatarUrl: null
    })

    expect(registry.context("window-1", "default")).toEqual({
      windowId: "window-1",
      currentAccountId: "default",
      accounts: [{
        id: "default",
        displayName: "Maya Patel",
        email: "maya@example.com",
        avatarUrl: null,
        current: true
      }]
    })
    expect(await readFile(path, "utf8")).not.toContain("refresh")
  })

  it("keeps accounts signed in across registry reloads", async () => {
    const { path, registry } = await makeRegistry()
    const secondAccountId = await registry.create()
    await registry.updateProfile(secondAccountId, {
      userId: "user-2",
      displayName: "Archer",
      email: "archer@example.com",
      avatarUrl: "https://example.com/avatar.png"
    })

    const reloaded = createAccountRegistry(path, () => 500)
    await reloaded.initialize()

    expect(reloaded.has(secondAccountId)).toBe(true)
    expect(reloaded.context("window-2", secondAccountId).accounts).toContainEqual({
      id: secondAccountId,
      displayName: "Archer",
      email: "archer@example.com",
      avatarUrl: "https://example.com/avatar.png",
      current: true
    })
  })

  it("keeps an account addition ephemeral until authentication succeeds", async () => {
    const { path, registry } = await makeRegistry()

    const pendingAccountId = await registry.create()

    expect(registry.isPending(pendingAccountId)).toBe(true)
    expect(registry.has(pendingAccountId)).toBe(true)
    expect(await readFile(path, "utf8")).not.toContain(pendingAccountId)

    const reloaded = createAccountRegistry(path, () => 500)
    await reloaded.initialize()
    expect(reloaded.has(pendingAccountId)).toBe(false)
  })

  it("persists a pending account after authentication supplies its profile", async () => {
    const { path, registry } = await makeRegistry()
    const pendingAccountId = await registry.create()

    await registry.updateProfile(pendingAccountId, {
      userId: "user-2",
      displayName: "Archer",
      email: "archer@example.com",
      avatarUrl: null
    })

    expect(registry.isPending(pendingAccountId)).toBe(false)
    expect(await readFile(path, "utf8")).toContain(pendingAccountId)
  })

  it("deduplicates the same WorkOS user in favor of the newly authenticated partition", async () => {
    const { registry } = await makeRegistry()
    await registry.updateProfile("default", {
      userId: "user-1",
      displayName: "Maya",
      email: "maya@example.com",
      avatarUrl: null
    })
    const secondAccountId = await registry.create()

    await expect(registry.updateProfile(secondAccountId, {
      userId: "user-1",
      displayName: "Maya Patel",
      email: "maya@example.com",
      avatarUrl: null
    })).resolves.toBe("default")
    expect(registry.has("default")).toBe(false)
    expect(registry.has(secondAccountId)).toBe(true)
  })

  it("recovers from malformed registry data", async () => {
    const { path } = await makeRegistry()
    await writeFile(path, "not json", "utf8")
    const registry = createAccountRegistry(path)

    await registry.initialize()

    expect(registry.accountIds()).toEqual(["default"])
  })
})
