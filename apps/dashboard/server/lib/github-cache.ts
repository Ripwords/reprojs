// apps/dashboard/server/lib/github-cache.ts

type Entry<T> = { value: T; fetchedAt: number }

export class GithubRepoCache {
  private ttlMs: number
  private store = new Map<string, Entry<unknown>>()
  private inflight = new Map<string, Promise<unknown>>()

  constructor(opts: { ttlMs?: number } = {}) {
    this.ttlMs = opts.ttlMs ?? 5 * 60 * 1000
  }

  async get<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const entry = this.store.get(key) as Entry<T> | undefined
    const now = Date.now()
    if (entry && now - entry.fetchedAt <= this.ttlMs) return entry.value
    if (entry) {
      this.maybeRefresh(key, fetcher)
      return entry.value
    }
    const inflight = this.inflight.get(key) as Promise<T> | undefined
    if (inflight) return inflight
    const p = fetcher()
      .then((value) => {
        this.store.set(key, { value, fetchedAt: Date.now() })
        return value
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, p)
    return p
  }

  invalidate(key: string): void {
    this.store.delete(key)
  }

  invalidatePrefix(prefix: string): void {
    for (const k of this.store.keys()) if (k.startsWith(prefix)) this.store.delete(k)
  }

  private maybeRefresh<T>(key: string, fetcher: () => Promise<T>): void {
    if (this.inflight.has(key)) return
    const p = fetcher()
      .then((value) => {
        this.store.set(key, { value, fetchedAt: Date.now() })
        return value
      })
      .catch(() => {})
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, p)
  }
}

export const githubCache = new GithubRepoCache()

export function cacheKey(
  installationId: number,
  owner: string,
  name: string,
  resource: string,
): string {
  return `${installationId}:${owner}/${name}:${resource}`
}
