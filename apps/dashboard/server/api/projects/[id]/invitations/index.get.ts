import { and, eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../../db"
import { projectInvitations, user } from "../../../../db/schema"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "owner")

  const rows = await db
    .select({
      id: projectInvitations.id,
      projectId: projectInvitations.projectId,
      email: projectInvitations.email,
      role: projectInvitations.role,
      status: projectInvitations.status,
      invitedByUserId: projectInvitations.invitedBy,
      invitedByEmail: user.email,
      createdAt: projectInvitations.createdAt,
      expiresAt: projectInvitations.expiresAt,
    })
    .from(projectInvitations)
    .leftJoin(user, eq(user.id, projectInvitations.invitedBy))
    .where(
      and(eq(projectInvitations.projectId, projectId), eq(projectInvitations.status, "pending")),
    )
    .orderBy(projectInvitations.createdAt)

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
  }))
})
