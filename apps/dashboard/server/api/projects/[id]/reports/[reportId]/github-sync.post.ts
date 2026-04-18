// apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-sync.post.ts
import { and, eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../../../db"
import { reports } from "../../../../../db/schema"
import { enqueueSync } from "../../../../../lib/enqueue-sync"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  await requireProjectRole(event, projectId, "developer")

  // Verify the report actually belongs to this project — without this check,
  // a developer on project A could pass a reportId from project B and
  // enqueueSync would silently no-op. Project only `id` to match the
  // column-projection pattern used elsewhere.
  const [existing] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.projectId, projectId)))
    .limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: "Report not found" })

  await enqueueSync(reportId, projectId)
  return { ok: true }
})
