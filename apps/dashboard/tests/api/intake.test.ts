import { setup } from "@nuxt/test-utils/e2e"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { sql } from "drizzle-orm"
import { createUser, makePngBlob, seedProject, truncateDomain, truncateReports } from "../helpers"
import { db } from "../../server/db"
import { reports, reportAttachments } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(15000)

const PK = "ft_pk_ABCDEF1234567890abcdef12"
const BAD_PK = "ft_pk_ZZZZZZZZZZZZZZZZZZZZZZZZ"
const ORIGIN = "http://localhost:4000"

function buildReportJSON(
  projectKey: string,
  extra: Partial<{ title: string; _dwellMs: number; _hp: string }> = {},
) {
  return JSON.stringify({
    projectKey,
    title: extra.title ?? "It broke",
    description: "Clicking the Save button did nothing.",
    context: {
      pageUrl: "http://localhost:4000/app",
      userAgent: "Mozilla/5.0 Test",
      viewport: { w: 1440, h: 900 },
      timestamp: new Date().toISOString(),
      reporter: { email: "user@example.com" },
    },
    ...(extra._dwellMs !== undefined ? { _dwellMs: extra._dwellMs } : {}),
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
})
