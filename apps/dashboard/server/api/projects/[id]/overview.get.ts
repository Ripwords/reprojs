// apps/dashboard/server/api/projects/[id]/overview.get.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm"
import type { ProjectOverviewDTO } from "@feedback-tool/shared"
import { db } from "../../../db"
import { githubIntegrations, reportEvents, reportSyncJobs, reports, user } from "../../../db/schema"
import { requireProjectRole } from "../../../lib/permissions"

const DAY_MS = 86_400_000
const VOLUME_DAYS = 7

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export default defineEventHandler(async (event): Promise<ProjectOverviewDTO> => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "viewer")

  const now = new Date()
  const today = startOfUtcDay(now)
  const sevenDaysAgo = new Date(today.getTime() - (VOLUME_DAYS - 1) * DAY_MS)

  const [
    totalRows,
    statusCounts,
    priorityCounts,
    last7Rows,
    volumeRows,
    gi,
    syncJobRows,
    linkedRows,
    eventRows,
  ] = await Promise.all([
    db.select({ total: count() }).from(reports).where(eq(reports.projectId, projectId)),

    db
      .select({ key: reports.status, c: count() })
      .from(reports)
      .where(eq(reports.projectId, projectId))
      .groupBy(reports.status),

    db
      .select({ key: reports.priority, c: count() })
      .from(reports)
      .where(eq(reports.projectId, projectId))
      .groupBy(reports.priority),

    db
      .select({ last7: count() })
      .from(reports)
      .where(and(eq(reports.projectId, projectId), gte(reports.createdAt, sevenDaysAgo))),

    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${reports.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`.as(
          "day",
        ),
        c: count(),
      })
      .from(reports)
      .where(and(eq(reports.projectId, projectId), gte(reports.createdAt, sevenDaysAgo)))
      .groupBy(sql`day`),

    db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, projectId))
      .limit(1)
      .then((rows) => rows[0] ?? null),

    db
      .select({ state: reportSyncJobs.state, c: count() })
      .from(reportSyncJobs)
      .innerJoin(reports, eq(reports.id, reportSyncJobs.reportId))
      .where(eq(reports.projectId, projectId))
      .groupBy(reportSyncJobs.state),

    db
      .select({ linked: count() })
      .from(reports)
      .where(and(eq(reports.projectId, projectId), isNotNull(reports.githubIssueNumber))),

    db
      .select({
        id: reportEvents.id,
        reportId: reportEvents.reportId,
        reportTitle: reports.title,
        kind: reportEvents.kind,
        payload: reportEvents.payload,
        actorId: reportEvents.actorId,
        actorEmail: user.email,
        actorName: user.name,
        createdAt: reportEvents.createdAt,
      })
      .from(reportEvents)
      .innerJoin(reports, eq(reports.id, reportEvents.reportId))
      .leftJoin(user, eq(user.id, reportEvents.actorId))
      .where(eq(reports.projectId, projectId))
      .orderBy(desc(reportEvents.createdAt))
      .limit(10),
  ])

  const total = totalRows[0]?.total ?? 0
  const last7 = last7Rows[0]?.last7 ?? 0
  const linked = linkedRows[0]?.linked ?? 0
  const syncJobStateCounts = new Map(syncJobRows.map((r) => [r.state, r.c]))
  const failed = syncJobStateCounts.get("failed") ?? 0
  const pending = syncJobStateCounts.get("pending") ?? 0
  const syncing = syncJobStateCounts.get("syncing") ?? 0

  const byStatus = { open: 0, in_progress: 0, resolved: 0, closed: 0 } as Record<string, number>
  for (const r of statusCounts) byStatus[r.key] = r.c

  const byPriority = { urgent: 0, high: 0, normal: 0, low: 0 } as Record<string, number>
  for (const r of priorityCounts) byPriority[r.key] = r.c

  const countsByDay = new Map<string, number>()
  for (const r of volumeRows) countsByDay.set(r.day, r.c)
  const volume: Array<{ date: string; count: number }> = []
  for (let i = 0; i < VOLUME_DAYS; i++) {
    const d = new Date(sevenDaysAgo.getTime() + i * DAY_MS)
    const key = d.toISOString().slice(0, 10)
    volume.push({ date: key, count: countsByDay.get(key) ?? 0 })
  }

  return {
    counts: {
      total,
      byStatus: byStatus as ProjectOverviewDTO["counts"]["byStatus"],
      byPriority: byPriority as ProjectOverviewDTO["counts"]["byPriority"],
      last7Days: last7,
    },
    volume,
    github: {
      installed: !!gi,
      status: gi?.status ?? null,
      repo: gi?.repoOwner && gi?.repoName ? `${gi.repoOwner}/${gi.repoName}` : null,
      linkedCount: linked,
      failedCount: failed,
      pendingCount: pending,
      syncingCount: syncing,
      lastSyncedAt: gi?.updatedAt ? gi.updatedAt.toISOString() : null,
    },
    recentEvents: eventRows.map((e) => ({
      id: e.id,
      reportId: e.reportId,
      reportTitle: e.reportTitle,
      kind: e.kind as ProjectOverviewDTO["recentEvents"][number]["kind"],
      payload: e.payload as Record<string, unknown>,
      actor: e.actorId
        ? { id: e.actorId, email: e.actorEmail ?? "", name: e.actorName ?? null }
        : null,
      createdAt: e.createdAt.toISOString(),
    })),
  }
})
