// apps/dashboard/server/lib/enqueue-sync.ts
import { eq } from "drizzle-orm"
import { db } from "../db"
import { githubIntegrations, reportSyncJobs } from "../db/schema"

/**
 * UPSERT a pending sync job. Idempotent.
 * No-op if project has no connected integration.
 *
 * Note: always runs against the default db client (outside any caller transaction).
 * The enqueue is best-effort; the sync worker is idempotent so a brief consistency
 * gap between the outer write and the enqueue is acceptable.
 */
export async function enqueueSync(reportId: string, projectId: string): Promise<void> {
  const [gi] = await db
    .select({ status: githubIntegrations.status })
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)
  if (!gi || gi.status !== "connected") return
  await db
    .insert(reportSyncJobs)
    .values({ reportId, state: "pending", nextAttemptAt: new Date() })
    .onConflictDoUpdate({
      target: reportSyncJobs.reportId,
      set: { state: "pending", nextAttemptAt: new Date(), updatedAt: new Date() },
    })
}
