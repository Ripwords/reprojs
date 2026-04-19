import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { eq } from "drizzle-orm"
import { UpdateGithubConfigInput } from "@reprokit/shared"
import { db } from "../../../../../db"
import { githubIntegrations } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "owner")
  const body = await readValidatedBody(event, (b) => UpdateGithubConfigInput.parse(b))

  const [existing] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "GitHub integration not installed" })
  }

  await db
    .update(githubIntegrations)
    .set({
      ...(body.repoOwner !== undefined ? { repoOwner: body.repoOwner } : {}),
      ...(body.repoName !== undefined ? { repoName: body.repoName } : {}),
      ...(body.defaultLabels !== undefined ? { defaultLabels: body.defaultLabels } : {}),
      ...(body.defaultAssignees !== undefined ? { defaultAssignees: body.defaultAssignees } : {}),
      updatedAt: new Date(),
    })
    .where(eq(githubIntegrations.projectId, projectId))

  return { ok: true }
})
