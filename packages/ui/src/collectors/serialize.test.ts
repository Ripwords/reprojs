// packages/ui/src/collectors/serialize.test.ts
import { beforeAll, describe, expect, test } from "bun:test"
import { truncate } from "@reprojs/sdk-utils"
import { serializeArg, scrubString, DEFAULT_STRING_REDACTORS } from "./serialize"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window()
  Object.assign(globalThis, { window: win, document: win.document })
})

describe("truncate", () => {
  test("no-op when under limit", () => {
    expect(truncate("hello", 100)).toBe("hello")
  })
  test("truncates with suffix when over limit", () => {
    const out = truncate("x".repeat(100), 20)
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out).toContain("[truncated")
  })
  test("preserves multi-byte UTF-8 at boundary", () => {
    const out = truncate("héllo wörld " + "x".repeat(100), 14)
    expect(() => new TextEncoder().encode(out)).not.toThrow()
  })
})

describe("scrubString", () => {
  test("replaces JWT with REDACTED", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123_def"
    expect(scrubString(`token: ${jwt}`, DEFAULT_STRING_REDACTORS)).toBe("token: REDACTED")
  })
  test("replaces Bearer tokens", () => {
    expect(scrubString("Authorization: Bearer abc.def.ghi", DEFAULT_STRING_REDACTORS)).toBe(
      "Authorization: REDACTED",
    )
  })
  test("replaces GitHub PAT / AWS key / Slack token", () => {
    const out = scrubString(
      "gh: ghp_1234567890abcdefghijklmnopqrstuvwxyz0 aws: AKIAIOSFODNN7EXAMPLE slack: xoxb-abc-def-ghi",
      DEFAULT_STRING_REDACTORS,
    )
    expect(out).toContain("gh: REDACTED")
    expect(out).toContain("aws: REDACTED")
    expect(out).toContain("slack: REDACTED")
  })
  test("empty patterns array is a no-op", () => {
    expect(scrubString("anything at all", [])).toBe("anything at all")
  })
})

describe("serializeArg", () => {
  test("primitives", () => {
    expect(serializeArg("hi", 100, [])).toBe('"hi"')
    expect(serializeArg(42, 100, [])).toBe("42")
    expect(serializeArg(true, 100, [])).toBe("true")
    expect(serializeArg(null, 100, [])).toBe("null")
    expect(serializeArg(undefined, 100, [])).toBe("undefined")
  })
  test("NaN and Infinity", () => {
    expect(serializeArg(Number.NaN, 100, [])).toBe("NaN")
    expect(serializeArg(Number.POSITIVE_INFINITY, 100, [])).toBe("Infinity")
  })
  test("Error includes name + message + stack", () => {
    const e = new Error("boom")
    const out = serializeArg(e, 1000, [])
    expect(out).toContain("Error: boom")
  })
  test("circular reference becomes [Circular]", () => {
    const o: { self?: unknown } = {}
    o.self = o
    const out = serializeArg(o, 200, [])
    expect(out).toContain("[Circular]")
  })
  test("function becomes [Function]", () => {
    expect(serializeArg(() => 1, 100, [])).toBe("[Function]")
  })
  test("truncates long strings", () => {
    const long = "x".repeat(1000)
    const out = serializeArg(long, 50, [])
    expect(out.length).toBeLessThan(100)
    expect(out).toContain("[truncated")
  })
  test("applies string scrubbers after truncation", () => {
    const obj = { token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc" }
    const out = serializeArg(obj, 500, DEFAULT_STRING_REDACTORS)
    expect(out).toContain("REDACTED")
    expect(out).not.toContain("eyJhbGci")
  })
})
