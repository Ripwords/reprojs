import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"
import type { AppSettingsDTO } from "@feedback-tool/shared"
import { apiFetch, createUser, signIn, truncateDomain } from "../helpers"

setDefaultTimeout(30000)

describe("settings API", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("GET /api/settings requires admin", async () => {
    await createUser("member@example.com", "member")
    const cookie = await signIn("member@example.com")
    const { status } = await apiFetch("/api/settings", { headers: { cookie } })
    expect(status).toBe(403)
  })

  test("admin can get settings", async () => {
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    const { status, body } = await apiFetch<AppSettingsDTO>("/api/settings", {
      headers: { cookie },
    })
    expect(status).toBe(200)
    expect((body as AppSettingsDTO).signupGated).toBe(false)
    expect((body as AppSettingsDTO).installName).toBe("Feedback Tool")
  })

  test("admin can update settings", async () => {
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    const { status, body } = await apiFetch<AppSettingsDTO>("/api/settings", {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ signupGated: true, installName: "My App" }),
    })
    expect(status).toBe(200)
    expect((body as AppSettingsDTO).signupGated).toBe(true)
    expect((body as AppSettingsDTO).installName).toBe("My App")
  })
})
