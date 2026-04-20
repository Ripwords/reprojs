import { eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../db"
import { projectInvitations } from "../../../db/schema"
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
  if (invite.status !== "pending") {
    throw createError({ statusCode: 409, statusMessage: invite.status })
  }

  await db
    .update(projectInvitations)
    .set({ status: "revoked", acceptedBy: session.userId, acceptedAt: new Date() })
    .where(eq(projectInvitations.id, invite.id))

  event.node.res.statusCode = 204
  return ""
})
