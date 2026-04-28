import { test, expect } from "bun:test"
import { createIntakeClient } from "./intake-client"

test("POSTs to intakeUrl/reports with multipart body and Idempotency-Key header", async () => {
  let capturedUrl = ""
  let capturedHeaders: Record<string, string> = {}
  const mockFetch = (async (input: unknown, init: unknown) => {
    capturedUrl = typeof input === "string" ? input : (input as Request).url
    capturedHeaders = Object.fromEntries(
      new Headers((init as RequestInit | undefined)?.headers).entries(),
    )
    return new Response(JSON.stringify({ id: "server-id" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch
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

const mockServerErrorFetch = (async () =>
  new Response("boom", { status: 503 })) as unknown as typeof fetch

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

test("submits user-file attachments as attachment[N] parts", async () => {
  const calls: { body: FormData }[] = []
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    calls.push({ body: init?.body as FormData })
    return new Response(JSON.stringify({ id: "x" }), { status: 201 })
  }) as typeof fetch
  const client = createIntakeClient({ intakeUrl: "https://x", fetchImpl: fakeFetch })
  await client.submit({
    idempotencyKey: "k",
    input: {
      projectKey: "p",
      title: "t",
      context: { source: "expo" },
    } as never,
    attachments: [
      {
        kind: "user-file",
        uri: "file:///a.png",
        bytes: 10,
        contentType: "image/png",
        filename: "a.png",
      },
      {
        kind: "user-file",
        uri: "file:///b.pdf",
        bytes: 20,
        contentType: "application/pdf",
        filename: "b.pdf",
      },
    ],
  })
  const body = calls[0]?.body
  expect(body?.has("attachment[0]")).toBe(true)
  expect(body?.has("attachment[1]")).toBe(true)
})
