import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"
import type { ProjectDTO, ProjectMemberDTO } from "@repro/shared"
import { apiFetch, createUser, signIn, truncateDomain } from "../helpers"

setDefaultTimeout(30000)

describe("project members API", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("owner can add, list, update, and remove a member", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("member@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")

    // Create project as admin (effectiveRole owner)
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    // Add member
    const { status: addStatus, body: added } = await apiFetch<ProjectMemberDTO>(
      `/api/projects/${projectId}/members`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "member@example.com", role: "viewer" }),
      },
    )
    expect(addStatus).toBe(200)
    expect((added as ProjectMemberDTO).role).toBe("viewer")

    // List members
    const { body: members } = await apiFetch<ProjectMemberDTO[]>(
      `/api/projects/${projectId}/members`,
      { headers: { cookie: ownerCookie } },
    )
    // Admin is implicit owner, member is viewer. Non-admin members are listed.
    expect((members as ProjectMemberDTO[]).length).toBe(1)
    expect((members as ProjectMemberDTO[])[0].email).toBe("member@example.com")

    // Update member role
    const memberId = (added as ProjectMemberDTO).userId
    const { status: updateStatus } = await apiFetch(
      `/api/projects/${projectId}/members/${memberId}`,
      {
        method: "PATCH",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ role: "developer" }),
      },
    )
    expect(updateStatus).toBe(200)

    // Remove member
    const { status: deleteStatus } = await apiFetch(
      `/api/projects/${projectId}/members/${memberId}`,
      { method: "DELETE", headers: { cookie: ownerCookie } },
    )
    expect(deleteStatus).toBe(200)

    const { body: afterRemove } = await apiFetch<ProjectMemberDTO[]>(
      `/api/projects/${projectId}/members`,
      { headers: { cookie: ownerCookie } },
    )
    expect((afterRemove as ProjectMemberDTO[]).length).toBe(0)
  })

  test("cannot remove last owner from project", async () => {
    await createUser("owner@example.com", "member")
    await createUser("other@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id
    const ownerId = (project as ProjectDTO).createdBy

    // Add other user as owner
    await apiFetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "other@example.com", role: "owner" }),
    })

    // Remove "other" leaving only original owner — should succeed
    // (we have 2 owners now, so removing one is OK)
    // Try to remove original owner when only 1 owner left
    // First remove the other owner
    const { body: members } = await apiFetch<ProjectMemberDTO[]>(
      `/api/projects/${projectId}/members`,
      { headers: { cookie: ownerCookie } },
    )
    const otherMember = (members as ProjectMemberDTO[]).find((m) => m.email === "other@example.com")

    await apiFetch(`/api/projects/${projectId}/members/${otherMember?.userId}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    })

    // Now try to remove original owner (last owner)
    const { status } = await apiFetch(`/api/projects/${projectId}/members/${ownerId}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    })
    expect(status).toBe(409)
  })
})
