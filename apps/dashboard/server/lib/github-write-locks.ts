// apps/dashboard/server/lib/github-write-locks.ts
// Helpers for recording and consuming write-locks. Write-locks prevent echo
// loops: before we push an outbound change to GitHub we record a short-lived
// lock; when the matching webhook arrives back we consume it and skip the
// inbound application (it's our own echo).
import { and, eq, gt, lt } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type * as schema from "../db/schema"
import { githubWriteLocks } from "../db/schema"
import type { githubWriteLockKinds } from "../db/schema"

export const WRITE_LOCK_TTL_MS = 30_000 // 30 seconds

type DB = NodePgDatabase<typeof schema>
type LockKind = (typeof githubWriteLockKinds.enumValues)[number]

export interface WriteLockInput {
  reportId: string
  kind: LockKind
  signature: string
}

/** Record a write-lock row with a TTL of WRITE_LOCK_TTL_MS. */
export async function recordWriteLock(db: DB, input: WriteLockInput): Promise<void> {
  const expiresAt = new Date(Date.now() + WRITE_LOCK_TTL_MS)
  await db.insert(githubWriteLocks).values({
    reportId: input.reportId,
    kind: input.kind,
    signature: input.signature,
    expiresAt,
  })
}

/**
 * Consume a write-lock. Returns true if a matching live row was deleted,
 * false otherwise (no lock found, wrong signature, or already expired).
 */
export async function consumeWriteLock(db: DB, input: WriteLockInput): Promise<boolean> {
  const now = new Date()
  const deleted = await db
    .delete(githubWriteLocks)
    .where(
      and(
        eq(githubWriteLocks.reportId, input.reportId),
        eq(githubWriteLocks.kind, input.kind),
        eq(githubWriteLocks.signature, input.signature),
        gt(githubWriteLocks.expiresAt, now),
      ),
    )
    .returning({ id: githubWriteLocks.id })

  return deleted.length > 0
}

/**
 * Delete all expired write-lock rows. Returns the number of rows deleted.
 * Suitable for a scheduled cleanup task.
 */
export async function cleanupExpiredLocks(db: DB): Promise<number> {
  const now = new Date()
  const deleted = await db
    .delete(githubWriteLocks)
    .where(lt(githubWriteLocks.expiresAt, now))
    .returning({ id: githubWriteLocks.id })

  return deleted.length
}
