import { defineEventHandler, readValidatedBody } from "h3"
import { CreateProjectInput } from "@feedback-tool/shared"
import { db } from "../../db"
import { projectMembers, projects } from "../../db/schema"
import { requireSession } from "../../lib/permissions"

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const body = await readValidatedBody(event, (b: unknown) => CreateProjectInput.parse(b))

  const [created] = await db
    .insert(projects)
    .values({ name: body.name, createdBy: session.userId })
    .returning()

  // Admin implicit owner → no row. Non-admin creator gets an owner row.
  if (session.role !== "admin") {
    await db.insert(projectMembers).values({
      projectId: created.id,
      userId: session.userId,
      role: "owner",
    })
  }

  return {
    id: created.id,
    name: created.name,
    createdBy: created.createdBy,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    effectiveRole: "owner" as const,
  }
})
