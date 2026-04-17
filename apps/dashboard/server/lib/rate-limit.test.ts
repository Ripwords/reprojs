import { describe, expect, test } from "bun:test"
import { createRateLimiter } from "./rate-limit"

describe("createRateLimiter", () => {
  test("allows up to limit requests in the window", () => {
    const rl = createRateLimiter({ perMinute: 3, now: () => 0 })
    expect(rl.take("user-1")).toEqual({ allowed: true, retryAfterMs: 0 })
    expect(rl.take("user-1")).toEqual({ allowed: true, retryAfterMs: 0 })
    expect(rl.take("user-1")).toEqual({ allowed: true, retryAfterMs: 0 })
  })

  test("blocks over-limit requests and reports retryAfter", () => {
    const rl = createRateLimiter({ perMinute: 2, now: () => 0 })
    rl.take("user-1")
    rl.take("user-1")
    const third = rl.take("user-1")
    expect(third.allowed).toBe(false)
    expect(third.retryAfterMs).toBeGreaterThan(0)
  })

  test("refills over time (60s window)", () => {
    let t = 0
    const rl = createRateLimiter({ perMinute: 2, now: () => t })
    rl.take("u")
    rl.take("u")
    expect(rl.take("u").allowed).toBe(false)
    t = 60_001
    expect(rl.take("u").allowed).toBe(true)
  })

  test("isolates buckets by key", () => {
    const rl = createRateLimiter({ perMinute: 1, now: () => 0 })
    expect(rl.take("a").allowed).toBe(true)
    expect(rl.take("a").allowed).toBe(false)
    expect(rl.take("b").allowed).toBe(true)
  })
})
