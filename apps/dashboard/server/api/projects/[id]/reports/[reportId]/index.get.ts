// apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.get.ts
//
// Single-report detail endpoint. Shape matches one item from the list endpoint
// (index.get.ts) so the inbox row and the dedicated report page share a single
// DTO contract.
import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, eq } from "drizzle-orm"
import type { ReportAssigneeDTO, ReportContext, ReportSummaryDTO } from "@reprojs/shared"
import { db } from "../../../../../db"
import { reportAttachments, reports } from "../../../../../db/schema"
import { user as userTable } from "../../../../../db/schema/auth-schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event): Promise<ReportSummaryDTO> => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  await requireProjectRole(event, projectId, "viewer")

  const [row] = await db
    .select({
      id: reports.id,
      title: reports.title,
      description: reports.description,
      context: reports.context,
      createdAt: reports.createdAt,
      updatedAt: reports.updatedAt,
      status: reports.status,
      priority: reports.priority,
      tags: reports.tags,
      assigneeId: reports.assigneeId,
      assigneeName: userTable.name,
      assigneeEmail: userTable.email,
      githubIssueNumber: reports.githubIssueNumber,
      githubIssueUrl: reports.githubIssueUrl,
    })
    .from(reports)
    .leftJoin(userTable, eq(userTable.id, reports.assigneeId))
    .where(and(eq(reports.id, reportId), eq(reports.projectId, projectId)))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "Report not found" })
  }

  // Parallel: screenshot thumbnail + replay existence. Mirrors how the list
  // endpoint computes `thumbnailUrl` and `hasReplay`.
  const [screenshotRows, replayRows] = await Promise.all([
    db
      .select({ id: reportAttachments.id })
      .from(reportAttachments)
      .where(
        and(eq(reportAttachments.reportId, reportId), eq(reportAttachments.kind, "screenshot")),
      )
      .limit(1),
    db
      .select({ id: reportAttachments.id })
      .from(reportAttachments)
      .where(and(eq(reportAttachments.reportId, reportId), eq(reportAttachments.kind, "replay")))
      .limit(1),
  ])

  const ctx = row.context as ReportContext
  const assignee: ReportAssigneeDTO | null =
    row.assigneeId && row.assigneeEmail
      ? { id: row.assigneeId, name: row.assigneeName ?? null, email: row.assigneeEmail }
      : null

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    context: ctx,
    reporterEmail: ctx.reporter?.email ?? null,
    pageUrl: ctx.pageUrl,
    thumbnailUrl:
      screenshotRows.length > 0
        ? `/api/projects/${projectId}/reports/${reportId}/attachment?kind=screenshot`
        : null,
    hasReplay: replayRows.length > 0,
    receivedAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    status: row.status,
    priority: row.priority,
    tags: row.tags,
    githubIssueNumber: row.githubIssueNumber ?? null,
    githubIssueUrl: row.githubIssueUrl ?? null,
    assignee,
  }
})
