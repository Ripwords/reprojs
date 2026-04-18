import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, count, eq, sql } from "drizzle-orm"
import { db } from "../../../../../db"
import { projectMembers } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const userId = getRouterParam(event, "userId")
  if (!userId) throw createError({ statusCode: 400, statusMessage: "missing userId" })
  await requireProjectRole(event, id, "owner")

  // Serialize writes to this project's member set so the last-owner guard can't
  // be raced (two concurrent deletes both seeing owner count=2 and both
  // committing, leaving zero owners).
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`members:${id}`}))`)

    const [member] = await tx
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)))
      .limit(1)
    if (!member) return { notFound: true as const }

    if (member.role === "owner") {
      const [countRow] = await tx
        .select({ c: count() })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, id), eq(projectMembers.role, "owner")))
      if ((countRow?.c ?? 0) <= 1) return { lastOwner: true as const }
    }

    await tx
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)))
    return { ok: true as const }
  })

  if ("notFound" in result) {
    throw createError({ statusCode: 404, statusMessage: "Member not found" })
  }
  if ("lastOwner" in result) {
    throw createError({ statusCode: 409, statusMessage: "Cannot remove the last owner" })
  }
  return { ok: true }
})
