import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"

setDefaultTimeout(30000)
import type { ProjectDTO } from "@feedback-tool/shared"
import { apiFetch, createUser, signIn, truncateDomain } from "../helpers"

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

describe("projects API", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("POST /api/projects requires auth", async () => {
    const { status } = await apiFetch("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
    })
    expect(status).toBe(401)
  })

  test("admin can create, list, and delete a project", async () => {
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    const { status: createStatus, body: created } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ name: "My Project" }),
    })
    expect(createStatus).toBe(200)
    expect((created as ProjectDTO).name).toBe("My Project")
    expect((created as ProjectDTO).slug).toBe("my-project")
    expect((created as ProjectDTO).effectiveRole).toBe("owner")

    const { body: list } = await apiFetch<ProjectDTO[]>("/api/projects", {
      headers: { cookie },
    })
    expect((list as ProjectDTO[]).length).toBe(1)

    await apiFetch(`/api/projects/${(created as ProjectDTO).id}`, {
      method: "DELETE",
      headers: { cookie },
    })

    const { body: afterDelete } = await apiFetch<ProjectDTO[]>("/api/projects", {
      headers: { cookie },
    })
    expect((afterDelete as ProjectDTO[]).length).toBe(0)
  })

  test("non-admin member only sees projects they belong to", async () => {
    await createUser("admin@example.com", "admin")
    await createUser("member@example.com", "member")
    const adminCookie = await signIn("admin@example.com")
    const memberCookie = await signIn("member@example.com")

    await apiFetch("/api/projects", {
      method: "POST",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ name: "Admin Only" }),
    })

    const { body: memberList } = await apiFetch<ProjectDTO[]>("/api/projects", {
      headers: { cookie: memberCookie },
    })
    expect((memberList as ProjectDTO[]).length).toBe(0)
  })
})
