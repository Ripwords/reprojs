import { eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../db"
import { projectInvitations, projects, user } from "../../../db/schema"
import { requireSession } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token")
  if (!token) throw createError({ statusCode: 400, statusMessage: "missing token" })
  await requireSession(event)

  const [invite] = await db
    .select()
    .from(projectInvitations)
    .where(eq(projectInvitations.token, token))
  if (!invite) throw createError({ statusCode: 404, statusMessage: "Invitation not found" })

  const [project] = await db.select().from(projects).where(eq(projects.id, invite.projectId))
  const [inviter] = await db.select().from(user).where(eq(user.id, invite.invitedBy))

  return {
    token,
    projectId: invite.projectId,
    projectName: project?.name ?? "",
    role: invite.role,
    email: invite.email,
    inviterName: inviter?.name ?? null,
    inviterEmail: inviter?.email ?? null,
    expiresAt: invite.expiresAt.toISOString(),
  }
})
