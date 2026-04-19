import { createError, defineEventHandler, readValidatedBody } from "h3"
import { eq } from "drizzle-orm"
import { InviteUserInput } from "@reprokit/shared"
import { randomBytes } from "node:crypto"
import { db } from "../../db"
import { appSettings, user } from "../../db/schema"
import { env } from "../../lib/env"
import { requireInstallAdmin } from "../../lib/permissions"
import { sendMail } from "../../lib/email"
import { renderTemplate } from "../../lib/render-template"
import { getInviteLimiter } from "../../lib/rate-limit"

export default defineEventHandler(async (event) => {
  const adminSession = await requireInstallAdmin(event)
  const body = await readValidatedBody(event, (b: unknown) => InviteUserInput.parse(b))

  // Cap outbound-email rate per admin so a buggy loop / stolen admin session
  // can't exhaust SMTP quota or damage sender reputation by invite-spamming.
  const inviteLimiter = await getInviteLimiter()
  const take = await inviteLimiter.take(`invite:${adminSession.userId}`)
  if (!take.allowed) {
    event.node.res.setHeader("Retry-After", Math.ceil(take.retryAfterMs / 1000).toString())
    throw createError({ statusCode: 429, statusMessage: "Too many invites — slow down" })
  }

  const [existing] = await db.select().from(user).where(eq(user.email, body.email))
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: "User already exists" })
  }

  // Respect the install's sign-up gate: if admins have restricted sign-up to
  // specific domains, direct invites must also honor that allowlist. Without
  // this, an admin could side-step their own policy by inviting the blocked
  // domain directly and letting the invitee claim the pre-created row.
  const [settings] = await db.select().from(appSettings).limit(1)
  if (settings?.signupGated && settings.allowedEmailDomains.length > 0) {
    const domain = body.email.split("@")[1]?.toLowerCase() ?? ""
    if (!settings.allowedEmailDomains.includes(domain)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Email domain "${domain}" is not on this install's allowlist`,
      })
    }
  }

  // Magic-link / OAuth refactor: the invite is now purely a gate flag on the
  // user row. No token is generated — the admin's email tells the invitee to
  // go to /auth/sign-in and request a magic link (or use matching OAuth).
  // Promotion from `invited` → `active` happens in the better-auth after hook
  // on the first successful sign-in (see server/lib/auth.ts).
  const [invited] = await db
    .insert(user)
    .values({
      id: randomBytes(16).toString("hex"),
      email: body.email,
      name: body.name ?? body.email.split("@")[0] ?? body.email,
      emailVerified: false,
      role: body.role,
      status: "invited",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
  if (!invited) {
    throw createError({ statusCode: 500, statusMessage: "Insert failed" })
  }

  const signInUrl = `${env.BETTER_AUTH_URL}/auth/sign-in`
  const html = await renderTemplate("invite", {
    email: invited.email,
    url: signInUrl,
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
