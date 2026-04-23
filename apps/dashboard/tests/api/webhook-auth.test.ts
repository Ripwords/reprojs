import { describe, test, expect, beforeAll, afterEach, setDefaultTimeout } from "bun:test"
setDefaultTimeout(30000)
import { createHmac } from "node:crypto"
import { apiFetch, truncateDomain } from "../helpers"
import { db } from "../../server/db"
import { githubWebhookDeliveries } from "../../server/db/schema/github-webhook-deliveries"
import { githubApp } from "../../server/db/schema/github-app"

const WEBHOOK_SECRET = "test-webhook-secret"

function sign(body: string): string {
  const h = createHmac("sha256", WEBHOOK_SECRET)
  h.update(body)
  return `sha256=${h.digest("hex")}`
}

beforeAll(async () => {
  await truncateDomain()
  await db.delete(githubWebhookDeliveries)
  await db.delete(githubApp)
  await db.insert(githubApp).values({
    id: 1,
    appId: "1",
    slug: "test",
    privateKey: "x",
    webhookSecret: WEBHOOK_SECRET,
    clientId: "x",
    clientSecret: "x",
    htmlUrl: "https://github.com/apps/test",
    createdBy: "test",
  })
})

afterEach(async () => {
  await db.delete(githubWebhookDeliveries)
})

describe("webhook auth", () => {
  test("413 on oversized body", async () => {
    const big = "x".repeat(5 * 1024 * 1024 + 100)
    const res = await apiFetch("/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(big.length),
        "x-hub-signature-256": sign(big),
        "x-github-event": "ping",
        "x-github-delivery": crypto.randomUUID(),
      },
      body: big,
    })
    expect(res.status).toBe(413)
  })

  test("401 on bad signature", async () => {
    const body = JSON.stringify({ zen: "test" })
    const res = await apiFetch("/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=deadbeef",
        "x-github-event": "ping",
        "x-github-delivery": crypto.randomUUID(),
      },
      body,
    })
    expect(res.status).toBe(401)
  })

  test("400 on missing X-GitHub-Delivery", async () => {
    const body = JSON.stringify({ zen: "test", installation: { id: 1 } })
    const res = await apiFetch("/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(body),
        "x-github-event": "ping",
      },
      body,
    })
    expect(res.status).toBe(400)
  })

  test("202 on replay", async () => {
    const body = JSON.stringify({ zen: "ping", installation: { id: 999_888_777 } })
    const deliveryId = crypto.randomUUID()
    const headers = {
      "content-type": "application/json",
      "x-hub-signature-256": sign(body),
      "x-github-event": "ping",
      "x-github-delivery": deliveryId,
    }
    const first = await apiFetch<{ status: string }>("/api/integrations/github/webhook", {
      method: "POST",
      headers,
      body,
    })
    expect(first.status).toBe(202)
    const second = await apiFetch<{ status: string }>("/api/integrations/github/webhook", {
      method: "POST",
      headers,
      body,
    })
    expect(second.status).toBe(202)
    expect(second.body.status).toBe("replay")
  })

  test("202 on unknown installation", async () => {
    const body = JSON.stringify({ zen: "ping", installation: { id: 111_222_333 } })
    const res = await apiFetch<{ status: string }>("/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(body),
        "x-github-event": "ping",
        "x-github-delivery": crypto.randomUUID(),
      },
      body,
    })
    expect(res.status).toBe(202)
    expect(res.body.status).toBe("unknown-installation")
  })
})
