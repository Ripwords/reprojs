import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, eq } from "drizzle-orm"
import { AddProjectMemberInput } from "@repro/shared"
import { db } from "../../../../db"
import { projectMembers, user } from "../../../../db/schema"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, id, "owner")
  const body = await readValidatedBody(event, (b: unknown) => AddProjectMemberInput.parse(b))

  const [targetUser] = await db.select().from(user).where(eq(user.email, body.email))
  if (!targetUser) {
    throw createError({ statusCode: 404, statusMessage: "User not found" })
  }

  const [existing] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, targetUser.id)))

  if (existing) {
    throw createError({ statusCode: 409, statusMessage: "User is already a member" })
  }

  await db.insert(projectMembers).values({
    projectId: id,
    userId: targetUser.id,
    role: body.role,
  })

  return {
    userId: targetUser.id,
    email: targetUser.email,
    name: targetUser.name ?? null,
    role: body.role,
    joinedAt: new Date().toISOString(),
  }
})
