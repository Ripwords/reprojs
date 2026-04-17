import { defineEventHandler, getRouterParam } from "h3"
import { eq } from "drizzle-orm"
import type { ProjectMemberDTO } from "@feedback-tool/shared"
import { db } from "../../../../db"
import { projectMembers } from "../../../../db/schema"
import { user } from "../../../../db/schema"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event): Promise<ProjectMemberDTO[]> => {
  const id = getRouterParam(event, "id")!
  await requireProjectRole(event, id, "viewer")

  const rows = await db
    .select({
      userId: projectMembers.userId,
      email: user.email,
      name: user.name,
      role: projectMembers.role,
      joinedAt: projectMembers.joinedAt,
    })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, id))

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name ?? null,
    role: r.role as ProjectMemberDTO["role"],
    joinedAt: r.joinedAt.toISOString(),
  }))
})
