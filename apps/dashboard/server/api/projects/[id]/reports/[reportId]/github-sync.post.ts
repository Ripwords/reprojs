// apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-sync.post.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { enqueueSync } from "../../../../../lib/enqueue-sync"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  await requireProjectRole(event, projectId, "developer")
  await enqueueSync(reportId, projectId)
  return { ok: true }
})
