import { and, count, eq } from "drizzle-orm"
import { APIError, betterAuth } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db } from "../db"
import { appSettings, user } from "../db/schema"
import { renderTemplate } from "./render-template"
import { sendMail } from "./email"

const socialProviders: Record<string, unknown> = {}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  }
}
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }
}

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
  socialProviders,
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
      const [settings] = await db.select().from(appSettings).limit(1)
      if (!settings?.signupGated) return
      const [invited] = await db
        .select()
        .from(user)
        .where(and(eq(user.email, email), eq(user.status, "invited")))
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
      const [{ c }] = await db.select({ c: count() }).from(user)
      const updates: Record<string, unknown> = {
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
