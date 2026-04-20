import { and, eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../../../db"
import { projectInvitations, projects, user } from "../../../../../db/schema"
import { env } from "../../../../../lib/env"
import { requireProjectRole } from "../../../../../lib/permissions"
import { getInviteLimiter } from "../../../../../lib/rate-limit"
import { sendMail } from "../../../../../lib/email"
import { renderTemplate } from "../../../../../lib/render-template"

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const invitationId = getRouterParam(event, "invitationId")
  if (!projectId || !invitationId)
    throw createError({ statusCode: 400, statusMessage: "missing id" })

  const { session } = await requireProjectRole(event, projectId, "owner")

  const inviteLimiter = await getInviteLimiter()
  const take = await inviteLimiter.take(`invite:${session.userId}`)
  if (!take.allowed) {
    event.node.res.setHeader("Retry-After", Math.ceil(take.retryAfterMs / 1000).toString())
    throw createError({ statusCode: 429, statusMessage: "Too many invites — slow down" })
  }

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

  const newExpiresAt = new Date(Date.now() + INVITE_TTL_MS)
  await db
    .update(projectInvitations)
    .set({ expiresAt: newExpiresAt })
    .where(eq(projectInvitations.id, invitationId))

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
  const [inviter] = await db.select().from(user).where(eq(user.id, session.userId))
  const acceptUrl = `${env.BETTER_AUTH_URL}/invitations/${existing.token}`
  const html = await renderTemplate("project-invite", {
    projectName: project?.name ?? "a Repro project",
    inviterName: inviter?.name ?? session.email,
    inviterEmail: session.email,
    role: existing.role,
    acceptUrl,
    expiresDays: "7",
  })
  void sendMail({
    to: existing.email,
    subject: `You've been invited to ${project?.name ?? "Repro"}`,
    html,
  }).catch((err: unknown) => {
    console.error(`[project-invite] resend failed for ${existing.email}:`, err)
  })

  return { ok: true, expiresAt: newExpiresAt.toISOString() }
})
