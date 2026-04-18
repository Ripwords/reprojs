// apps/dashboard/server/api/projects/[id]/integrations/github/retry-failed.post.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "../../../../../db"
import { reports, reportSyncJobs } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "developer")

  const failedIds = await db
    .select({ reportId: reportSyncJobs.reportId })
    .from(reportSyncJobs)
    .innerJoin(reports, eq(reports.id, reportSyncJobs.reportId))
    .where(and(eq(reports.projectId, projectId), eq(reportSyncJobs.state, "failed")))

  if (failedIds.length === 0) return { retried: 0 }

  const ids = failedIds.map((r) => r.reportId)
  await db
    .update(reportSyncJobs)
    .set({ state: "pending", nextAttemptAt: new Date(), updatedAt: new Date() })
    .where(inArray(reportSyncJobs.reportId, ids))

  return { retried: ids.length }
})
