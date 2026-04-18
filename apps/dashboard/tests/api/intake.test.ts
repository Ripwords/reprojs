import { setup } from "@nuxt/test-utils/e2e"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { sql } from "drizzle-orm"
import { createUser, makePngBlob, seedProject, truncateDomain, truncateReports } from "../helpers"
import { db } from "../../server/db"
import { projects, reports, reportAttachments } from "../../server/db/schema"

// INTAKE_RATE_PER_KEY_ANON is read by the dashboard process, not this test
// process. The tiered rate-limit test below is env-independent — it bursts
// enough requests to trigger any reasonable default cap.

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(15000)

const PK = "ft_pk_ABCDEF1234567890abcdef12"
const BAD_PK = "ft_pk_ZZZZZZZZZZZZZZZZZZZZZZZZ"
const ORIGIN = "http://localhost:4000"

function buildReportJSON(
  projectKey: string,
  extra: Partial<{
    title: string
    _dwellMs: number
    _hp: string
    reporterUserId: string | null
  }> = {},
) {
  const reporter =
    extra.reporterUserId === null
      ? undefined
      : extra.reporterUserId
        ? { userId: extra.reporterUserId, email: "user@example.com" }
        : { email: "user@example.com" }
  return JSON.stringify({
    projectKey,
    title: extra.title ?? "It broke",
    description: "Clicking the Save button did nothing.",
    context: {
      pageUrl: "http://localhost:4000/app",
      userAgent: "Mozilla/5.0 Test",
      viewport: { w: 1440, h: 900 },
      timestamp: new Date().toISOString(),
      ...(reporter ? { reporter } : {}),
    },
    // Default dwell to 2s so tests pass the S2 min-dwell gate. Tests that
    // specifically exercise the gate override with a low value (e.g. 300).
    _dwellMs: extra._dwellMs ?? 2000,
    ...(extra._hp !== undefined ? { _hp: extra._hp } : {}),
  })
}

function buildMultipart(reportJson: string, screenshot?: Blob): FormData {
  const fd = new FormData()
  fd.set("report", new Blob([reportJson], { type: "application/json" }))
  if (screenshot) fd.set("screenshot", screenshot, "screenshot.png")
  return fd
}

describe("intake API", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("happy path: 201, creates report + attachment", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })

    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN)

    const [row] = await db
      .select()
      .from(reports)
      .where(sql`id = ${body.id}`)
    expect(row.title).toBe("It broke")
    const atts = await db
      .select()
      .from(reportAttachments)
      .where(sql`report_id = ${body.id}`)
    expect(atts.length).toBe(1)
    expect(atts[0].kind).toBe("screenshot")
  })

  test("rejects wrong origin with 403 (but still sets ACAO)", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: ["http://prod.example.com"],
      createdBy: admin,
    })

    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: "http://evil.example.com" },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(res.status).toBe(403)
    expect(res.headers.get("access-control-allow-origin")).toBe("http://evil.example.com")
  })

  test("rejects bad project key with 401", async () => {
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(BAD_PK), makePngBlob()),
    })
    expect(res.status).toBe(401)
  })

  test("OPTIONS preflight returns 204 with ACAO reflecting origin", async () => {
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN)
    expect(res.headers.get("access-control-allow-methods")).toContain("POST")
  })

  test("rejects submissions with dwell < 1500ms", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK, { _dwellMs: 300 }), makePngBlob()),
    })
    expect(res.status).toBe(400)
  })

  test("honeypot: non-empty _hp returns fake 201 and does not persist", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK, { _hp: "i-am-a-bot" }), makePngBlob()),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    const rows = await db
      .select()
      .from(reports)
      .where(sql`project_id = ${projectId}`)
    expect(rows.length).toBe(0)
  })

  test("daily ceiling: rejects when cap already met", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await db
      .update(projects)
      .set({ dailyReportCap: 1 })
      .where(sql`id = ${projectId}`)

    const r1 = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(r1.status).toBe(201)

    const r2 = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(r2.status).toBe(429)
    expect(r2.headers.get("retry-after")).toBe("3600")
  })

  // Skipped: bursting enough anon requests to trigger the anon rate bucket
  // also drains the per-IP bucket (both keyed on 127.0.0.1 in local runs),
  // which cascades 429s into the next test files. The tiered-limiter logic is
  // unit-tested in apps/dashboard/server/lib/rate-limit.test.ts, which covers
  // the same semantics without the cross-test IP pollution.
  test.skip("tiered rate limit: anonymous stricter than authenticated", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })

    // Env-independent check: dashboard may have been started with any value
    // for INTAKE_RATE_PER_KEY_ANON (default 10). Fire enough anon submissions
    // to exhaust any reasonable default, then assert at least one 429 appears.
    const BURST = 30
    const anonStatuses: number[] = []
    for (let i = 0; i < BURST; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential required for rate limiter
      const r = await fetch("http://localhost:3000/api/intake/reports", {
        method: "POST",
        headers: { Origin: ORIGIN },
        body: buildMultipart(
          buildReportJSON(PK, { reporterUserId: null, _dwellMs: 2000 }),
          makePngBlob(),
        ),
      })
      anonStatuses.push(r.status)
    }
    // At least one must have been rate-limited (anon cap applies).
    expect(anonStatuses.some((s) => s === 429)).toBe(true)
    // And the first few should have succeeded (we didn't start over the limit).
    expect(anonStatuses[0]).toBe(201)

    // An authenticated submission goes through (different bucket, higher cap).
    const authed = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(
        buildReportJSON(PK, { reporterUserId: "user_1", _dwellMs: 2000 }),
        makePngBlob(),
      ),
    })
    expect(authed.status).toBe(201)
  })
})
