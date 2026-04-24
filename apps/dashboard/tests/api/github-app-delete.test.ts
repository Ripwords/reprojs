import { setup } from "../nuxt-setup"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(60000)
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import {
  apiFetch,
  createUser,
  seedProject,
  signIn,
  truncateDomain,
  truncateGithub,
  truncateGithubApp,
  truncateReports,
} from "../helpers"
import { db } from "../../server/db"
import { githubApp, githubIntegrations, reports, reportSyncJobs } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })

beforeAll(() => {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error(
      "ENCRYPTION_KEY must be set on the dev server for github-app-delete tests to seed the encrypted row",
    )
  }
})

async function seedGithubAppRow(adminId: string): Promise<void> {
  await db.insert(githubApp).values({
    id: 1,
    appId: "12345",
    slug: "repro-test",
    privateKey: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
    webhookSecret: "whsec-test",
    clientId: "Iv1.testclientid",
    clientSecret: "secret-value-xyz",
    htmlUrl: "https://github.com/apps/repro-test",
    createdBy: adminId,
  })
}

describe("DELETE /api/integrations/github/app", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateGithub()
    await truncateGithubApp()
    await truncateDomain()
  })

  test("401 when unauthenticated", async () => {
    const res = await apiFetch("/api/integrations/github/app", { method: "DELETE" })
    expect(res.status).toBe(401)
  })

  test("403 when authenticated as non-admin", async () => {
    await createUser("member@example.com", "member")
    const cookie = await signIn("member@example.com")
    const res = await apiFetch("/api/integrations/github/app", {
      method: "DELETE",
      headers: { cookie },
    })
    expect(res.status).toBe(403)
  })

  test("404 when admin but no github_app row", async () => {
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")
    const res = await apiFetch("/api/integrations/github/app", {
      method: "DELETE",
      headers: { cookie },
    })
    expect(res.status).toBe(404)
  })

  test("success: wipes singleton, integrations, and sync jobs; leaves projects intact", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    await seedGithubAppRow(adminId)
    const projectId = await seedProject({
      name: "P",
      publicKey: "pk_test",
      createdBy: adminId,
    })
    await db.insert(githubIntegrations).values({
      projectId,
      installationId: 99,
      repoOwner: "acme",
      repoName: "widgets",
      connectedBy: adminId,
    })
    const [report] = await db
      .insert(reports)
      .values({ projectId, title: "Test" })
      .returning({ id: reports.id })
    await db.insert(reportSyncJobs).values({
      reportId: report!.id,
      state: "pending",
    })

    const cookie = await signIn("admin@example.com")
    const { status, body } = await apiFetch<{
      ok: true
      purgedIntegrations: number
      purgedSyncJobs: number
    }>("/api/integrations/github/app", { method: "DELETE", headers: { cookie } })

    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, purgedIntegrations: 1, purgedSyncJobs: 1 })

    const remainingApp = await db.select().from(githubApp).where(eq(githubApp.id, 1))
    expect(remainingApp).toHaveLength(0)

    const remainingIntegrations = await db.select().from(githubIntegrations)
    expect(remainingIntegrations).toHaveLength(0)

    const remainingJobs = await db.select().from(reportSyncJobs)
    expect(remainingJobs).toHaveLength(0)
  })
})
