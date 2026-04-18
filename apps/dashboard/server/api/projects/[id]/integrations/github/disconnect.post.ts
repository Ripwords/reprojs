import { createError, defineEventHandler, getRouterParam } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { githubIntegrations } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "owner")
  await db
    .update(githubIntegrations)
    .set({ status: "disconnected", updatedAt: new Date() })
    .where(eq(githubIntegrations.projectId, projectId))
  return { ok: true }
})
