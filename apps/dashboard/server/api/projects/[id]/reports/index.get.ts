// apps/dashboard/server/api/projects/[id]/reports/index.get.ts
import { defineEventHandler, getQuery, getRouterParam } from "h3"
import { and, arrayContains, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm"
import {
  ReportPriority,
  ReportStatus,
  type ReportAssigneeDTO,
  type ReportContext,
  type ReportSummaryDTO,
} from "@repro/shared"
import { db } from "../../../../db"
import { reportAttachments, reports } from "../../../../db/schema"
import { user as userTable } from "../../../../db/schema/auth-schema"
import { buildSortClause, resolveAssigneeFilter } from "../../../../lib/inbox-query"
import { requireProjectRole } from "../../../../lib/permissions"

function parseCsv(v: unknown): string[] {
  if (typeof v !== "string") return []
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 10)
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw new Error("missing project id")
  const { session } = await requireProjectRole(event, id, "viewer")
  const sessionUserId = session.userId

  const q = getQuery(event)
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)))
  // Cap offset so `?offset=9999999999` can't force a whole-table scan. 100k
  // rows × a reasonable limit is already well past any human paging — deep
  // archaeology should switch to the filters, not pagination.
  const offset = Math.max(0, Math.min(Number(q.offset ?? 0), 100_000))
  const searchRaw = typeof q.q === "string" ? q.q.slice(0, 200).trim() : ""
  const orderBy = buildSortClause(typeof q.sort === "string" ? q.sort : "newest")

  const statusTokens = parseCsv(q.status).filter((v) => ReportStatus.safeParse(v).success)
  const priorityTokens = parseCsv(q.priority).filter((v) => ReportPriority.safeParse(v).success)
  const tagTokens = parseCsv(q.tag)
  const assigneeTokens = parseCsv(q.assignee)
  const assigneeFilters = resolveAssigneeFilter(assigneeTokens, sessionUserId)

  const whereParts: ReturnType<typeof eq>[] = [eq(reports.projectId, id)]
  if (statusTokens.length) whereParts.push(inArray(reports.status, statusTokens as ReportStatus[]))
  if (priorityTokens.length)
    whereParts.push(inArray(reports.priority, priorityTokens as ReportPriority[]))
  if (tagTokens.length) whereParts.push(arrayContains(reports.tags, tagTokens))
  if (assigneeFilters.length) {
    const userIds = assigneeFilters.filter((f) => f.type === "user").map((f) => f.userId)
    const wantUnassigned = assigneeFilters.some((f) => f.type === "null")
    const parts: ReturnType<typeof eq>[] = []
    if (userIds.length) parts.push(inArray(reports.assigneeId, userIds))
    if (wantUnassigned) parts.push(isNull(reports.assigneeId))
    if (parts.length === 1 && parts[0]) whereParts.push(parts[0])
    else if (parts.length > 1) {
      const combined = or(...parts)
      if (combined) whereParts.push(combined)
    }
  }
  if (searchRaw) {
    const pat = `%${searchRaw}%`
    const searchCondition = or(ilike(reports.title, pat), ilike(reports.description, pat))
    if (searchCondition) whereParts.push(searchCondition)
  }

  const whereClause = and(...whereParts)

  // Count, main fetch, and facets all use the same whereClause — run concurrently.
  const [countResult, rows, statusRows, priorityRows, assigneeRows, tagRows] = await Promise.all([
    db.select({ total: count() }).from(reports).where(whereClause),
    db
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
        attachmentId: reportAttachments.id,
        githubIssueNumber: reports.githubIssueNumber,
        githubIssueUrl: reports.githubIssueUrl,
      })
      .from(reports)
      .leftJoin(userTable, eq(userTable.id, reports.assigneeId))
      .leftJoin(
        reportAttachments,
        and(eq(reportAttachments.reportId, reports.id), eq(reportAttachments.kind, "screenshot")),
      )
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    db
      .select({ key: reports.status, c: count() })
      .from(reports)
      .where(whereClause)
      .groupBy(reports.status),
    db
      .select({ key: reports.priority, c: count() })
      .from(reports)
      .where(whereClause)
      .groupBy(reports.priority),
    db
      .select({
        id: reports.assigneeId,
        name: userTable.name,
        email: userTable.email,
        c: count(),
      })
      .from(reports)
      .leftJoin(userTable, eq(userTable.id, reports.assigneeId))
      .where(whereClause)
      .groupBy(reports.assigneeId, userTable.name, userTable.email),
    db
      .select({ name: sql<string>`unnest(${reports.tags})`.as("name"), c: count() })
      .from(reports)
      .where(whereClause)
      .groupBy(sql`name`)
      .orderBy(desc(count()))
      .limit(20),
  ])
  const total = countResult[0]?.total ?? 0

  // Determine which of the returned reports have a replay attachment.
  const reportIds = rows.map((r) => r.id)
  const replaySet = new Set<string>()
  if (reportIds.length > 0) {
    const replayRows = await db
      .select({ reportId: reportAttachments.reportId })
      .from(reportAttachments)
      .where(
        and(inArray(reportAttachments.reportId, reportIds), eq(reportAttachments.kind, "replay")),
      )
    for (const rr of replayRows) replaySet.add(rr.reportId)
  }

  const items: ReportSummaryDTO[] = rows.map((r) => {
    const ctx = r.context as ReportContext
    const assignee: ReportAssigneeDTO | null =
      r.assigneeId && r.assigneeEmail
        ? { id: r.assigneeId, name: r.assigneeName ?? null, email: r.assigneeEmail }
        : null
    return {
      id: r.id,
      title: r.title,
      description: r.description ?? null,
      context: ctx,
      reporterEmail: ctx.reporter?.email ?? null,
      pageUrl: ctx.pageUrl,
      receivedAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      thumbnailUrl: r.attachmentId
        ? `/api/projects/${id}/reports/${r.id}/attachment?kind=screenshot`
        : null,
      hasReplay: replaySet.has(r.id),
      status: r.status,
      priority: r.priority,
      tags: r.tags,
      githubIssueNumber: r.githubIssueNumber ?? null,
      githubIssueUrl: r.githubIssueUrl ?? null,
      assignee,
    }
  })

  const statusFacet: Record<string, number> = { open: 0, in_progress: 0, resolved: 0, closed: 0 }
  for (const r of statusRows) statusFacet[r.key] = r.c
  const priorityFacet: Record<string, number> = { low: 0, normal: 0, high: 0, urgent: 0 }
  for (const r of priorityRows) priorityFacet[r.key] = r.c

  return {
    items,
    total,
    facets: {
      status: statusFacet,
      priority: priorityFacet,
      assignees: assigneeRows.map((r) => ({
        id: r.id,
        name: r.name ?? null,
        email: r.email ?? null,
        count: r.c,
      })),
      tags: tagRows.map((r) => ({ name: r.name, count: r.c })),
    },
  }
})
