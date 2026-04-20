import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"
import type { ProjectDTO, ProjectInvitationDTO } from "@reprojs/shared"
import { eq, sql } from "drizzle-orm"
import { db } from "../../server/db"
import { projectInvitations, user } from "../../server/db/schema"
import { apiFetch, createUser, signIn, truncateDomain } from "../helpers"

setDefaultTimeout(30000)

describe("project invitations API", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("owner can invite a brand-new email — creates invited user row and pending invite", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    const { status, body } = await apiFetch<ProjectInvitationDTO>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "new@example.com", role: "developer" }),
      },
    )

    expect(status).toBe(201)
    const invite = body as ProjectInvitationDTO
    expect(invite.email).toBe("new@example.com")
    expect(invite.role).toBe("developer")
    expect(invite.status).toBe("pending")

    const [invitedUser] = await db.select().from(user).where(eq(user.email, "new@example.com"))
    expect(invitedUser?.status).toBe("invited")

    const rows = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "new@example.com"))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.token).toMatch(/^[0-9a-f]{64}$/)
  })

  test("inviting an already-active user does not create a new user row", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("alice@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "alice@example.com", role: "viewer" }),
    })
    expect(status).toBe(201)

    const rows = await db.select().from(user).where(eq(user.email, "alice@example.com"))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe("active") // untouched
  })

  test("duplicate pending invite for same project+email returns 409", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "bob@example.com", role: "developer" }),
    })
    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "bob@example.com", role: "developer" }),
    })
    expect(status).toBe(409)
  })

  test("inviting an email that is already a project member returns 409", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("member@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    // Add directly via legacy endpoint to prime membership.
    await apiFetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "member@example.com", role: "viewer" }),
    })

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "member@example.com", role: "developer" }),
    })
    expect(status).toBe(409)
  })

  test("domain allowlist blocks invites to off-allowlist domains", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await db.execute(
      sql`UPDATE app_settings SET signup_gated = true, allowed_email_domains = '{"example.com"}'::text[] WHERE id = 1`,
    )

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "outsider@other.com", role: "developer" }),
    })
    expect(status).toBe(400)
  })

  test("non-owner cannot create an invitation", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("viewer@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")
    const viewerCookie = await signIn("viewer@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "viewer@example.com", role: "viewer" }),
    })

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ email: "x@example.com", role: "developer" }),
    })
    expect(status).toBe(403)
  })

  test("owner can list only pending invitations for a project", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "a@example.com", role: "viewer" }),
    })
    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "b@example.com", role: "developer" }),
    })

    const { status, body } = await apiFetch<ProjectInvitationDTO[]>(
      `/api/projects/${projectId}/invitations`,
      { headers: { cookie: ownerCookie } },
    )
    expect(status).toBe(200)
    const list = body as ProjectInvitationDTO[]
    expect(list).toHaveLength(2)
    expect(list.map((i) => i.email).toSorted()).toEqual(["a@example.com", "b@example.com"])
    expect(list.every((i) => i.status === "pending")).toBe(true)
  })

  test("owner can revoke a pending invitation", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    const { body: created } = await apiFetch<ProjectInvitationDTO>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "x@example.com", role: "developer" }),
      },
    )
    const invitationId = (created as ProjectInvitationDTO).id

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations/${invitationId}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    })
    expect(status).toBe(200)

    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, invitationId))
    expect(row?.status).toBe("revoked")
  })
})
