// apps/dashboard/tests/api/inbox.test.ts
import { setup } from "@nuxt/test-utils/e2e"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(30000)
import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import {
  apiFetch,
  createUser,
  seedProject,
  signIn,
  truncateDomain,
  truncateReports,
} from "../helpers"
import { db } from "../../server/db"
import { projectMembers, reportEvents, reports } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })

const PK = "ft_pk_INBX1234567890abcdef1234"
const ORIGIN = "http://localhost:4000"

async function seedReport(
  projectId: string,
  overrides: Partial<typeof reports.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(reports)
    .values({
      projectId,
      title: overrides.title ?? "Seed report",
      description: overrides.description ?? null,
      context:
        overrides.context ??
        ({
          pageUrl: "http://localhost:4000/p",
          userAgent: "UA",
          viewport: { w: 1000, h: 800 },
          timestamp: new Date().toISOString(),
        } as (typeof reports.$inferInsert)["context"]),
      status: overrides.status ?? "open",
      priority: overrides.priority ?? "normal",
      tags: overrides.tags ?? [],
      assigneeId: overrides.assigneeId ?? null,
    })
    .returning({ id: reports.id })
  return row?.id
}

async function addMember(projectId: string, userId: string, role: "developer" | "viewer") {
  await db.insert(projectMembers).values({ projectId, userId, role })
}

describe("ticket inbox API", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("list filters by status CSV", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { status: "open" })
    await seedReport(pid, { status: "open" })
    await seedReport(pid, { status: "in_progress" })
    await seedReport(pid, { status: "closed" })
    const cookie = await signIn("owner@example.com")
    const { status, body } = await apiFetch<{ items: Array<{ status: string }>; total: number }>(
      `/api/projects/${pid}/reports?status=open,in_progress`,
      { headers: { cookie } },
    )
    expect(status).toBe(200)
    expect(body.total).toBe(3)
    expect(new Set(body.items.map((i) => i.status))).toEqual(new Set(["open", "in_progress"]))
  })

  test("list filters by assignee=me", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { assigneeId: owner })
    await seedReport(pid, { assigneeId: null })
    const cookie = await signIn("owner@example.com")
    const { status, body } = await apiFetch<{
      items: Array<{ assignee: { id: string } | null }>
    }>(`/api/projects/${pid}/reports?assignee=me`, { headers: { cookie } })
    expect(status).toBe(200)
    expect(body.items.length).toBe(1)
    expect(body.items[0]?.assignee?.id).toBe(owner)
  })

  test("list filters by tag AND semantics", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { tags: ["mobile", "ios"] })
    await seedReport(pid, { tags: ["mobile"] })
    await seedReport(pid, { tags: ["ios"] })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{ items: Array<{ tags: string[] }>; total: number }>(
      `/api/projects/${pid}/reports?tag=mobile,ios`,
      { headers: { cookie } },
    )
    expect(body.total).toBe(1)
    expect([...(body.items[0]?.tags ?? [])].toSorted()).toEqual(["ios", "mobile"])
  })

  test("text search is case-insensitive on title and description", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { title: "Checkout crash on Safari" })
    await seedReport(pid, { description: "the CHECKOUT is slow" })
    await seedReport(pid, { title: "Unrelated" })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{ total: number }>(`/api/projects/${pid}/reports?q=checkout`, {
      headers: { cookie },
    })
    expect(body.total).toBe(2)
  })

  test("facet counts reflect current filter set", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { status: "open", priority: "high" })
    await seedReport(pid, { status: "open", priority: "low" })
    await seedReport(pid, { status: "closed", priority: "high" })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{
      facets: { priority: Record<string, number>; status: Record<string, number> }
    }>(`/api/projects/${pid}/reports?status=open`, { headers: { cookie } })
    expect(body.facets.priority.high).toBe(1)
    expect(body.facets.priority.low).toBe(1)
    expect(body.facets.status.open).toBe(2)
    expect(body.facets.status.closed).toBe(0)
  })

  test("PATCH single field emits exactly one event", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const rid = await seedReport(pid)
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { status: "in_progress" },
    })
    expect(status).toBe(200)
    const evs = await db.select().from(reportEvents).where(eq(reportEvents.reportId, rid))
    expect(evs.length).toBe(1)
    expect(evs[0]?.kind).toBe("status_changed")
  })

  test("PATCH multiple fields emits one event per changed field", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const dev = await createUser("dev@example.com", "member")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    // dev must be a project member with developer role to be a valid assignee
    await addMember(pid, dev, "developer")
    const rid = await seedReport(pid)
    const cookie = await signIn("owner@example.com")
    await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { status: "in_progress", priority: "high", assigneeId: dev },
    })
    const evs = await db.select().from(reportEvents).where(eq(reportEvents.reportId, rid))
    expect(evs.length).toBe(3)
    expect(new Set(evs.map((e) => e.kind))).toEqual(
      new Set(["status_changed", "priority_changed", "assignee_changed"]),
    )
  })

  test("PATCH tags diffs into per-add/per-remove events", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const rid = await seedReport(pid, { tags: ["a", "b"] })
    const cookie = await signIn("owner@example.com")
    await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { tags: ["a", "c"] },
    })
    const evs = await db.select().from(reportEvents).where(eq(reportEvents.reportId, rid))
    const kinds = evs.map((e) => e.kind).toSorted()
    expect(kinds).toEqual(["tag_added", "tag_removed"])
  })

  test("bulk-update returns only reports that actually changed", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const r1 = await seedReport(pid, { status: "open" })
    const r2 = await seedReport(pid, { status: "open" })
    const r3 = await seedReport(pid, { status: "resolved" })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{ updated: string[] }>(
      `/api/projects/${pid}/reports/bulk-update`,
      {
        method: "POST",
        headers: { cookie },
        body: { reportIds: [r1, r2, r3], status: "resolved" },
      },
    )
    expect([...body.updated].toSorted()).toEqual([r1, r2].toSorted())
  })

  test("viewer cannot PATCH", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const viewer = await createUser("viewer@example.com", "member")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await addMember(pid, viewer, "viewer")
    const rid = await seedReport(pid)
    const cookie = await signIn("viewer@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { status: "closed" },
    })
    expect(status).toBe(403)
    const [current] = await db.select().from(reports).where(eq(reports.id, rid))
    expect(current?.status).toBe("open")
  })

  test("assigning to a viewer is rejected", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const viewer = await createUser("viewer@example.com", "member")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await addMember(pid, viewer, "viewer")
    const rid = await seedReport(pid)
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { assigneeId: viewer },
    })
    expect(status).toBe(400)
  })

  test("events feed returns actor-embedded DTOs in reverse-chrono", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const rid = await seedReport(pid)
    const cookie = await signIn("owner@example.com")
    await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { status: "in_progress" },
    })
    await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { priority: "high" },
    })
    const { body } = await apiFetch<{
      items: Array<{ kind: string; actor: { email: string } | null }>
    }>(`/api/projects/${pid}/reports/${rid}/events`, { headers: { cookie } })
    expect(body.items.length).toBe(2)
    expect(body.items[0]?.kind).toBe("priority_changed") // newer
    expect(body.items[0]?.actor?.email).toBe("owner@example.com")
    expect(body.items[1]?.kind).toBe("status_changed") // older
  })
})
