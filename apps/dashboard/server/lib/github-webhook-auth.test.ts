import { describe, test, expect } from "bun:test"
import {
  checkBodySize,
  MAX_WEBHOOK_BODY_BYTES,
  recordDelivery,
  isKnownInstallation,
} from "./github-webhook-auth"
import { db } from "../db"
import { githubWebhookDeliveries } from "../db/schema/github-webhook-deliveries"
import { githubIntegrations } from "../db/schema/github-integrations"
import { projects } from "../db/schema/projects"
import { eq } from "drizzle-orm"

describe("checkBodySize", () => {
  test("accepts body at the limit", () => {
    const body = Buffer.alloc(MAX_WEBHOOK_BODY_BYTES)
    expect(checkBodySize(body.byteLength)).toBe(true)
  })

  test("rejects body over the limit", () => {
    expect(checkBodySize(MAX_WEBHOOK_BODY_BYTES + 1)).toBe(false)
  })

  test("accepts missing content-length", () => {
    expect(checkBodySize(undefined)).toBe(true)
  })

  test("rejects non-numeric content-length", () => {
    expect(checkBodySize(Number.NaN)).toBe(false)
  })
})

describe("recordDelivery", () => {
  test("returns 'new' for first-seen delivery id", async () => {
    const id = `test-${crypto.randomUUID()}`
    expect(await recordDelivery(id)).toBe("new")
    await db.delete(githubWebhookDeliveries).where(eq(githubWebhookDeliveries.deliveryId, id))
  })

  test("returns 'replay' for a previously-seen id", async () => {
    const id = `test-${crypto.randomUUID()}`
    expect(await recordDelivery(id)).toBe("new")
    expect(await recordDelivery(id)).toBe("replay")
    await db.delete(githubWebhookDeliveries).where(eq(githubWebhookDeliveries.deliveryId, id))
  })
})

describe("isKnownInstallation", () => {
  test("returns false when no row matches", async () => {
    expect(await isKnownInstallation(999_999_999)).toBe(false)
  })

  test("returns true when a github_integrations row has the installation id", async () => {
    const [project] = await db
      .insert(projects)
      .values({ name: "wh-auth-test", createdBy: "test-user" })
      .returning()
    const installationId = 42_000_000 + Math.floor(Math.random() * 1_000_000)
    await db.insert(githubIntegrations).values({
      projectId: project.id,
      installationId,
      repoOwner: "",
      repoName: "",
      status: "connected",
    })
    expect(await isKnownInstallation(installationId)).toBe(true)
    await db.delete(githubIntegrations).where(eq(githubIntegrations.projectId, project.id))
    await db.delete(projects).where(eq(projects.id, project.id))
  })
})
