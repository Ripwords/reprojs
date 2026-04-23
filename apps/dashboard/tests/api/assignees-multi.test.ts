import { setup } from "@nuxt/test-utils/e2e"
import { describe, test, expect, beforeEach, setDefaultTimeout } from "bun:test"
import { eq } from "drizzle-orm"
import {
  apiFetch,
  signIn,
  truncateDomain,
  truncateReports,
  createUser,
  seedProject,
} from "../helpers"
import { db } from "../../server/db"
import { reports } from "../../server/db/schema/reports"
import { reportAssignees } from "../../server/db/schema/report-assignees"
import { projectMembers } from "../../server/db/schema/project-members"

await setup({ server: true, port: 3000, host: "localhost" })

setDefaultTimeout(60000)

async function seedProjectWithRoles(args: {
  ownerEmail: string
  members: Array<{ email: string; role: "owner" | "developer" | "manager" | "viewer" }>
}): Promise<{ projectId: string; cookie: string; userIds: Record<string, string> }> {
  await truncateDomain()
  await truncateReports()
  const ownerId = await createUser(args.ownerEmail, "member")
  const cookie = await signIn(args.ownerEmail)
  const projectId = await seedProject({
    name: "multi-assignee-test",
    publicKey: `rp_pk_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    createdBy: ownerId,
  })
  await db.insert(projectMembers).values({ projectId, userId: ownerId, role: "owner" })

  const userIds: Record<string, string> = { [args.ownerEmail]: ownerId }
  const memberEntries = await Promise.all(
    args.members.map(async (m) => {
      const uid = await createUser(m.email, "member")
      return { email: m.email, uid, role: m.role }
    }),
  )
  if (memberEntries.length > 0) {
    await db
      .insert(projectMembers)
      .values(memberEntries.map((e) => ({ projectId, userId: e.uid, role: e.role })))
  }
  for (const e of memberEntries) {
    userIds[e.email] = e.uid
  }
  return { projectId, cookie, userIds }
}

describe("multi-assignee (phase 0)", () => {
  beforeEach(async () => {
    await truncateDomain()
    await truncateReports()
  })

  test("PATCH with assigneeIds=[a,b] persists both rows", async () => {
    const { projectId, cookie, userIds } = await seedProjectWithRoles({
      ownerEmail: "owner@x.com",
      members: [
        { email: "a@x.com", role: "developer" },
        { email: "b@x.com", role: "developer" },
      ],
    })
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
      body: JSON.stringify({ assigneeIds: [userIds["a@x.com"], userIds["b@x.com"]] }),
    })
    expect(res.status).toBe(200)

    const rows = await db.select().from(reportAssignees).where(eq(reportAssignees.reportId, r.id))
    expect(rows.map((x) => x.userId).toSorted()).toEqual(
      [userIds["a@x.com"], userIds["b@x.com"]].toSorted(),
    )
  })

  test("setting assigneeIds=[] clears all assignees", async () => {
    const { projectId, cookie, userIds } = await seedProjectWithRoles({
      ownerEmail: "owner2@x.com",
      members: [{ email: "a2@x.com", role: "developer" }],
    })
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
    await db.insert(reportAssignees).values({ reportId: r.id, userId: userIds["a2@x.com"] })

    await apiFetch(`/api/projects/${projectId}/reports/${r.id}`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ assigneeIds: [] }),
    })

    const rows = await db.select().from(reportAssignees).where(eq(reportAssignees.reportId, r.id))
    expect(rows).toEqual([])
  })

  test("refuses assigning a viewer", async () => {
    const { projectId, cookie, userIds } = await seedProjectWithRoles({
      ownerEmail: "owner3@x.com",
      members: [{ email: "v@x.com", role: "viewer" }],
    })
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
      body: JSON.stringify({ assigneeIds: [userIds["v@x.com"]] }),
    })
    expect(res.status).toBe(400)
  })

  test("more than 10 assignees is rejected", async () => {
    const { projectId, cookie } = await seedProjectWithRoles({
      ownerEmail: "owner4@x.com",
      members: [],
    })
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
      body: JSON.stringify({ assigneeIds: Array.from({ length: 11 }, (_, i) => `u-${i}`) }),
    })
    expect(res.status).toBe(400)
  })
})
