// apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-unlink.post.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { reportEvents, reports, reportSyncJobs } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  const { session } = await requireProjectRole(event, projectId, "developer")

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.id, reportId), eq(reports.projectId, projectId)))
      .limit(1)
    if (!current) throw createError({ statusCode: 404, statusMessage: "report not found" })
    if (current.githubIssueNumber == null) {
      return { ok: true, unlinked: false }
    }

    await tx
      .update(reports)
      .set({
        githubIssueNumber: null,
        githubIssueNodeId: null,
        githubIssueUrl: null,
        updatedAt: new Date(),
      })
      .where(eq(reports.id, reportId))

    await tx.delete(reportSyncJobs).where(eq(reportSyncJobs.reportId, reportId))

    await tx.insert(reportEvents).values({
      reportId,
      projectId,
      actorId: session.userId,
      kind: "github_unlinked",
      payload: {
        number: current.githubIssueNumber,
        url: current.githubIssueUrl,
      },
    })

    return { ok: true, unlinked: true }
  })
})
