import { describe, test, expect } from "bun:test"
import { checkBodySize, MAX_WEBHOOK_BODY_BYTES, recordDelivery } from "./github-webhook-auth"
import { db } from "../db"
import { githubWebhookDeliveries } from "../db/schema/github-webhook-deliveries"
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
