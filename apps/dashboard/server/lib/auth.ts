import { and, count, eq } from "drizzle-orm"
import { APIError, betterAuth } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db } from "../db"
import { appSettings, user } from "../db/schema"
import { renderTemplate } from "./render-template"
import { sendMail } from "./email"

// H2: auth endpoint rate limiting. Sign-in, forget-password, reset-password,
// and verify-email are credential-guessing oracles — without a cap an attacker
// brute-forces at database speed. 5 attempts per 15 minutes per IP is the
// industry-standard login cap (permissive enough for humans retrying a typo).
//
// Deliberately NOT rate-limited:
//   - /session (read-only, not brute-forceable)
//   - /sign-out (not brute-forceable)
//   - /callback/* (OAuth provider callbacks — capping breaks real login flows)
//   - /sign-up/email (has its own abuse vectors handled elsewhere — email
//     verification + invite gate — and the existing better-auth defaults cover
//     it at 3 per 10s)
const AUTH_RATE_PER_IP_PER_15MIN = Number(process.env.AUTH_RATE_PER_IP_PER_15MIN ?? 5)
const AUTH_RATE_WINDOW_SEC = 15 * 60
// Enable in production by default (matches better-auth's own default).
// `AUTH_RATE_LIMIT_ENABLED=true` force-enables in dev/test so the dedicated
// test suite (and local smoke tests) can exercise the 429 path.
// `AUTH_RATE_LIMIT_ENABLED=false` disables even in production (escape hatch).
const AUTH_RATE_LIMIT_ENABLED =
  process.env.AUTH_RATE_LIMIT_ENABLED === "true" ||
  (process.env.AUTH_RATE_LIMIT_ENABLED !== "false" && process.env.NODE_ENV === "production")

const strictAuthRule = { window: AUTH_RATE_WINDOW_SEC, max: AUTH_RATE_PER_IP_PER_15MIN }

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  rateLimit: {
    enabled: AUTH_RATE_LIMIT_ENABLED,
    // In-process memory store. Fine for single-process self-host (our default
    // deployment target). Multi-worker setups should flip to `database` or wire
    // `customStorage` into the same Postgres bucket table the intake uses.
    storage: "memory",
    customRules: {
      // Strict caps on credential-guessing endpoints. The primary endpoint in
      // better-auth 1.5.x is `/request-password-reset`; `/forget-password` is
      // the legacy alias. We cover both so older clients stay guarded.
      "/sign-in/email": strictAuthRule,
      "/sign-in/*": strictAuthRule,
      "/request-password-reset": strictAuthRule,
      "/forget-password": strictAuthRule,
      "/reset-password": strictAuthRule,
      "/reset-password/*": strictAuthRule,
      "/verify-email": strictAuthRule,
      // Explicitly opt OUT of rate limiting for these — `false` bypasses the
      // limiter entirely (see better-auth/api/rate-limiter resolveRateLimitConfig).
      "/get-session": false,
      "/sign-out": false,
      "/callback/*": false,
    },
  },
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
      if (ctx.path === "/sign-up/email") {
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
        return
      }

      // SEC1: guard social OAuth sign-ins against the same domain + invite gates.
      // The email isn't known until after the provider callback completes, so
      // this check must live in the `after` hook rather than `before`.
      if (ctx.path.startsWith("/callback/")) {
        const returned = ctx.context.returned as
          | { user?: { id?: string; email?: string } }
          | undefined
        const newUser = returned?.user
        if (!newUser?.id || !newUser.email) return

        const emailLower = newUser.email.toLowerCase()
        const [settings] = await db.select().from(appSettings).limit(1)
        if (!settings) return

        if (settings.allowedEmailDomains.length > 0) {
          const domain = emailLower.split("@")[1] ?? ""
          if (!settings.allowedEmailDomains.includes(domain)) {
            // Delete the just-created user row so the attacker doesn't end up
            // with an orphan account that bypassed the domain allowlist.
            await db.delete(user).where(eq(user.id, newUser.id))
            throw new APIError("FORBIDDEN", { message: "Email domain not allowed" })
          }
        }

        if (settings.signupGated) {
          const [invited] = await db
            .select()
            .from(user)
            .where(and(eq(user.email, emailLower), eq(user.status, "invited")))
          if (!invited) {
            await db.delete(user).where(eq(user.id, newUser.id))
            throw new APIError("FORBIDDEN", { message: "Signup is invite-only" })
          }
        }
      }
    }),
  },
})

export type Auth = typeof auth
