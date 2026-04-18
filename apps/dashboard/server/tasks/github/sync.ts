// apps/dashboard/server/tasks/github/sync.ts
import { and, eq, lte } from "drizzle-orm"
import { defineTask } from "nitropack/runtime"
import { db } from "../../db"
import { reportSyncJobs } from "../../db/schema"
import { ReconcileSkipped, reconcileReport } from "../../lib/github-reconcile"
import { computeBackoff } from "../../lib/github-helpers"

type SyncJob = typeof reportSyncJobs.$inferSelect

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
      await db
        .update(reportSyncJobs)
        .set({ state: "pending", updatedAt: new Date() })
        .where(eq(reportSyncJobs.reportId, job.reportId))
      return
    }
    const attempts = job.attempts + 1
    const backoffMs = computeBackoff(attempts)
    const state = attempts >= 5 ? "failed" : "pending"
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

export default defineTask({
  meta: {
    name: "github:sync",
    description: "Drain report_sync_jobs by reconciling reports against GitHub",
  },
  async run() {
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
