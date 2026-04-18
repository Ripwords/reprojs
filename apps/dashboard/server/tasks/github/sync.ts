// apps/dashboard/server/tasks/github/sync.ts
import { and, eq, lt, lte, sql } from "drizzle-orm"
import { defineTask } from "nitropack/runtime"
import { db } from "../../db"
import { reportSyncJobs } from "../../db/schema"
import { ReconcileSkipped, reconcileReport } from "../../lib/github-reconcile"
import { computeBackoff } from "../../lib/github-helpers"

type SyncJob = typeof reportSyncJobs.$inferSelect

// If a worker picks up a job (state='syncing') but crashes before completing,
// the row would otherwise stay in 'syncing' forever. We reset such rows back
// to 'pending' after STALE_SYNCING_MS so the drain loop can retry them.
// The threshold is generous vs. a normal webhook-triggered sync (seconds).
const STALE_SYNCING_MS = 10 * 60_000
const MAX_ATTEMPTS = 5

async function processJob(job: SyncJob): Promise<void> {
  await db
    .update(reportSyncJobs)
    .set({ state: "syncing", updatedAt: new Date() })
    .where(eq(reportSyncJobs.reportId, job.reportId))
  try {
    await reconcileReport(job.reportId)
    await db.delete(reportSyncJobs).where(eq(reportSyncJobs.reportId, job.reportId))
  } catch (err) {
    if (err instanceof ReconcileSkipped) {
      // reconcileReport has already deleted the job row before throwing
      // ReconcileSkipped (e.g. no connected integration). No DB update needed.
      return
    }
    const attempts = job.attempts + 1
    const backoffMs = computeBackoff(attempts)
    const state = attempts >= MAX_ATTEMPTS ? "failed" : "pending"
    await db
      .update(reportSyncJobs)
      .set({
        state,
        attempts,
        lastError: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        nextAttemptAt: new Date(Date.now() + backoffMs),
        updatedAt: new Date(),
      })
      .where(eq(reportSyncJobs.reportId, job.reportId))
  }
}

async function recoverStuckJobs(): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_SYNCING_MS)

  // Bump attempts on stale 'syncing' rows; if they've already burned through
  // their retry budget mark them 'failed' so the UI's "retry failed" action
  // can rescue them instead of looping stuck → pending → stuck forever.
  await db
    .update(reportSyncJobs)
    .set({
      state: sql`CASE WHEN ${reportSyncJobs.attempts} + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
      attempts: sql`${reportSyncJobs.attempts} + 1`,
      lastError: "worker crashed while syncing (recovered by stale-job sweep)",
      updatedAt: new Date(),
    })
    .where(and(eq(reportSyncJobs.state, "syncing"), lt(reportSyncJobs.updatedAt, staleThreshold)))
}

export default defineTask({
  meta: {
    name: "github:sync",
    description: "Drain report_sync_jobs by reconciling reports against GitHub",
  },
  async run() {
    await recoverStuckJobs()

    const batch = await db
      .select()
      .from(reportSyncJobs)
      .where(
        and(eq(reportSyncJobs.state, "pending"), lte(reportSyncJobs.nextAttemptAt, new Date())),
      )
      .orderBy(reportSyncJobs.nextAttemptAt)
      .limit(10)

    await Promise.all(batch.map(processJob))

    return { result: "ok", processed: batch.length }
  },
})
