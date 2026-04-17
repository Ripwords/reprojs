import { defineEventHandler, getQuery, getRouterParam } from "h3"
import { and, count, desc, eq } from "drizzle-orm"
import type { ReportContext } from "@feedback-tool/shared"
import { db } from "../../../../db"
import { reports, reportAttachments } from "../../../../db/schema"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw new Error("missing project id")
  await requireProjectRole(event, id, "viewer")

  const q = getQuery(event)
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)))
  const offset = Math.max(0, Number(q.offset ?? 0))

  const [{ total }] = await db
    .select({ total: count() })
    .from(reports)
    .where(eq(reports.projectId, id))

  const rows = await db
    .select({
      id: reports.id,
      title: reports.title,
      description: reports.description,
      context: reports.context,
      createdAt: reports.createdAt,
      attachmentId: reportAttachments.id,
    })
    .from(reports)
    .leftJoin(
      reportAttachments,
      and(eq(reportAttachments.reportId, reports.id), eq(reportAttachments.kind, "screenshot")),
    )
    .where(eq(reports.projectId, id))
    .orderBy(desc(reports.createdAt))
    .limit(limit)
    .offset(offset)

  const items = rows.map((r) => {
    const ctx = r.context as ReportContext
    return {
      id: r.id,
      title: r.title,
      description: r.description ?? null,
      context: ctx,
      reporterEmail: ctx.reporter?.email ?? null,
      pageUrl: ctx.pageUrl,
      receivedAt: r.createdAt.toISOString(),
      thumbnailUrl: r.attachmentId
        ? `/api/projects/${id}/reports/${r.id}/attachment?kind=screenshot`
        : null,
    }
  })

  return { items, total }
})
