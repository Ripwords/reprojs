import { eq, sql } from "drizzle-orm"
import { db } from "../db"
import { rateLimitBuckets } from "../db/schema"
import type { RateLimiterOptions, TakeResult } from "./rate-limit"

/**
 * Postgres-backed token-bucket rate limiter. Identical semantics to the
 * in-process version — same perMinute cap, same fractional refill — but
 * survives restarts and works across workers / processes.
 *
 * Cost: one small transaction per take() call. Acceptable for intake which is
 * already DB-bound; do NOT use on hot paths that don't otherwise touch the DB.
 */

const WINDOW_MS = 60_000
const SWEEP_PROBABILITY = 0.01
const SWEEP_AGE_MS = 10 * WINDOW_MS

export function createPgRateLimiter(opts: RateLimiterOptions) {
  const { perMinute } = opts
  const now = opts.now ?? (() => Date.now())

  return {
    async take(key: string): Promise<TakeResult> {
      const t = now()

      const result = await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(rateLimitBuckets)
          .where(eq(rateLimitBuckets.key, key))
          .for("update")
        const existing = rows[0]

        if (!existing) {
          // First take for this key: write perMinute-1 (we just consumed one).
          // ON CONFLICT guards the race where two concurrent txs both miss the
          // SELECT — later callers hit the UPDATE path on retry.
          await tx
            .insert(rateLimitBuckets)
            .values({ key, tokens: perMinute - 1, lastRefillMs: t })
            .onConflictDoUpdate({
              target: rateLimitBuckets.key,
              set: { tokens: sql`GREATEST(${rateLimitBuckets.tokens} - 1, 0)`, lastRefillMs: t },
            })
          return { allowed: true, retryAfterMs: 0 }
        }

        const elapsed = Math.max(0, t - existing.lastRefillMs)
        const refilled = Math.min(perMinute, existing.tokens + (elapsed / WINDOW_MS) * perMinute)

        if (refilled >= 1) {
          await tx
            .update(rateLimitBuckets)
            .set({ tokens: refilled - 1, lastRefillMs: t })
            .where(eq(rateLimitBuckets.key, key))
          return { allowed: true, retryAfterMs: 0 }
        }

        await tx
          .update(rateLimitBuckets)
          .set({ tokens: refilled, lastRefillMs: t })
          .where(eq(rateLimitBuckets.key, key))
        const needed = 1 - refilled
        const retryAfterMs = Math.max(1, Math.ceil((needed / perMinute) * WINDOW_MS))
        return { allowed: false, retryAfterMs }
      })

      if (Math.random() < SWEEP_PROBABILITY) {
        await db
          .execute(sql`DELETE FROM rate_limit_buckets WHERE last_refill_ms < ${t - SWEEP_AGE_MS}`)
          .catch(() => {
            /* best-effort */
          })
      }

      return result
    },
  }
}
