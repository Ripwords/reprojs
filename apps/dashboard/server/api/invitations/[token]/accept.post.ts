import { and, eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../db"
import { projectInvitations, projectMembers } from "../../../db/schema"
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
    // Idempotent replay — same payload as a fresh success.
    return { projectId: invite.projectId, role: invite.role }
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

  // Insert into project_members; catch the unique violation if the user was
  // concurrently added (or accepted twice in close succession).
  try {
    await db.insert(projectMembers).values({
      projectId: invite.projectId,
      userId: session.userId,
      role: invite.role,
      invitedBy: invite.invitedBy,
    })
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code !== "23505") throw err // not a unique violation — bubble up
  }

  await db
    .update(projectInvitations)
    .set({
      status: "accepted",
      acceptedAt: new Date(),
      acceptedBy: session.userId,
    })
    .where(and(eq(projectInvitations.id, invite.id), eq(projectInvitations.status, "pending")))

  return { projectId: invite.projectId, role: invite.role }
})
