// apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/[commentId].delete.ts
import { createError, defineEventHandler, getRouterParam, setResponseStatus } from "h3"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../../../../../../db"
import { reportComments } from "../../../../../../db/schema/report-comments"
import { reportSyncJobs } from "../../../../../../db/schema/github-integrations"
import { requireProjectRole } from "../../../../../../lib/permissions"
import { publishReportStream } from "../../../../../../lib/report-events-bus"
import { enqueueCommentDelete } from "../../../../../../lib/enqueue-sync"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  const commentId = getRouterParam(event, "commentId")
  if (!projectId || !reportId || !commentId) {
    throw createError({ statusCode: 400, statusMessage: "Missing ids" })
  }

  const { session, effectiveRole } = await requireProjectRole(event, projectId, "manager")

  const [comment] = await db
    .select()
    .from(reportComments)
    .where(
      and(
        eq(reportComments.id, commentId),
        eq(reportComments.reportId, reportId),
        isNull(reportComments.deletedAt),
      ),
    )
    .limit(1)

  if (!comment) throw createError({ statusCode: 404, statusMessage: "Comment not found" })

  // Permission: author can delete their own; owner can delete any
  const isAuthor = comment.userId === session.userId
  const isOwner = effectiveRole === "owner"
  if (!isAuthor && !isOwner) {
    throw createError({ statusCode: 403, statusMessage: "Insufficient permission" })
  }

  // Soft-delete
  await db
    .update(reportComments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(reportComments.id, commentId))

  if (comment.githubCommentId !== null) {
    // If linked to GitHub → enqueue a delete job
    await enqueueCommentDelete(reportId, commentId, comment.githubCommentId)
  } else {
    // Not yet synced: if there's a pending upsert job for this report, clear it
    // so we don't push a comment that was immediately deleted
    const [existingJob] = await db
      .select()
      .from(reportSyncJobs)
      .where(eq(reportSyncJobs.reportId, reportId))
      .limit(1)

    if (existingJob) {
      const payload = existingJob.payload
      if (payload && payload.kind === "comment_upsert" && payload.commentId === commentId) {
        await db.delete(reportSyncJobs).where(eq(reportSyncJobs.reportId, reportId))
      }
    }
  }

  publishReportStream(reportId, {
    kind: "comment_deleted",
    payload: { commentId },
  })

  setResponseStatus(event, 204)
  return null
})
