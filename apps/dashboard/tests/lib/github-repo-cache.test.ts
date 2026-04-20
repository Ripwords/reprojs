// apps/dashboard/tests/lib/github-repo-cache.test.ts
import { afterEach, describe, expect, test } from "bun:test"
import type { InstallationRepository } from "@reprojs/integrations-github"
import {
  __clearAllInstallationRepos,
  getInstallationRepos,
  invalidateInstallationRepos,
} from "../../server/lib/github-repo-cache"

function makeRepos(n: number): InstallationRepository[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    owner: "acme",
    name: `repo-${i + 1}`,
    fullName: `acme/repo-${i + 1}`,
  }))
}

afterEach(() => {
  __clearAllInstallationRepos()
})

describe("getInstallationRepos", () => {
  test("caches the result and does not call the fetcher twice within TTL", async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return makeRepos(3)
    }
    const a = await getInstallationRepos(1, fetcher)
    const b = await getInstallationRepos(1, fetcher)
    expect(calls).toBe(1)
    expect(a).toEqual(b)
    expect(a.length).toBe(3)
  })

  test("different installations have independent caches", async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return makeRepos(1)
    }
    await getInstallationRepos(1, fetcher)
    await getInstallationRepos(2, fetcher)
    expect(calls).toBe(2)
  })

  test("invalidate forces a refetch on next call", async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return makeRepos(1)
    }
    await getInstallationRepos(1, fetcher)
    invalidateInstallationRepos(1)
    await getInstallationRepos(1, fetcher)
    expect(calls).toBe(2)
  })

  test("dedupes concurrent cold-cache requests", async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const fetcher = async () => {
      calls += 1
      await gate
      return makeRepos(2)
    }
    const p1 = getInstallationRepos(42, fetcher)
    const p2 = getInstallationRepos(42, fetcher)
    release()
    const [a, b] = await Promise.all([p1, p2])
    expect(calls).toBe(1)
    expect(a).toBe(b)
  })

  test("fetcher failure clears the in-flight entry so later calls can retry", async () => {
    let calls = 0
    const failing = async () => {
      calls += 1
      throw new Error("boom")
    }
    await expect(getInstallationRepos(9, failing)).rejects.toThrow("boom")

    const ok = async () => {
      calls += 1
      return makeRepos(1)
    }
    const repos = await getInstallationRepos(9, ok)
    expect(repos.length).toBe(1)
    expect(calls).toBe(2)
  })
})
