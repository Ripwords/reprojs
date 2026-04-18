import { createError, defineEventHandler, getRouterParam } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { projects } from "../../../db/schema"
import { requireProjectRole } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, id, "owner")

  await db
    .update(projects)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(projects.id, id))

  return { ok: true }
})
