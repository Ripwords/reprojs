import { afterEach, describe, expect, test } from "bun:test"
import { createConsoleCollector } from "./console"

describe("console collector", () => {
  const created: Array<ReturnType<typeof createConsoleCollector>> = []
  afterEach(() => {
    for (const c of created.splice(0)) c.stop()
  })

  test("captures console.log with level 'log'", () => {
    const c = createConsoleCollector({})
    created.push(c)
    c.start({ maxEntries: 10, maxArgBytes: 1000, maxEntryBytes: 10_000 })
    console.log("hello", 42)
    const snap = c.snapshot()
    expect(snap.length).toBe(1)
    expect(snap[0]?.level).toBe("log")
    expect(snap[0]?.args[0]).toContain("hello")
    expect(snap[0]?.args[1]).toBe("42")
  })

  test("console.error includes stack", () => {
    const c = createConsoleCollector({})
    created.push(c)
    c.start({})
    console.error("boom")
    expect(c.snapshot()[0]?.stack).toBeDefined()
  })

  test("console.log does NOT capture stack", () => {
    const c = createConsoleCollector({})
    created.push(c)
    c.start({})
    console.log("noisy")
    expect(c.snapshot()[0]?.stack).toBeUndefined()
  })

  test("calls the original console method", () => {
    const orig = console.log
    const seen: unknown[][] = []
    console.log = (...a: unknown[]) => {
      seen.push(a)
    }
    const c = createConsoleCollector({})
    created.push(c)
    c.start({})
    console.log("x")
    expect(seen).toEqual([["x"]])
    console.log = orig
  })

  test("stop restores the original console methods", () => {
    const orig = console.log
    const c = createConsoleCollector({})
    c.start({})
    expect(console.log).not.toBe(orig)
    c.stop()
    expect(console.log).toBe(orig)
  })

  test("ring buffer evicts oldest beyond maxEntries", () => {
    const c = createConsoleCollector({})
    created.push(c)
    c.start({ maxEntries: 3 })
    for (let i = 0; i < 5; i++) console.log(`m-${i}`)
    const snap = c.snapshot()
    expect(snap.length).toBe(3)
  })
})
