// apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-sync.post.ts
import { and, eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../../../db"
import { githubIntegrations, reports } from "../../../../../db/schema"
import { enqueueSync } from "../../../../../lib/enqueue-sync"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  await requireProjectRole(event, projectId, "manager")

  // Verify the report actually belongs to this project — without this check,
  // a developer on project A could pass a reportId from project B and
  // enqueueSync would silently no-op.
  const [existing] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.projectId, projectId)))
    .limit(1)
  if (!existing) throw createError({ statusCode: 404, statusMessage: "Report not found" })

  // Guard: without a connected GitHub integration for this project, the
  // sync job would be queued and then fail silently when the worker tried
  // to call the GitHub API. The client pre-gates the button on integration
  // state, but enforce it here too so a stale client or direct API call
  // can't enqueue a doomed job (and get a misleading success response).
  const [integration] = await db
    .select({ status: githubIntegrations.status })
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)
  if (!integration) {
    throw createError({
      statusCode: 409,
      statusMessage: "GitHub integration not installed for this project",
    })
  }
  if (integration.status !== "connected") {
    throw createError({
      statusCode: 409,
      statusMessage: "GitHub integration is disconnected — reconnect to create issues",
    })
  }

  await enqueueSync(reportId, projectId)
  return { ok: true }
})
