// apps/dashboard/server/api/projects/[id]/integrations/github/index.get.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, desc, eq } from "drizzle-orm"
import type { GithubConfigDTO } from "@feedback-tool/shared"
import { db } from "../../../../../db"
import { githubIntegrations, reports, reportSyncJobs } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event): Promise<GithubConfigDTO> => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "viewer")

  const [gi] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)

  if (!gi) {
    return {
      installed: false,
      status: null,
      repoOwner: "",
      repoName: "",
      defaultLabels: [],
      defaultAssignees: [],
      lastSyncedAt: null,
      failedJobs: [],
    }
  }

  const failedJobs = await db
    .select({
      reportId: reportSyncJobs.reportId,
      reportTitle: reports.title,
      attempts: reportSyncJobs.attempts,
      lastError: reportSyncJobs.lastError,
      updatedAt: reportSyncJobs.updatedAt,
    })
    .from(reportSyncJobs)
    .innerJoin(reports, eq(reports.id, reportSyncJobs.reportId))
    .where(and(eq(reports.projectId, projectId), eq(reportSyncJobs.state, "failed")))
    .orderBy(desc(reportSyncJobs.updatedAt))
    .limit(50)

  return {
    installed: true,
    status: gi.status,
    repoOwner: gi.repoOwner,
    repoName: gi.repoName,
    defaultLabels: gi.defaultLabels,
    defaultAssignees: gi.defaultAssignees,
    lastSyncedAt: gi.updatedAt.toISOString(),
    failedJobs: failedJobs.map((j) => ({
      reportId: j.reportId,
      reportTitle: j.reportTitle,
      attempts: j.attempts,
      lastError: j.lastError,
      updatedAt: j.updatedAt.toISOString(),
    })),
  }
})
