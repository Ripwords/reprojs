import { describe, expect, test } from "bun:test"
import { createInProcessRateLimiter } from "./rate-limit"

describe("createInProcessRateLimiter", () => {
  test("allows up to limit requests in the window", async () => {
    const rl = createInProcessRateLimiter({ perMinute: 3, now: () => 0 })
    expect(await rl.take("user-1")).toEqual({ allowed: true, retryAfterMs: 0 })
    expect(await rl.take("user-1")).toEqual({ allowed: true, retryAfterMs: 0 })
    expect(await rl.take("user-1")).toEqual({ allowed: true, retryAfterMs: 0 })
  })

  test("blocks over-limit requests and reports retryAfter", async () => {
    const rl = createInProcessRateLimiter({ perMinute: 2, now: () => 0 })
    await rl.take("user-1")
    await rl.take("user-1")
    const third = await rl.take("user-1")
    expect(third.allowed).toBe(false)
    expect(third.retryAfterMs).toBeGreaterThan(0)
  })

  test("refills over time (60s window)", async () => {
    let t = 0
    const rl = createInProcessRateLimiter({ perMinute: 2, now: () => t })
    await rl.take("u")
    await rl.take("u")
    expect((await rl.take("u")).allowed).toBe(false)
    t = 60_001
    expect((await rl.take("u")).allowed).toBe(true)
  })

  test("isolates buckets by key", async () => {
    const rl = createInProcessRateLimiter({ perMinute: 1, now: () => 0 })
    expect((await rl.take("a")).allowed).toBe(true)
    expect((await rl.take("a")).allowed).toBe(false)
    expect((await rl.take("b")).allowed).toBe(true)
  })
})
