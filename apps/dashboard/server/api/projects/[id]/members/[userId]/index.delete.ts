import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, count, eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { projectMembers } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!
  const userId = getRouterParam(event, "userId")!
  await requireProjectRole(event, id, "owner")

  // Last-owner guard: cannot remove a user who is the last owner.
  const [member] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)))

  if (!member) {
    throw createError({ statusCode: 404, statusMessage: "Member not found" })
  }

  if (member.role === "owner") {
    const [{ c }] = await db
      .select({ c: count() })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.role, "owner")))
    if (c <= 1) {
      throw createError({ statusCode: 409, statusMessage: "Cannot remove the last owner" })
    }
  }

  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)))

  return { ok: true }
})
