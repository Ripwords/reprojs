// apps/dashboard/server/api/projects/[id]/integrations/github/labels.post.ts
// Creates a new label on the project's linked GitHub repository. Any project
// member with developer+ role can create labels; this matches the "Labels"
// picker UX where a viewer sees chips read-only but a developer can type a
// new name and have it synced upstream.
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { eq } from "drizzle-orm"
import { CreateGithubLabelInput } from "@reprojs/shared"
import { db } from "../../../../../db"
import { githubIntegrations } from "../../../../../db/schema/github-integrations"
import { requireProjectRole } from "../../../../../lib/permissions"
import { getGithubClient } from "../../../../../lib/github"
import { githubCache, cacheKey } from "../../../../../lib/github-cache"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "Missing project id" })
  await requireProjectRole(event, projectId, "developer")
  const body = await readValidatedBody(event, (b) => CreateGithubLabelInput.parse(b))

  const [integration] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)

  if (
    !integration ||
    integration.status !== "connected" ||
    !integration.repoOwner ||
    !integration.repoName
  ) {
    throw createError({ statusCode: 409, statusMessage: "GitHub integration is not connected" })
  }

  const client = await getGithubClient(integration.installationId)
  try {
    const label = await client.createLabel(integration.repoOwner, integration.repoName, {
      name: body.name,
      ...(body.color !== undefined ? { color: body.color } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
    })

    // Invalidate the repo-labels cache so the next GET reflects the new label
    // immediately rather than waiting for the 5-minute TTL.
    githubCache.invalidate(
      cacheKey(
        Number(integration.installationId),
        integration.repoOwner,
        integration.repoName,
        "labels",
      ),
    )

    return { label }
  } catch (err) {
    // GitHub returns 422 for "already_exists" — surface a clean 409 so the UI
    // can distinguish it from validation errors and tell the user the label
    // is already in the repo's set.
    const status = (err as { status?: number })?.status
    if (status === 422) {
      throw createError({
        statusCode: 409,
        statusMessage: "A label with that name already exists in the repository",
      })
    }
    throw err
  }
})
