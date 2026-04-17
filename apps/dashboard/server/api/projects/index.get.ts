import { defineEventHandler } from "h3"
import { and, desc, eq, isNull } from "drizzle-orm"
import type { ProjectDTO } from "@feedback-tool/shared"
import { db } from "../../db"
import { projectMembers, projects } from "../../db/schema"
import { requireSession } from "../../lib/permissions"

export default defineEventHandler(async (event): Promise<ProjectDTO[]> => {
  const session = await requireSession(event)

  if (session.role === "admin") {
    const rows = await db
      .select()
      .from(projects)
      .where(isNull(projects.deletedAt))
      .orderBy(desc(projects.createdAt))

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      effectiveRole: "owner",
    }))
  }

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      createdBy: projects.createdBy,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      role: projectMembers.role,
    })
    .from(projects)
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projectMembers.userId, session.userId), isNull(projects.deletedAt)))
    .orderBy(desc(projects.createdAt))

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    effectiveRole: r.role as "viewer" | "developer" | "owner",
  }))
})
