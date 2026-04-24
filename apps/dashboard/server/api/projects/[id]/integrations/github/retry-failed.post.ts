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

  // Scope by project, then flip every failed row — including multiple failed
  // rows per report (one per signature) — back to pending. `state = 'failed'`
  // must stay on the UPDATE itself so we don't inadvertently reset pending or
  // syncing siblings for the same report.
  const reportIds = (
    await db.select({ id: reports.id }).from(reports).where(eq(reports.projectId, projectId))
  ).map((r) => r.id)

  if (reportIds.length === 0) return { retried: 0 }

  const result = await db
    .update(reportSyncJobs)
    .set({ state: "pending", nextAttemptAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(reportSyncJobs.reportId, reportIds), eq(reportSyncJobs.state, "failed")))
    .returning({ reportId: reportSyncJobs.reportId, signature: reportSyncJobs.signature })

  return { retried: result.length }
})
