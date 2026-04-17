import { createError, defineEventHandler, getRouterParam } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { projects } from "../../../db/schema"
import { requireProjectRole } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!
  const { effectiveRole } = await requireProjectRole(event, id, "viewer")

  const [p] = await db.select().from(projects).where(eq(projects.id, id))
  if (!p || p.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" })
  }

  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    effectiveRole,
  }
})
