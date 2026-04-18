import { createError, defineEventHandler, getRouterParam } from "h3"
import { getAppSlug, signInstallState } from "../../../../../lib/github"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const { session } = await requireProjectRole(event, projectId, "owner")
  const exp = Math.floor(Date.now() / 1000) + 10 * 60
  const state = signInstallState({ projectId, userId: session.userId, exp })
  const slug = getAppSlug()
  return {
    url: `https://github.com/apps/${slug}/installations/new?state=${state}`,
  }
})
