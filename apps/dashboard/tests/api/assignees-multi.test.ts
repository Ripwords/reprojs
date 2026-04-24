import { setup } from "../nuxt-setup"
import { describe, test, expect, beforeEach, setDefaultTimeout } from "bun:test"
import { eq } from "drizzle-orm"
import {
  apiFetch,
  signIn,
  truncateDomain,
  truncateGithub,
  truncateReports,
  createUser,
  seedProject,
} from "../helpers"
import { db } from "../../server/db"
import { reports } from "../../server/db/schema/reports"
import { reportAssignees } from "../../server/db/schema/report-assignees"
import { projectMembers } from "../../server/db/schema/project-members"
import { githubIntegrations } from "../../server/db/schema/github-integrations"

await setup({ server: true, port: 3000, host: "localhost" })

setDefaultTimeout(60000)

// Assignees are GitHub logins now — these tests exercise the `{assignees: []}`
// contract against a linked report on a connected project. The
// "not linked / not connected → 409" paths are covered separately below.
async function seedLinkedProject(
  ownerEmail: string,
): Promise<{ projectId: string; cookie: string; ownerId: string }> {
  await truncateDomain()
  await truncateReports()
  await truncateGithub()
  const ownerId = await createUser(ownerEmail, "member")
  const cookie = await signIn(ownerEmail)
  const projectId = await seedProject({
    name: "assignees-multi-test",
    publicKey: `rp_pk_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    createdBy: ownerId,
  })
  await db.insert(projectMembers).values({ projectId, userId: ownerId, role: "owner" })
  await db.insert(githubIntegrations).values({
    projectId,
    installationId: 42,
    repoOwner: "acme",
    repoName: "widgets",
    status: "connected",
    pushOnEdit: true,
    autoCreateOnIntake: true,
  })
  return { projectId, cookie, ownerId }
}

async function seedLinkedReport(projectId: string): Promise<string> {
  const [r] = await db
    .insert(reports)
    .values({
      projectId,
      title: "t",
      description: "d",
      status: "open",
      priority: "normal",
      tags: [],
      githubIssueNumber: 101,
      githubIssueUrl: "https://github.com/acme/widgets/issues/101",
    })
    .returning()
  if (!r) throw new Error("no report inserted")
  return r.id
}

describe("multi-assignee — github logins", () => {
  beforeEach(async () => {
    await truncateDomain()
    await truncateReports()
    await truncateGithub()
  })

  test("PATCH with assignees=[a,b] persists both logins", async () => {
    const { projectId, cookie } = await seedLinkedProject("owner@x.com")
    const reportId = await seedLinkedReport(projectId)

    const res = await apiFetch(`/api/projects/${projectId}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ assignees: ["alice", "bob"] }),
    })
    expect(res.status).toBe(200)

    const rows = await db
      .select()
      .from(reportAssignees)
      .where(eq(reportAssignees.reportId, reportId))
    expect(rows.map((x) => x.githubLogin).toSorted()).toEqual(["alice", "bob"])
  })

  test("setting assignees=[] clears all assignees", async () => {
    const { projectId, cookie } = await seedLinkedProject("owner2@x.com")
    const reportId = await seedLinkedReport(projectId)
    await db.insert(reportAssignees).values({ reportId, githubLogin: "alice" })

    const res = await apiFetch(`/api/projects/${projectId}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ assignees: [] }),
    })
    expect(res.status).toBe(200)

    const rows = await db
      .select()
      .from(reportAssignees)
      .where(eq(reportAssignees.reportId, reportId))
    expect(rows).toEqual([])
  })

  test("returns 409 when the report is not linked to a GitHub issue", async () => {
    const { projectId, cookie } = await seedLinkedProject("owner3@x.com")
    // Unlinked: no githubIssueNumber.
    const [r] = await db
      .insert(reports)
      .values({
        projectId,
        title: "t",
        description: "d",
        status: "open",
        priority: "normal",
        tags: [],
      })
      .returning()
    if (!r) throw new Error("no report inserted")

    const res = await apiFetch(`/api/projects/${projectId}/reports/${r.id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ assignees: ["alice"] }),
    })
    expect(res.status).toBe(409)
  })

  test("returns 409 when the project has no connected GitHub integration", async () => {
    await truncateDomain()
    await truncateReports()
    await truncateGithub()
    const ownerId = await createUser("owner4@x.com", "member")
    const cookie = await signIn("owner4@x.com")
    const projectId = await seedProject({
      name: "no-github",
      publicKey: `rp_pk_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
      createdBy: ownerId,
    })
    await db.insert(projectMembers).values({ projectId, userId: ownerId, role: "owner" })
    // No githubIntegrations row.
    const [r] = await db
      .insert(reports)
      .values({
        projectId,
        title: "t",
        description: "d",
        status: "open",
        priority: "normal",
        tags: [],
        githubIssueNumber: 5,
        githubIssueUrl: "https://github.com/acme/x/issues/5",
      })
      .returning()
    if (!r) throw new Error("no report inserted")

    const res = await apiFetch(`/api/projects/${projectId}/reports/${r.id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ assignees: ["alice"] }),
    })
    expect(res.status).toBe(409)
  })

  test("more than 10 assignees is rejected", async () => {
    const { projectId, cookie } = await seedLinkedProject("owner5@x.com")
    const reportId = await seedLinkedReport(projectId)
    const res = await apiFetch(`/api/projects/${projectId}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ assignees: Array.from({ length: 11 }, (_, i) => `u-${i}`) }),
    })
    expect(res.status).toBe(400)
  })
})
