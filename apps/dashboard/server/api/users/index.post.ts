import { createError, defineEventHandler, readValidatedBody } from "h3"
import { eq } from "drizzle-orm"
import { InviteUserInput } from "@feedback-tool/shared"
import { randomBytes } from "node:crypto"
import { db } from "../../db"
import { user } from "../../db/schema"
import { requireInstallAdmin } from "../../lib/permissions"
import { sendMail } from "../../lib/email"
import { renderTemplate } from "../../lib/render-template"

export default defineEventHandler(async (event) => {
  await requireInstallAdmin(event)
  const body = await readValidatedBody(event, (b: unknown) => InviteUserInput.parse(b))

  const [existing] = await db.select().from(user).where(eq(user.email, body.email))
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: "User already exists" })
  }

  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  // Insert a placeholder user row in "invited" status
  const [invited] = await db
    .insert(user)
    .values({
      id: randomBytes(16).toString("hex"),
      email: body.email,
      name: body.name ?? body.email.split("@")[0],
      emailVerified: false,
      role: body.role,
      status: "invited",
      inviteToken: token,
      inviteTokenExpiresAt: expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()

  const acceptUrl = `${process.env.BETTER_AUTH_URL}/accept-invite?token=${token}`
  const html = await renderTemplate("invite", {
    name: invited.name ?? invited.email,
    url: acceptUrl,
  })
  // Fire-and-forget: Ethereal/SMTP I/O can take 5-15s, which would otherwise
  // block the HTTP response and cause better-auth's client session heartbeat
  // to race and incorrectly drop the admin's session.
  void sendMail({ to: invited.email, subject: "You have been invited", html }).catch(
    (err: unknown) => {
      console.error(`[invite] email delivery failed for ${invited.email}:`, err)
    },
  )

  return {
    id: invited.id,
    email: invited.email,
    name: invited.name ?? null,
    role: (invited.role ?? "member") as "admin" | "member",
    status: "invited" as const,
    emailVerified: invited.emailVerified,
    createdAt: invited.createdAt.toISOString(),
  }
})
