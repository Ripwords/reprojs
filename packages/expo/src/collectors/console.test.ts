import { test, expect, beforeEach, afterEach } from "bun:test"
import { createConsoleCollector } from "./console"

let originalConsole: typeof console

beforeEach(() => {
  originalConsole = { ...console }
})

afterEach(() => {
  Object.assign(console, originalConsole)
})

test("patches console.log and records the call", () => {
  const c = createConsoleCollector({ max: 10 })
  c.start()
  console.log("hi", 1)
  const entries = c.snapshot()
  expect(entries).toHaveLength(1)
  expect(entries[0]?.level).toBe("log")
  expect(entries[0]?.args).toEqual(["hi", "1"])
  c.stop()
})

test("captures stack on warn + error only", () => {
  const c = createConsoleCollector({ max: 10 })
  c.start()
  console.log("no stack")
  console.warn("with stack")
  console.error("with stack")
  const entries = c.snapshot()
  expect(entries.find((e) => e.level === "log")?.stack).toBeUndefined()
  expect(entries.find((e) => e.level === "warn")?.stack).toBeDefined()
  expect(entries.find((e) => e.level === "error")?.stack).toBeDefined()
  c.stop()
})

test("stop restores the original console functions", () => {
  const original = console.log
  const c = createConsoleCollector({ max: 10 })
  c.start()
  expect(console.log).not.toBe(original)
  c.stop()
  expect(console.log).toBe(original)
})

test("fails open if host code throws inside patched log", () => {
  const c = createConsoleCollector({ max: 10 })
  c.start()
  // Stub the ring push to throw — collector must still call through to the original.
  const originalPush = (c as unknown as { __buf: { push: (v: unknown) => void } }).__buf.push
  ;(c as unknown as { __buf: { push: (v: unknown) => void } }).__buf.push = () => {
    throw new Error("boom")
  }
  expect(() => console.log("x")).not.toThrow()
  ;(c as unknown as { __buf: { push: (v: unknown) => void } }).__buf.push = originalPush
  c.stop()
})
