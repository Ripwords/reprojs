import { eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../db"
import { projectInvitations, projects, user } from "../../../db/schema"
import { requireSession } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token")
  if (!token) throw createError({ statusCode: 400, statusMessage: "missing token" })
  const session = await requireSession(event)

  const [invite] = await db
    .select()
    .from(projectInvitations)
    .where(eq(projectInvitations.token, token))
  if (!invite) throw createError({ statusCode: 404, statusMessage: "Invitation not found" })

  if (session.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw createError({ statusCode: 403, statusMessage: "email_mismatch" })
  }

  if (invite.status === "accepted") {
    throw createError({ statusCode: 409, statusMessage: "already_accepted" })
  }
  if (invite.status === "revoked") {
    throw createError({ statusCode: 409, statusMessage: "revoked" })
  }
  if (invite.status === "expired" || invite.expiresAt.getTime() < Date.now()) {
    if (invite.status !== "expired") {
      await db
        .update(projectInvitations)
        .set({ status: "expired" })
        .where(eq(projectInvitations.id, invite.id))
    }
    throw createError({ statusCode: 409, statusMessage: "expired" })
  }

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
