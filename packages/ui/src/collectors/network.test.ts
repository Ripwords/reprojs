// packages/ui/src/collectors/network.test.ts
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { createNetworkCollector } from "./network"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window()
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    XMLHttpRequest: win.XMLHttpRequest,
  })
})

describe("network collector — fetch", () => {
  const created: Array<ReturnType<typeof createNetworkCollector>> = []
  afterEach(() => {
    for (const c of created.splice(0)) c.stop()
  })

  test("records a successful fetch with status + duration", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } })
    const c = createNetworkCollector({})
    created.push(c)
    c.start({ maxEntries: 10 })
    await fetch("http://example.com/x")
    const entry = c.snapshot()[0]
    expect(entry?.method).toBe("GET")
    expect(entry?.url).toBe("http://example.com/x")
    expect(entry?.status).toBe(200)
    expect(entry?.initiator).toBe("fetch")
    expect(entry?.durationMs).toBeGreaterThanOrEqual(0)
    globalThis.fetch = originalFetch
  })

  test("records a failed fetch with status null + error", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      throw new Error("offline")
    }
    const c = createNetworkCollector({})
    created.push(c)
    c.start({})
    await fetch("http://example.com/x").catch(() => {})
    const entry = c.snapshot()[0]
    expect(entry?.status).toBeNull()
    expect(entry?.error).toContain("offline")
    globalThis.fetch = originalFetch
  })

  test("redacts sensitive query params in URL", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("")
    const c = createNetworkCollector({})
    created.push(c)
    c.start({})
    await fetch("http://example.com/x?api_key=secret&debug=1")
    const entry = c.snapshot()[0]
    expect(entry?.url).toContain("api_key=REDACTED")
    expect(entry?.url).toContain("debug=1")
    globalThis.fetch = originalFetch
  })

  test("does not capture bodies by default", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("hello body")
    const c = createNetworkCollector({})
    created.push(c)
    c.start({})
    await fetch("http://example.com/x", { method: "POST", body: "hi" })
    const entry = c.snapshot()[0]
    expect(entry?.requestBody).toBeUndefined()
    expect(entry?.responseBody).toBeUndefined()
    globalThis.fetch = originalFetch
  })

  test("captures bodies when opted in", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("hello body")
    const c = createNetworkCollector({})
    created.push(c)
    c.start({ requestBody: true, responseBody: true, maxBodyBytes: 1024 })
    await fetch("http://example.com/x", { method: "POST", body: "hi" })
    const entry = c.snapshot()[0]
    expect(entry?.requestBody).toBe("hi")
    expect(entry?.responseBody).toBe("hello body")
    globalThis.fetch = originalFetch
  })

  test("stop restores the original fetch", async () => {
    const originalFetch = globalThis.fetch
    const c = createNetworkCollector({})
    c.start({})
    expect(globalThis.fetch).not.toBe(originalFetch)
    c.stop()
    expect(globalThis.fetch).toBe(originalFetch)
  })
})
