import { describe, expect, test } from "bun:test"
import { createBreadcrumbsCollector } from "./breadcrumbs"

describe("breadcrumbs collector", () => {
  test("records an event with default level info", () => {
    const b = createBreadcrumbsCollector({})
    b.start({ maxEntries: 10 })
    b.breadcrumb("checkout.started")
    const [e] = b.snapshot()
    expect(e?.event).toBe("checkout.started")
    expect(e?.level).toBe("info")
    expect(e?.data).toBeUndefined()
  })

  test("records data payload", () => {
    const b = createBreadcrumbsCollector({})
    b.start({ maxEntries: 10 })
    b.breadcrumb("user.identified", { id: 42, paid: true })
    expect(b.snapshot()[0]?.data).toEqual({ id: 42, paid: true })
  })

  test("explicit level overrides default", () => {
    const b = createBreadcrumbsCollector({})
    b.start({ maxEntries: 10 })
    b.breadcrumb("boom", { code: 500 }, "error")
    expect(b.snapshot()[0]?.level).toBe("error")
  })

  test("respects maxEntries via ring buffer", () => {
    const b = createBreadcrumbsCollector({})
    b.start({ maxEntries: 3 })
    for (const i of [1, 2, 3, 4, 5]) b.breadcrumb(`evt-${i}`)
    const snap = b.snapshot()
    expect(snap.length).toBe(3)
    expect(snap.map((e) => e.event)).toEqual(["evt-3", "evt-4", "evt-5"])
  })

  test("breadcrumb is a no-op before start()", () => {
    const b = createBreadcrumbsCollector({})
    b.breadcrumb("before-start")
    expect(b.snapshot()).toEqual([])
  })
})
