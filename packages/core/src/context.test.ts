import { describe, expect, test, beforeAll } from "bun:test"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window({ url: "http://localhost:4000/app?x=1" })
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
    navigator: win.navigator,
  })
})

import { gatherContext } from "./context"

describe("gatherContext", () => {
  test("captures core page + viewport + timestamp", () => {
    const ctx = gatherContext(null, undefined)
    expect(ctx.pageUrl).toBe("http://localhost:4000/app?x=1")
    expect(typeof ctx.userAgent).toBe("string")
    expect(ctx.viewport.w).toBeGreaterThan(0)
    expect(ctx.viewport.h).toBeGreaterThan(0)
    expect(ctx.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(ctx.reporter).toBeUndefined()
    expect(ctx.metadata).toBeUndefined()
  })

  test("includes reporter when provided", () => {
    const ctx = gatherContext({ email: "u@example.com", name: "U" }, undefined)
    expect(ctx.reporter).toEqual({ email: "u@example.com", name: "U" })
  })

  test("includes metadata when provided", () => {
    const ctx = gatherContext(null, { plan: "pro", seats: 5 })
    expect(ctx.metadata).toEqual({ plan: "pro", seats: 5 })
  })
})
