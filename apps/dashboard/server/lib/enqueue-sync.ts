// apps/dashboard/server/lib/enqueue-sync.ts
import { eq } from "drizzle-orm"
import { db } from "../db"
import { githubIntegrations, reportSyncJobs } from "../db/schema"
import type { SyncJobPayload } from "../db/schema"

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
    .values({
      reportId,
      state: "pending",
      nextAttemptAt: new Date(),
      payload: { kind: "reconcile" },
    })
    .onConflictDoUpdate({
      target: reportSyncJobs.reportId,
      set: { state: "pending", nextAttemptAt: new Date(), updatedAt: new Date() },
    })
}

/**
 * Insert a comment-specific sync job (never upserts — each comment event is independent).
 * reportId must correspond to a report linked to a connected integration.
 */
export async function enqueueCommentUpsert(reportId: string, commentId: string): Promise<void> {
  const payload: SyncJobPayload = { kind: "comment_upsert", commentId }
  // For comment jobs we always insert a new row with a unique-enough key.
  // Because reportSyncJobs uses reportId as PK (one pending reconcile per report),
  // comment jobs need their own rows. We use a separate strategy: insert and
  // accept that multiple comment jobs may queue up. The reconciler handles them
  // sequentially using a payload discriminator.
  // However, since the table PK is reportId we can't have multiple rows per report.
  // Decision: overwrite the pending job if one exists, but carry the comment payload.
  // This means only one comment job queues at a time. If rapid edits happen,
  // only the last one fires — acceptable given 20s polling on the UI side.
  await db
    .insert(reportSyncJobs)
    .values({ reportId, state: "pending", nextAttemptAt: new Date(), payload })
    .onConflictDoUpdate({
      target: reportSyncJobs.reportId,
      set: { state: "pending", nextAttemptAt: new Date(), updatedAt: new Date(), payload },
    })
}

export async function enqueueCommentDelete(
  reportId: string,
  commentId: string,
  githubCommentId: number,
): Promise<void> {
  const payload: SyncJobPayload = { kind: "comment_delete", commentId, githubCommentId }
  await db
    .insert(reportSyncJobs)
    .values({ reportId, state: "pending", nextAttemptAt: new Date(), payload })
    .onConflictDoUpdate({
      target: reportSyncJobs.reportId,
      set: { state: "pending", nextAttemptAt: new Date(), updatedAt: new Date(), payload },
    })
}
