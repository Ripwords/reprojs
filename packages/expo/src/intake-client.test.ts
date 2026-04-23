import { test, expect } from "bun:test"
import { createIntakeClient } from "./intake-client"

test("POSTs to intakeUrl/reports with multipart body and Idempotency-Key header", async () => {
  let capturedUrl = ""
  let capturedHeaders: Record<string, string> = {}
  const mockFetch: typeof fetch = async (input, init) => {
    capturedUrl = typeof input === "string" ? input : (input as Request).url
    capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries())
    return new Response(JSON.stringify({ id: "server-id" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    })
  }
  const client = createIntakeClient({
    intakeUrl: "https://ex.com/api/intake",
    fetchImpl: mockFetch,
  })
  const res = await client.submit({
    idempotencyKey: "idem-1",
    input: {
      projectKey: "rp_pk_" + "a".repeat(24),
      title: "t",
      context: {
        source: "expo",
        pageUrl: "myapp://x",
        userAgent: "u",
        viewport: { w: 1, h: 1 },
        timestamp: new Date().toISOString(),
      },
    } as never,
    attachments: [],
  })
  expect(capturedUrl).toBe("https://ex.com/api/intake/reports")
  expect(capturedHeaders["idempotency-key"]).toBe("idem-1")
  expect(res.id).toBe("server-id")
})

const mockServerErrorFetch: typeof fetch = async () => new Response("boom", { status: 503 })

test("surfaces 5xx errors to the caller", async () => {
  const client = createIntakeClient({
    intakeUrl: "https://ex.com/api/intake",
    fetchImpl: mockServerErrorFetch,
  })
  await expect(
    client.submit({
      idempotencyKey: "k",
      input: { projectKey: "rp_pk_" + "a".repeat(24), title: "t", context: {} as never } as never,
      attachments: [],
    }),
  ).rejects.toMatchObject({ status: 503 })
})
