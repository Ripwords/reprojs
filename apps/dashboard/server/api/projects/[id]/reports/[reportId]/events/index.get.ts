import { createError, defineEventHandler, getQuery, getRouterParam } from "h3"
import { and, count, desc, eq } from "drizzle-orm"
import type { ReportEventDTO } from "@reprojs/shared"
import { db } from "../../../../../../db"
import { reportEvents, reports } from "../../../../../../db/schema"
import { user as userTable } from "../../../../../../db/schema/auth-schema"
import { requireProjectRole } from "../../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!id || !reportId) throw createError({ statusCode: 400, statusMessage: "missing params" })
  await requireProjectRole(event, id, "viewer")

  // Confirm the report belongs to this project before returning anything.
  const [owned] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.projectId, id)))
    .limit(1)
  if (!owned) throw createError({ statusCode: 404, statusMessage: "Report not found" })

  const q = getQuery(event)
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)))
  const offset = Math.max(0, Number(q.offset ?? 0))

  const [countResult, rows] = await Promise.all([
    db.select({ total: count() }).from(reportEvents).where(eq(reportEvents.reportId, reportId)),
    db
      .select({
        id: reportEvents.id,
        createdAt: reportEvents.createdAt,
        kind: reportEvents.kind,
        payload: reportEvents.payload,
        actorId: reportEvents.actorId,
        actorName: userTable.name,
        actorEmail: userTable.email,
      })
      .from(reportEvents)
      .leftJoin(userTable, eq(userTable.id, reportEvents.actorId))
      .where(eq(reportEvents.reportId, reportId))
      .orderBy(desc(reportEvents.createdAt))
      .limit(limit)
      .offset(offset),
  ])
  const total = countResult[0]?.total ?? 0

  const items: ReportEventDTO[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    kind: r.kind,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    actor:
      r.actorId && r.actorEmail
        ? { id: r.actorId, name: r.actorName ?? null, email: r.actorEmail }
        : null,
  }))

  return { items, total }
})
