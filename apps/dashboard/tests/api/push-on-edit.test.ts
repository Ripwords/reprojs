// apps/dashboard/tests/api/push-on-edit.test.ts
// Tests for the push_on_edit conditional enqueue in the PATCH report handler.
import { setup } from "@nuxt/test-utils/e2e"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(60000)
import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import { githubIntegrations, projectMembers, reports, reportSyncJobs } from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  seedProject,
  signIn,
  truncateDomain,
  truncateGithub,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })

const PK = "rp_pk_PUSHONEDIT1234567890ab"
const ORIGIN = "http://localhost:4000"

async function seedLinkedProject(opts: { pushOnEdit: boolean }) {
  const ownerId = await createUser("owner@example.com", "admin")
  const pid = await seedProject({
    name: "push-on-edit-test",
    publicKey: PK,
    allowedOrigins: [ORIGIN],
    createdBy: ownerId,
  })
  await db.insert(githubIntegrations).values({
    projectId: pid,
    installationId: 10,
    repoOwner: "acme",
    repoName: "frontend",
    pushOnEdit: opts.pushOnEdit,
    status: "connected",
  })
  await db.insert(projectMembers).values({ projectId: pid, userId: ownerId, role: "owner" })

  const [r] = await db
    .insert(reports)
    .values({
      projectId: pid,
      title: "Linked report",
      description: "test",
      context: {
        pageUrl: "http://example.com",
        userAgent: "UA",
        viewport: { w: 1, h: 1 },
        timestamp: new Date().toISOString(),
      },
      githubIssueNumber: 99,
      githubIssueNodeId: "NODE_99",
      githubIssueUrl: "https://github.com/acme/frontend/issues/99",
    })
    .returning()

  return { pid, reportId: r.id, ownerId }
}

async function seedUnlinkedProject() {
  const ownerId = await createUser("owner@example.com", "admin")
  const pid = await seedProject({
    name: "push-on-edit-unlinked",
    publicKey: PK,
    allowedOrigins: [ORIGIN],
    createdBy: ownerId,
  })
  await db.insert(githubIntegrations).values({
    projectId: pid,
    installationId: 10,
    repoOwner: "acme",
    repoName: "frontend",
    pushOnEdit: true,
    status: "connected",
  })
  await db.insert(projectMembers).values({ projectId: pid, userId: ownerId, role: "owner" })

  const [r] = await db
    .insert(reports)
    .values({
      projectId: pid,
      title: "Unlinked report",
      description: "test",
      context: {
        pageUrl: "http://example.com",
        userAgent: "UA",
        viewport: { w: 1, h: 1 },
        timestamp: new Date().toISOString(),
      },
      // No githubIssueNumber — unlinked
    })
    .returning()

  return { pid, reportId: r.id, ownerId }
}

describe("PATCH report — push_on_edit enqueue behavior", () => {
  afterEach(async () => {
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("PATCH on linked ticket with push_on_edit=true enqueues one pending sync job", async () => {
    const { pid, reportId } = await seedLinkedProject({ pushOnEdit: true })
    const cookie = await signIn("owner@example.com")

    const { status } = await apiFetch(`/api/projects/${pid}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie },
      body: { priority: "high" },
    })
    expect(status).toBe(200)

    const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, reportId))
    expect(jobs.length).toBe(1)
    expect(jobs[0]?.state).toBe("pending")
  })

  test("PATCH on linked ticket with push_on_edit=false does NOT enqueue", async () => {
    const { pid, reportId } = await seedLinkedProject({ pushOnEdit: false })
    const cookie = await signIn("owner@example.com")

    await apiFetch(`/api/projects/${pid}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie },
      body: { priority: "high" },
    })

    const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, reportId))
    expect(jobs.length).toBe(0)
  })

  test("PATCH on unlinked ticket does NOT enqueue even with push_on_edit=true", async () => {
    const { pid, reportId } = await seedUnlinkedProject()
    const cookie = await signIn("owner@example.com")

    await apiFetch(`/api/projects/${pid}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie },
      body: { priority: "high" },
    })

    const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, reportId))
    expect(jobs.length).toBe(0)
  })
})
