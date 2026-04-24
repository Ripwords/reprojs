// apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.get.ts
//
// Single-report detail endpoint. Shape matches one item from the list endpoint
// (index.get.ts) so the inbox row and the dedicated report page share a single
// DTO contract.
import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, eq } from "drizzle-orm"
import type { ReportContext, ReportSummaryDTO } from "@reprojs/shared"
import { db } from "../../../../../db"
import { reportAssignees, reportAttachments, reports } from "../../../../../db/schema"
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
      source: reports.source,
      devicePlatform: reports.devicePlatform,
      githubIssueNumber: reports.githubIssueNumber,
      githubIssueUrl: reports.githubIssueUrl,
      milestoneNumber: reports.milestoneNumber,
      milestoneTitle: reports.milestoneTitle,
    })
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.projectId, projectId)))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "Report not found" })
  }

  // Parallel: screenshot thumbnail + replay existence + assignees.
  // Mirrors how the list endpoint computes `thumbnailUrl` and `hasReplay`.
  const [screenshotRows, replayRows, assigneeRows] = await Promise.all([
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
    db
      .select({
        userId: reportAssignees.userId,
        githubLogin: reportAssignees.githubLogin,
        githubAvatarUrl: reportAssignees.githubAvatarUrl,
        name: userTable.name,
        email: userTable.email,
      })
      .from(reportAssignees)
      .leftJoin(userTable, eq(userTable.id, reportAssignees.userId))
      .where(eq(reportAssignees.reportId, reportId)),
  ])

  const ctx = row.context as ReportContext

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
    source: row.source,
    devicePlatform: row.devicePlatform ?? null,
    githubIssueNumber: row.githubIssueNumber ?? null,
    githubIssueUrl: row.githubIssueUrl ?? null,
    milestoneNumber: row.milestoneNumber ?? null,
    milestoneTitle: row.milestoneTitle ?? null,
    assignees: assigneeRows.map((a) => ({
      id: a.userId,
      name: a.name ?? null,
      email: a.email ?? null,
      githubLogin: a.githubLogin,
      githubAvatarUrl: a.githubAvatarUrl,
    })),
  }
})
