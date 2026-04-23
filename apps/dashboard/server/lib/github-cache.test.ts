import { describe, test, expect, beforeEach } from "bun:test"
import { GithubRepoCache } from "./github-cache"

describe("GithubRepoCache", () => {
  let cache: GithubRepoCache
  beforeEach(() => {
    cache = new GithubRepoCache({ ttlMs: 50 })
  })

  test("cold miss calls the fetcher and caches the result", async () => {
    let calls = 0
    const result = await cache.get("k1", async () => {
      calls++
      return ["a", "b"]
    })
    expect(result).toEqual(["a", "b"])
    expect(calls).toBe(1)
    const second = await cache.get("k1", async () => {
      calls++
      return ["z"]
    })
    expect(second).toEqual(["a", "b"])
    expect(calls).toBe(1)
  })

  test("single-flight: concurrent misses share one fetch", async () => {
    let calls = 0
    let resolveInner!: (v: string[]) => void
    const inner = new Promise<string[]>((r) => {
      resolveInner = r
    })
    const p1 = cache.get("k2", async () => {
      calls++
      return inner
    })
    const p2 = cache.get("k2", async () => {
      calls++
      return inner
    })
    resolveInner(["one"])
    expect(await p1).toEqual(["one"])
    expect(await p2).toEqual(["one"])
    expect(calls).toBe(1)
  })

  test("stale-while-revalidate: expired entries return stale synchronously, refresh in background", async () => {
    let version = 1
    const fetcher = async () => [`v${version}`]
    const first = await cache.get("k3", fetcher)
    expect(first).toEqual(["v1"])
    await Bun.sleep(60)
    version = 2
    const stale = await cache.get("k3", fetcher)
    expect(stale).toEqual(["v1"])
    await Bun.sleep(20)
    const fresh = await cache.get("k3", fetcher)
    expect(fresh).toEqual(["v2"])
  })

  test("invalidate drops the entry", async () => {
    let calls = 0
    await cache.get("k4", async () => {
      calls++
      return ["x"]
    })
    cache.invalidate("k4")
    await cache.get("k4", async () => {
      calls++
      return ["y"]
    })
    expect(calls).toBe(2)
  })
})
