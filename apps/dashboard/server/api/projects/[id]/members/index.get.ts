import { createError, defineEventHandler, getQuery, getRouterParam } from "h3"
import { and, eq, inArray } from "drizzle-orm"
import { ProjectRole, type ProjectMemberDTO } from "@reprojs/shared"
import { db } from "../../../../db"
import { projectMembers } from "../../../../db/schema"
import { user } from "../../../../db/schema"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event): Promise<ProjectMemberDTO[]> => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, id, "viewer")

  const roleParam = getQuery(event).role
  const roleTokens = (typeof roleParam === "string" ? roleParam : "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ProjectRole.safeParse(s).success)
    .slice(0, 3) as Array<ProjectMemberDTO["role"]>

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
    .where(
      roleTokens.length
        ? and(eq(projectMembers.projectId, id), inArray(projectMembers.role, roleTokens))
        : eq(projectMembers.projectId, id),
    )

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name ?? null,
    role: r.role as ProjectMemberDTO["role"],
    joinedAt: r.joinedAt.toISOString(),
  }))
})
