import { defineEventHandler, readValidatedBody } from "h3"
import { eq } from "drizzle-orm"
import { CreateProjectInput } from "@feedback-tool/shared"
import { db } from "../../db"
import { projectMembers, projects } from "../../db/schema"
import { requireSession } from "../../lib/permissions"
import { slugify } from "../../lib/slug"

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const body = await readValidatedBody(event, (b: unknown) => CreateProjectInput.parse(b))

  const baseSlug = slugify(body.name)
  let slug = baseSlug
  let suffix = 1
  while (
    (await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1))
      .length > 0
  ) {
    slug = `${baseSlug}-${suffix++}`
  }

  const [created] = await db
    .insert(projects)
    .values({ name: body.name, slug, createdBy: session.userId })
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
    slug: created.slug,
    createdBy: created.createdBy,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    effectiveRole: "owner" as const,
  }
})
