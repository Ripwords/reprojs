import { defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { eq } from "drizzle-orm"
import { UpdateProjectInput } from "@feedback-tool/shared"
import { db } from "../../../db"
import { projects } from "../../../db/schema"
import { requireProjectRole } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!
  await requireProjectRole(event, id, "owner")
  const body = await readValidatedBody(event, (b: unknown) => UpdateProjectInput.parse(b))

  const [updated] = await db
    .update(projects)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning()

  return {
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    createdBy: updated.createdBy,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    effectiveRole: "owner" as const,
  }
})
