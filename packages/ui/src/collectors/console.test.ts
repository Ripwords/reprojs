import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { createConsoleCollector } from "./console"

let hdWindow: {
  Event: typeof globalThis.Event
  ErrorEvent: typeof globalThis.ErrorEvent
} | null = null

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window()
  Object.assign(globalThis, { window: win, document: win.document })
  hdWindow = win as unknown as typeof hdWindow
})

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

  test("captures window 'error' events as level=error", () => {
    const c = createConsoleCollector({})
    created.push(c)
    c.start({})
    const err = new Error("uncaught demo")
    const HD = hdWindow
    if (!HD) throw new Error("happy-dom not initialized")
    window.dispatchEvent(
      new HD.ErrorEvent("error", {
        message: err.message,
        filename: "demo.js",
        lineno: 42,
        colno: 7,
        error: err,
      }),
    )
    const snap = c.snapshot()
    const errEntry = snap.find((e) => e.level === "error")
    expect(errEntry).toBeDefined()
    expect(errEntry?.args[0]).toContain("uncaught demo")
    expect(errEntry?.args[1]).toContain("demo.js:42:7")
    expect(errEntry?.stack).toBeDefined()
  })

  test("captures 'unhandledrejection' events as level=error", () => {
    const c = createConsoleCollector({})
    created.push(c)
    c.start({})
    const reason = new Error("rejected demo")
    const p = Promise.reject(reason)
    // happy-dom doesn't auto-fire unhandledrejection; synthesize the event using
    // happy-dom's Event constructor, then patch promise/reason onto it.
    const HD = hdWindow
    if (!HD) throw new Error("happy-dom not initialized")
    const evt = Object.assign(new HD.Event("unhandledrejection"), { promise: p, reason })
    window.dispatchEvent(evt)
    p.catch(() => {}) // silence the rejection so bun's runner doesn't complain
    const snap = c.snapshot()
    const errEntry = snap.find(
      (e) => e.level === "error" && e.args[0]?.includes("Unhandled promise rejection"),
    )
    expect(errEntry).toBeDefined()
    expect(errEntry?.stack).toBeDefined()
  })

  test("stop removes the window error + unhandledrejection listeners", () => {
    const c = createConsoleCollector({})
    c.start({})
    c.stop()
    // After stop, start a fresh collector — it gets its own listener. Fire one
    // error event; fresh should see exactly one entry (the stopped one adds nothing).
    const fresh = createConsoleCollector({})
    created.push(fresh)
    fresh.start({})
    const HD = hdWindow
    if (!HD) throw new Error("happy-dom not initialized")
    window.dispatchEvent(
      new HD.ErrorEvent("error", { message: "post-stop", error: new Error("x") }),
    )
    const snap = fresh.snapshot()
    const matching = snap.filter((e) => e.level === "error" && e.args[0]?.includes("post-stop"))
    expect(matching.length).toBe(1)
  })
})
