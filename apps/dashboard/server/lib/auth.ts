import { and, count, eq } from "drizzle-orm"
import { APIError, betterAuth } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db } from "../db"
import { appSettings, user } from "../db/schema"
import { renderTemplate } from "./render-template"
import { sendMail } from "./email"

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user: u, url }) => {
      const html = await renderTemplate("verify-email", {
        name: u.name ?? u.email,
        url,
      })
      await sendMail({
        to: u.email,
        subject: "Verify your email",
        html,
      })
    },
  },
  socialProviders: {
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "member", input: false },
      status: { type: "string", defaultValue: "active", input: false },
      inviteToken: { type: "string", defaultValue: null, input: false },
      inviteTokenExpiresAt: { type: "date", defaultValue: null, input: false },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return
      const email = ctx.body?.email as string | undefined
      if (!email) return
      const emailLower = email.toLowerCase()
      const [settings] = await db.select().from(appSettings).limit(1)
      if (!settings) return

      // Email-domain gate: when the allowlist is non-empty, the signer-up's
      // email domain must match one of the entries. Runs before the invite
      // gate so domain-mismatched emails are rejected even when invited.
      if (settings.allowedEmailDomains.length > 0) {
        const domain = emailLower.split("@")[1] ?? ""
        if (!settings.allowedEmailDomains.includes(domain)) {
          throw new APIError("FORBIDDEN", { message: "Email domain not allowed" })
        }
      }

      if (!settings.signupGated) return
      const [invited] = await db
        .select()
        .from(user)
        .where(and(eq(user.email, emailLower), eq(user.status, "invited")))
      if (!invited) {
        throw new APIError("FORBIDDEN", { message: "Signup is invite-only" })
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return
      // ctx.context.returned contains the response from the sign-up endpoint:
      // { token: null|string, user: { id: string, ... } }
      const returned = ctx.context.returned as { user?: { id?: string } } | undefined
      const newUserId = returned?.user?.id
      if (!newUserId) return
      const [countRow] = await db.select({ c: count() }).from(user)
      const c = countRow?.c ?? 0
      const updates: Partial<typeof user.$inferInsert> = {
        status: "active",
        inviteToken: null,
        inviteTokenExpiresAt: null,
      }
      if (c === 1) updates.role = "admin"
      await db.update(user).set(updates).where(eq(user.id, newUserId))
    }),
  },
})

export type Auth = typeof auth
