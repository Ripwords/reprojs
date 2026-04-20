import { createError, defineEventHandler, getRouterParam } from "h3"
import { getGithubAppCredentials } from "../../../../../lib/github-app-credentials"
import { signInstallState } from "../../../../../lib/github"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const { session } = await requireProjectRole(event, projectId, "owner")
  const creds = await getGithubAppCredentials()
  if (!creds) {
    throw createError({
      statusCode: 503,
      statusMessage: "GitHub integration is not configured on this instance",
    })
  }
  const exp = Math.floor(Date.now() / 1000) + 10 * 60
  const state = await signInstallState({ projectId, userId: session.userId, exp })
  return {
    url: `https://github.com/apps/${creds.slug}/installations/new?state=${state}`,
  }
})
