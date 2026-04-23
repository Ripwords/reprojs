import { setup } from "@nuxt/test-utils/e2e"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import { githubIntegrations, projectMembers, reports } from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  seedProject,
  signIn,
  truncateDomain,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })

setDefaultTimeout(60000)

const PK = "rp_pk_MANAGER00000000000000000"
const ORIGIN = "http://localhost:4000"

/**
 * Seed a report directly via Drizzle. We bypass the intake endpoint to avoid
 * sharing rate-limit state with other test files — the intake has per-origin
 * rate limiting and this file's reports would otherwise starve the suite.
 * The permission boundary under test is authenticated-session-only, so the
 * intake path isn't on the critical path here.
 */
async function seedReport(projectId: string, title: string): Promise<string> {
  const [row] = await db
    .insert(reports)
    .values({
      projectId,
      title,
      description: "d",
      context: {
        pageUrl: "http://localhost:4000/p",
        userAgent: "UA",
        viewport: { w: 1000, h: 800 },
        timestamp: new Date().toISOString(),
      },
    })
    .returning({ id: reports.id })
  if (!row) throw new Error("seedReport: insert returned no row")
  return row.id
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
    const reportId = await seedReport(projectId, "to triage")
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
    const r1 = await seedReport(projectId, "one")
    const r2 = await seedReport(projectId, "two")
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
    const reportId = await seedReport(projectId, "assign me")
    const { userId: managerId, cookie } = await seedMemberAtRole(
      "manager@example.com",
      projectId,
      "manager",
    )

    const { status } = await apiFetch(`/api/projects/${projectId}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ assigneeIds: [managerId] }),
    })
    expect(status).toBe(200)
  })

  test("manager can POST github-sync on a linked project", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    await db.insert(githubIntegrations).values({
      projectId,
      installationId: 42,
      repoOwner: "acme",
      repoName: "app",
    })
    const reportId = await seedReport(projectId, "sync me")
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(
      `/api/projects/${projectId}/reports/${reportId}/github-sync`,
      { method: "POST", headers: { cookie } },
    )
    expect(status).toBe(200)
  })

  test("manager can POST github-unlink on an unlinked report (no-op 200)", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await seedReport(projectId, "unlink me")
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(
      `/api/projects/${projectId}/reports/${reportId}/github-unlink`,
      { method: "POST", headers: { cookie } },
    )
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
    const reportId = await seedReport(projectId, "untouchable")
    const { cookie } = await seedMemberAtRole("viewer@example.com", projectId, "viewer")

    const { status } = await apiFetch(`/api/projects/${projectId}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ status: "in_progress" }),
    })
    expect(status).toBe(403)
  })
})

// `eq` is imported from drizzle-orm but not used directly in this file yet —
// kept for future DB-state assertions.
void eq
