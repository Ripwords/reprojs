import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"
import type { UserDTO } from "@reprokit/shared"
import { apiFetch, createUser, signIn, truncateDomain } from "../helpers"

setDefaultTimeout(30000)

describe("users API", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("GET /api/users requires admin", async () => {
    await createUser("member@example.com", "member")
    const cookie = await signIn("member@example.com")
    const { status } = await apiFetch("/api/users", { headers: { cookie } })
    expect(status).toBe(403)
  })

  test("admin can list users", async () => {
    await createUser("admin@example.com", "admin")
    await createUser("member@example.com", "member")
    const cookie = await signIn("admin@example.com")

    const { status, body } = await apiFetch<UserDTO[]>("/api/users", { headers: { cookie } })
    expect(status).toBe(200)
    expect((body as UserDTO[]).length).toBe(2)
  })

  test("admin can update user role", async () => {
    await createUser("admin@example.com", "admin")
    const memberId = await createUser("member@example.com", "member")
    const cookie = await signIn("admin@example.com")

    const { status, body } = await apiFetch<UserDTO>(`/api/users/${memberId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ role: "admin" }),
    })
    expect(status).toBe(200)
    expect((body as UserDTO).role).toBe("admin")
  })

  test("cannot demote the last admin", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    const { status } = await apiFetch(`/api/users/${adminId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ role: "member" }),
    })
    expect(status).toBe(409)
  })
})
