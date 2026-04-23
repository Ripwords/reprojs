import { setup } from "@nuxt/test-utils/e2e"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { eq } from "drizzle-orm"
import type { AdminOverviewDTO } from "@reprojs/shared"
import { db } from "../../server/db"
import { githubIntegrations, projectMembers, reports } from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  makePngBlob,
  seedProject,
  signIn,
  truncateDomain,
  truncateGithub,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(60000)

async function submitReport(publicKey: string, title: string, origin: string): Promise<string> {
  const fd = new FormData()
  fd.set(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey: publicKey,
          title,
          description: "d",
          context: {
            pageUrl: `${origin}/p`,
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
    headers: { Origin: origin },
    body: fd,
  })
  if (res.status !== 201) throw new Error(`intake failed: ${res.status}`)
  return ((await res.json()) as { id: string }).id
}

describe("GET /api/admin/overview", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateGithub()
    await truncateDomain()
  })

  test("non-admin gets 403 even if they own projects", async () => {
    const memberId = await createUser("member@example.com", "member")
    const projectId = await seedProject({
      name: "Mine",
      publicKey: "rp_pk_OWNER0000000000000000000",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: memberId,
    })
    await db.insert(projectMembers).values({ projectId, userId: memberId, role: "owner" })
    const cookie = await signIn("member@example.com")

    const { status } = await apiFetch("/api/admin/overview", { headers: { cookie } })
    expect(status).toBe(403)
  })

  test("admin gets aggregated counts across all projects", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const pA = await seedProject({
      name: "Alpha",
      publicKey: "rp_pk_ALPHA0000000000000000000",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: adminId,
    })
    const pB = await seedProject({
      name: "Bravo",
      publicKey: "rp_pk_BRAVO0000000000000000000",
      allowedOrigins: ["http://localhost:4001"],
      createdBy: adminId,
    })
    // Seed 2 reports in Alpha, 1 in Bravo — all default to status=open.
    await submitReport("rp_pk_ALPHA0000000000000000000", "a1", "http://localhost:4000")
    await submitReport("rp_pk_ALPHA0000000000000000000", "a2", "http://localhost:4000")
    await submitReport("rp_pk_BRAVO0000000000000000000", "b1", "http://localhost:4001")

    // Attach a connected github integration to Alpha only.
    await db.insert(githubIntegrations).values({
      projectId: pA,
      installationId: 1,
      repoOwner: "acme",
      repoName: "alpha",
      status: "connected",
    })

    const cookie = await signIn("admin@example.com")
    const { status, body } = await apiFetch<AdminOverviewDTO>("/api/admin/overview", {
      headers: { cookie },
    })
    expect(status).toBe(200)
    expect(body.counts.total).toBe(3)
    expect(body.counts.byStatus.open).toBe(3)
    expect(body.counts.last7Days).toBe(3)
    expect(body.projects.total).toBe(2)
    expect(body.projects.withGithub).toBe(1)

    // recentReports: newest-first across projects
    expect(body.recentReports.length).toBe(3)
    expect(body.recentReports[0]?.title).toBe("b1")
    expect(body.recentReports[0]?.projectId).toBe(pB)
    expect(body.recentReports[0]?.projectName).toBe("Bravo")

    // perProject: sorted by openCount desc, then name asc. Alpha has 2 open, Bravo 1.
    expect(body.perProject.map((p) => p.name)).toEqual(["Alpha", "Bravo"])
    expect(body.perProject[0]).toMatchObject({
      id: pA,
      name: "Alpha",
      openCount: 2,
      totalCount: 2,
    })
    expect(body.perProject[1]).toMatchObject({
      id: pB,
      name: "Bravo",
      openCount: 1,
      totalCount: 1,
    })
  })

  test("admin gets empty shape on empty install", async () => {
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    const { status, body } = await apiFetch<AdminOverviewDTO>("/api/admin/overview", {
      headers: { cookie },
    })
    expect(status).toBe(200)
    expect(body.counts.total).toBe(0)
    expect(body.counts.last7Days).toBe(0)
    expect(body.projects.total).toBe(0)
    expect(body.projects.withGithub).toBe(0)
    expect(body.recentReports).toEqual([])
    expect(body.recentEvents).toEqual([])
    expect(body.perProject).toEqual([])
  })

  test("recentReports caps at 10", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Big",
      publicKey: "rp_pk_BIGGGG000000000000000000",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: adminId,
    })
    // Seed 12 reports directly via Drizzle to bypass the intake rate-limiter.
    // The admin overview endpoint just reads from the reports table; going
    // through the intake is orthogonal for this cap-check.
    const now = Date.now()
    await db.insert(reports).values(
      Array.from({ length: 12 }, (_, i) => ({
        projectId,
        title: `r${i}`,
        description: null,
        context: {
          pageUrl: "http://localhost:4000/p",
          userAgent: "UA",
          viewport: { w: 1000, h: 800 },
          timestamp: new Date(now + i).toISOString(),
        },
        // Space createdAt by 1ms per row so ordering is deterministic.
        createdAt: new Date(now + i),
      })),
    )
    const cookie = await signIn("admin@example.com")
    const { body } = await apiFetch<AdminOverviewDTO>("/api/admin/overview", {
      headers: { cookie },
    })
    expect(body.recentReports.length).toBe(10)
    expect(body.counts.total).toBe(12)
  })

  // Appease unused-import linter without removing the helper for future tests.
  void eq
})
