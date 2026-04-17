export interface RateLimiterOptions {
  perMinute: number
  now?: () => number
}

export interface TakeResult {
  allowed: boolean
  retryAfterMs: number
}

interface Bucket {
  tokens: number
  lastRefillMs: number
}

const WINDOW_MS = 60_000

export function createRateLimiter(opts: RateLimiterOptions) {
  const { perMinute } = opts
  const now = opts.now ?? (() => Date.now())
  const buckets = new Map<string, Bucket>()

  const sweep = () => {
    const t = now()
    for (const [k, b] of buckets) {
      if (t - b.lastRefillMs > WINDOW_MS * 10) buckets.delete(k)
    }
  }

  return {
    take(key: string): TakeResult {
      const t = now()
      let b = buckets.get(key)
      if (!b) {
        b = { tokens: perMinute - 1, lastRefillMs: t }
        buckets.set(key, b)
        return { allowed: true, retryAfterMs: 0 }
      }
      const elapsed = t - b.lastRefillMs
      const refill = (elapsed / WINDOW_MS) * perMinute
      b.tokens = Math.min(perMinute, b.tokens + refill)
      b.lastRefillMs = t
      if (b.tokens >= 1) {
        b.tokens -= 1
        return { allowed: true, retryAfterMs: 0 }
      }
      const needed = 1 - b.tokens
      const retryAfterMs = Math.ceil((needed / perMinute) * WINDOW_MS)
      return { allowed: false, retryAfterMs }
    },
    _sweep: sweep,
    _size: () => buckets.size,
  }
}

let _keyLimiter: ReturnType<typeof createRateLimiter> | null = null
let _ipLimiter: ReturnType<typeof createRateLimiter> | null = null

export function getKeyLimiter() {
  if (!_keyLimiter) {
    _keyLimiter = createRateLimiter({ perMinute: Number(process.env.INTAKE_RATE_PER_KEY ?? 60) })
  }
  return _keyLimiter
}

export function getIpLimiter() {
  if (!_ipLimiter) {
    _ipLimiter = createRateLimiter({ perMinute: Number(process.env.INTAKE_RATE_PER_IP ?? 20) })
  }
  return _ipLimiter
}
