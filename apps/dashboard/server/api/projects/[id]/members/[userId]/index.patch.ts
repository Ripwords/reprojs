import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, count, eq } from "drizzle-orm"
import { UpdateProjectMemberInput } from "@feedback-tool/shared"
import { db } from "../../../../../db"
import { projectMembers } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!
  const userId = getRouterParam(event, "userId")!
  await requireProjectRole(event, id, "owner")
  const body = await readValidatedBody(event, (b: unknown) => UpdateProjectMemberInput.parse(b))

  // Last-owner guard: if demoting from owner, ensure at least one other owner remains.
  if (body.role !== "owner") {
    const [{ c }] = await db
      .select({ c: count() })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.role, "owner")))
    const isCurrentlyOwner = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, id),
          eq(projectMembers.userId, userId),
          eq(projectMembers.role, "owner"),
        ),
      )
    if (isCurrentlyOwner.length > 0 && c <= 1) {
      throw createError({ statusCode: 409, statusMessage: "Cannot remove the last owner" })
    }
  }

  const [updated] = await db
    .update(projectMembers)
    .set({ role: body.role })
    .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)))
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: "Member not found" })
  }

  return { ok: true }
})
