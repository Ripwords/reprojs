import { setup } from "@nuxt/test-utils/e2e"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import type { ReportSummaryDTO } from "@feedback-tool/shared"
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

const PK = "ft_pk_ABCDEF1234567890abcdef12"
const ORIGIN = "http://localhost:4000"

async function submitReport(title: string) {
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

describe("reports list API", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("admin sees reports for a project ordered newest first", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await submitReport("first")
    await new Promise((r) => setTimeout(r, 10))
    await submitReport("second")

    const cookie = await signIn("admin@example.com")
    const { status, body } = await apiFetch<{ items: ReportSummaryDTO[]; total: number }>(
      `/api/projects/${projectId}/reports`,
      { headers: { cookie } },
    )
    expect(status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.items[0].title).toBe("second")
    expect(body.items[1].title).toBe("first")
    expect(body.items[0].reporterEmail).toBe("u@example.com")
    expect(body.items[0].thumbnailUrl).toContain("/attachment")
  })

  test("non-member gets 404", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await createUser("stranger@example.com", "member")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await submitReport("private")

    const cookie = await signIn("stranger@example.com")
    const { status } = await apiFetch(`/api/projects/${projectId}/reports`, { headers: { cookie } })
    expect(status).toBe(404)
  })
})

describe("attachment GET", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("streams PNG bytes with correct Content-Type", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const reportId = await submitReport("pic")

    const cookie = await signIn("admin@example.com")
    const res = await fetch(
      `http://localhost:3000/api/projects/${projectId}/reports/${reportId}/attachment?kind=screenshot`,
      { headers: { cookie } },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    const buf = new Uint8Array(await res.arrayBuffer())
    // PNG signature
    expect(Array.from(buf.slice(0, 4))).toEqual([137, 80, 78, 71])
  })

  test("cross-project attachment access returns 404", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "A",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const projectB = await seedProject({
      name: "B",
      publicKey: "ft_pk_BBBBBBBBBBBBBBBBBBBBBBBB",
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const reportId = await submitReport("in A")

    const cookie = await signIn("admin@example.com")
    const res = await fetch(
      `http://localhost:3000/api/projects/${projectB}/reports/${reportId}/attachment?kind=screenshot`,
      { headers: { cookie } },
    )
    expect(res.status).toBe(404)
  })
})
