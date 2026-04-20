import { and, eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../../../db"
import { projectInvitations } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const invitationId = getRouterParam(event, "invitationId")
  if (!projectId || !invitationId)
    throw createError({ statusCode: 400, statusMessage: "missing id" })

  await requireProjectRole(event, projectId, "owner")

  const [existing] = await db
    .select()
    .from(projectInvitations)
    .where(
      and(eq(projectInvitations.id, invitationId), eq(projectInvitations.projectId, projectId)),
    )
  if (!existing) throw createError({ statusCode: 404, statusMessage: "Invitation not found" })
  if (existing.status !== "pending") {
    throw createError({
      statusCode: 409,
      statusMessage: `Invitation is ${existing.status}`,
    })
  }

  await db
    .update(projectInvitations)
    .set({ status: "revoked" })
    .where(eq(projectInvitations.id, invitationId))

  return { ok: true }
})
