import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, count, eq, sql } from "drizzle-orm"
import { UpdateProjectMemberInput } from "@repro/shared"
import { db } from "../../../../../db"
import { projectMembers } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const userId = getRouterParam(event, "userId")
  if (!userId) throw createError({ statusCode: 400, statusMessage: "missing userId" })
  await requireProjectRole(event, id, "owner")
  const body = await readValidatedBody(event, (b: unknown) => UpdateProjectMemberInput.parse(b))

  // Serialize writes to this project's member set so the last-owner guard can't
  // be raced (two concurrent demotions both seeing count=2 and both committing).
  // Advisory lock scope: one project. Released at txn commit/rollback.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`members:${id}`}))`)

    if (body.role !== "owner") {
      const [countRow] = await tx
        .select({ c: count() })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, id), eq(projectMembers.role, "owner")))
      const ownerCount = countRow?.c ?? 0
      const isCurrentlyOwner = await tx
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, id),
            eq(projectMembers.userId, userId),
            eq(projectMembers.role, "owner"),
          ),
        )
        .limit(1)
      if (isCurrentlyOwner.length > 0 && ownerCount <= 1) {
        return { lastOwner: true as const }
      }
    }

    const [updated] = await tx
      .update(projectMembers)
      .set({ role: body.role })
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)))
      .returning({ userId: projectMembers.userId })
    return { lastOwner: false as const, updated }
  })

  if (result.lastOwner) {
    throw createError({ statusCode: 409, statusMessage: "Cannot remove the last owner" })
  }
  if (!result.updated) {
    throw createError({ statusCode: 404, statusMessage: "Member not found" })
  }

  return { ok: true }
})
