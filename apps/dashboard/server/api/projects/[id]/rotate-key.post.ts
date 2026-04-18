import { createError, defineEventHandler, getRouterParam } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { projects } from "../../../db/schema"
import { requireProjectRole } from "../../../lib/permissions"
import { generatePublicKey } from "../../../lib/project-key"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing id" })
  await requireProjectRole(event, id, "owner")

  const newKey = generatePublicKey()
  const [updated] = await db
    .update(projects)
    .set({
      publicKey: newKey,
      publicKeyRegeneratedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id))
    .returning()
  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" })
  }

  return { publicKey: updated.publicKey }
})
