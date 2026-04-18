// apps/dashboard/server/api/projects/[id]/integrations/github/repositories.get.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { githubIntegrations } from "../../../../../db/schema"
import { getGithubClient } from "../../../../../lib/github"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "developer")

  const [gi] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)

  if (!gi || gi.status !== "connected") {
    throw createError({ statusCode: 409, statusMessage: "integration not connected" })
  }

  const client = getGithubClient(gi.installationId)
  const repos = await client.listInstallationRepositories()
  return { repos }
})
