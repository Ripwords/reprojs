// apps/dashboard/server/lib/enqueue-sync.ts
import { eq } from "drizzle-orm"
import { db } from "../db"
import { githubIntegrations, reportSyncJobs } from "../db/schema"
import type { SyncJobPayload } from "../db/schema"

// Each enqueue must scope its UPSERT to a distinct signature — otherwise a
// pending reconcile and a pending comment_upsert collide on the composite PK
// `(reportId, signature)` and the later one overwrites the earlier. These
// constants/helpers keep the signature shape consistent across call sites.
const SIGNATURE_RECONCILE = "reconcile"
const signatureCommentUpsert = (commentId: string): string => `comment_upsert:${commentId}`
const signatureCommentDelete = (commentId: string): string => `comment_delete:${commentId}`

/**
 * UPSERT a pending reconcile job. Idempotent against other reconciles for the
 * same report; coexists with any pending comment jobs for that report.
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
      signature: SIGNATURE_RECONCILE,
      state: "pending",
      nextAttemptAt: new Date(),
      payload: { kind: "reconcile" },
    })
    .onConflictDoUpdate({
      target: [reportSyncJobs.reportId, reportSyncJobs.signature],
      set: { state: "pending", nextAttemptAt: new Date(), updatedAt: new Date() },
    })
}

/**
 * Insert a comment-specific sync job. One row per (report, comment) — rapid
 * edits to the same comment coalesce (bump nextAttemptAt), but a different
 * comment or a concurrent reconcile gets its own row.
 */
export async function enqueueCommentUpsert(reportId: string, commentId: string): Promise<void> {
  const payload: SyncJobPayload = { kind: "comment_upsert", commentId }
  await db
    .insert(reportSyncJobs)
    .values({
      reportId,
      signature: signatureCommentUpsert(commentId),
      state: "pending",
      nextAttemptAt: new Date(),
      payload,
    })
    .onConflictDoUpdate({
      target: [reportSyncJobs.reportId, reportSyncJobs.signature],
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
    .values({
      reportId,
      signature: signatureCommentDelete(commentId),
      state: "pending",
      nextAttemptAt: new Date(),
      payload,
    })
    .onConflictDoUpdate({
      target: [reportSyncJobs.reportId, reportSyncJobs.signature],
      set: { state: "pending", nextAttemptAt: new Date(), updatedAt: new Date(), payload },
    })
}
