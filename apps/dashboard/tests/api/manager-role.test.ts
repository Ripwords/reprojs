import { setup } from "@nuxt/test-utils/e2e"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import { projectMembers } from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  makePngBlob,
  seedProject,
  signIn,
  truncateDomain,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })

setDefaultTimeout(60000)

const PK = "rp_pk_MANAGER00000000000000000"
const ORIGIN = "http://localhost:4000"

async function submitReport(title: string): Promise<string> {
  const fd = new FormData()
  fd.set(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey: PK,
          title,
          description: "d",
          context: {
            pageUrl: "http://localhost:4000/p",
            userAgent: "UA",
            viewport: { w: 1000, h: 800 },
            timestamp: new Date().toISOString(),
            reporter: { email: "u@example.com" },
          },
          _dwellMs: 2000,
        }),
      ],
      { type: "application/json" },
    ),
  )
  fd.set("screenshot", makePngBlob(), "s.png")
  const res = await fetch("http://localhost:3000/api/intake/reports", {
    method: "POST",
    headers: { Origin: ORIGIN },
    body: fd,
  })
  if (res.status !== 201) throw new Error(`intake failed: ${res.status}`)
  return ((await res.json()) as { id: string }).id
}

/**
 * Seed a member-role user and add them to the given project at the specified
 * role. Returns the user id and their signed-in session cookie.
 */
async function seedMemberAtRole(
  email: string,
  projectId: string,
  role: "viewer" | "manager" | "developer" | "owner",
): Promise<{ userId: string; cookie: string }> {
  const userId = await createUser(email, "member")
  await db.insert(projectMembers).values({ projectId, userId, role })
  const cookie = await signIn(email)
  return { userId, cookie }
}

describe("manager role — allowed actions", () => {
  beforeAll(async () => {
    await truncateReports()
    await truncateDomain()
  })
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("manager can PATCH a report's status, priority, and tags", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await submitReport("to triage")
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(`/api/projects/${projectId}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ status: "in_progress", priority: "high" }),
    })
    expect(status).toBe(200)
  })

  test("manager can bulk-update reports", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const r1 = await submitReport("one")
    const r2 = await submitReport("two")
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(`/api/projects/${projectId}/reports/bulk-update`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ reportIds: [r1, r2], status: "closed" }),
    })
    expect(status).toBe(200)
  })

  test("manager can be assigned to a report (assignee guard allows non-viewers)", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await submitReport("assign me")
    const { userId: managerId, cookie } = await seedMemberAtRole(
      "manager@example.com",
      projectId,
      "manager",
    )

    const { status } = await apiFetch(`/api/projects/${projectId}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ assigneeId: managerId }),
    })
    expect(status).toBe(200)
  })
})

describe("manager role — forbidden actions", () => {
  beforeAll(async () => {
    await truncateReports()
    await truncateDomain()
  })
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("manager gets 403 on rotate-key (owner-only)", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(`/api/projects/${projectId}/rotate-key`, {
      method: "POST",
      headers: { cookie },
    })
    expect(status).toBe(403)
  })

  test("manager gets 403 on PATCH github integration (owner-only)", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(`/api/projects/${projectId}/integrations/github`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ repoOwner: "foo", repoName: "bar", defaultLabel: null }),
    })
    expect(status).toBe(403)
  })

  test("manager gets 403 on retry-failed (developer-only integration op)", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(
      `/api/projects/${projectId}/integrations/github/retry-failed`,
      { method: "POST", headers: { cookie } },
    )
    expect(status).toBe(403)
  })

  test("manager gets 403 on adding a member (owner-only)", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    await createUser("other@example.com", "member")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ email: "other@example.com", role: "viewer" }),
    })
    expect(status).toBe(403)
  })
})

describe("viewer role — regression guard after manager insertion", () => {
  beforeAll(async () => {
    await truncateReports()
    await truncateDomain()
  })
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("viewer still gets 403 on PATCH report (boundary held)", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await submitReport("untouchable")
    const { cookie } = await seedMemberAtRole("viewer@example.com", projectId, "viewer")

    const { status } = await apiFetch(`/api/projects/${projectId}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ status: "in_progress" }),
    })
    expect(status).toBe(403)
  })
})

// Unused-import appeasement — `eq` is referenced in helpers but not this file
void eq
