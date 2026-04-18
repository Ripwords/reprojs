import { and, count, eq } from "drizzle-orm"
import { betterAuth } from "better-auth"
import { createAuthMiddleware } from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { magicLink } from "better-auth/plugins/magic-link"
import { db } from "../db"
import { appSettings, user } from "../db/schema"
import { env, getAuthRateLimitEnabled } from "./env"
import { renderTemplate } from "./render-template"
import { sendMail } from "./email"

// H2: auth endpoint rate limiting. Sign-in and magic-link verify are the
// credential-guessing / token-probing oracles — without a cap an attacker
// brute-forces at database speed. 5 attempts per 15 minutes per IP is the
// industry-standard login cap (permissive enough for humans retrying a typo).
//
// Deliberately NOT rate-limited:
//   - /session (read-only, not brute-forceable)
//   - /sign-out (not brute-forceable)
//   - /callback/* (OAuth provider callbacks — capping breaks real login flows)
const AUTH_RATE_WINDOW_SEC = 15 * 60
// Enable in production by default (matches better-auth's own default).
// `AUTH_RATE_LIMIT_ENABLED=true` force-enables in dev/test so the dedicated
// test suite (and local smoke tests) can exercise the 429 path.
// `AUTH_RATE_LIMIT_ENABLED=false` disables even in production (escape hatch).

const strictAuthRule = { window: AUTH_RATE_WINDOW_SEC, max: env.AUTH_RATE_PER_IP_PER_15MIN }

type GateRejection = "domain_not_allowed" | "not_invited"

/**
 * Enforce the workspace-level domain allowlist + invite gate against a newly
 * signed-in user. Called from the `after` hook on any path that creates a user
 * row and a session (OAuth callback + magic-link verify). On rejection,
 * deletes the just-created user row so the attacker doesn't end up with an
 * orphan account that bypassed the allowlist.
 *
 * Returns `{ ok: true }` on pass or `{ ok: false, reason }` on rejection. The
 * caller is responsible for surfacing the rejection — for OAuth callback +
 * magic-link verify we redirect to the sign-in page with a `?error=` param
 * rather than throwing a 403, because those endpoints' own error paths use
 * 302 redirects and mixing a 403 throw into better-auth's toResponse produced
 * an inconsistent status/body shape.
 */
async function enforceDomainAndInviteGate(newUser: {
  id: string
  email: string
}): Promise<{ ok: true } | { ok: false; reason: GateRejection }> {
  const emailLower = newUser.email.toLowerCase()
  const [settings] = await db.select().from(appSettings).limit(1)
  if (!settings) return { ok: true }

  if (settings.allowedEmailDomains.length > 0) {
    const domain = emailLower.split("@")[1] ?? ""
    if (!settings.allowedEmailDomains.includes(domain)) {
      await db.delete(user).where(eq(user.id, newUser.id))
      return { ok: false, reason: "domain_not_allowed" }
    }
  }

  if (settings.signupGated) {
    const [invited] = await db
      .select()
      .from(user)
      .where(and(eq(user.email, emailLower), eq(user.status, "invited")))
    if (!invited) {
      await db.delete(user).where(eq(user.id, newUser.id))
      return { ok: false, reason: "not_invited" }
    }
  }
  return { ok: true }
}

/**
 * First-sign-in promotion:
 *   - Pre-invited user (status=`invited`) → flip to `active`.
 *   - Brand-new user who is also the only user in the install → promote to
 *     `admin`. This is the bootstrapping rule that hands the first person
 *     to sign in ownership of a fresh deployment.
 *
 * "Brand-new" is detected by the user row's `createdAt` being within a few
 * seconds of its `updatedAt` — magic-link's `internalAdapter.createUser`
 * emits identical timestamps for both, whereas a user returning for another
 * sign-in will have `updatedAt > createdAt` by at least the gap between
 * their first sign-in and this one. This disambiguation matters for tests
 * (and any other path) that insert user rows directly with role=member:
 * those rows must NOT get silently promoted to admin just because the row
 * happens to be the only one in the table when that user signs in.
 */
async function promoteInvitedOrFirstUser(userId: string): Promise<void> {
  const [existing] = await db.select().from(user).where(eq(user.id, userId))
  if (!existing) return

  const [countRow] = await db.select({ c: count() }).from(user)
  const totalUsers = countRow?.c ?? 0

  // Created-at and updated-at must be from the same request to be considered
  // brand-new. 2s covers clock drift on the db-round-trip.
  const createdAtMs = existing.createdAt.getTime()
  const updatedAtMs = existing.updatedAt.getTime()
  const wasJustCreated = Math.abs(updatedAtMs - createdAtMs) < 2_000

  const updates: Partial<typeof user.$inferInsert> = {}
  if (existing.status === "invited") {
    updates.status = "active"
  }
  if (wasJustCreated && totalUsers === 1 && existing.role !== "admin") {
    updates.role = "admin"
  }
  if (Object.keys(updates).length === 0) return
  await db.update(user).set(updates).where(eq(user.id, userId))
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  rateLimit: {
    enabled: getAuthRateLimitEnabled(),
    // In-process memory store. Fine for single-process self-host (our default
    // deployment target). Multi-worker setups should flip to `database` or wire
    // `customStorage` into the same Postgres bucket table the intake uses.
    storage: "memory",
    customRules: {
      // Strict caps on all sign-in + verify paths. `/sign-in/*` covers the
      // magic-link send endpoint (`/sign-in/magic-link`). `/magic-link/verify`
      // is the token-probing oracle — even with 32-char crypto-random tokens
      // the cap bounds an exfiltrated-DB scenario.
      "/sign-in/*": strictAuthRule,
      "/magic-link/verify": strictAuthRule,
      // Explicitly opt OUT of rate limiting for these — `false` bypasses the
      // limiter entirely (see better-auth/api/rate-limiter resolveRateLimitConfig).
      "/get-session": false,
      "/sign-out": false,
      "/callback/*": false,
    },
  },
  socialProviders: {
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },
  plugins: [
    magicLink({
      // Tokens expire after 5 minutes by default; tight window is the point.
      sendMagicLink: async ({ email, url }) => {
        const html = await renderTemplate("magic-link", { url })
        await sendMail({
          to: email,
          subject: "Your sign-in link",
          html,
        })
      },
    }),
  ],
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "member", input: false },
      status: { type: "string", defaultValue: "active", input: false },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      // SEC1: guard OAuth callbacks AND magic-link verification against the
      // same workspace gates. The user's email isn't known until after the
      // provider callback / token verify completes, so this check must live
      // in the `after` hook (before-hook body has no user yet).
      //
      // `ctx.context.newSession` is populated by `setSessionCookie` on both
      // code paths (see better-auth cookies/index.mjs setSessionCookie →
      // setNewSession). Reading from newSession — rather than
      // ctx.context.returned — is required for the magic-link verify redirect
      // path, where `returned` is an APIError(FOUND) instead of a user object.
      const isCallback = ctx.path.startsWith("/callback/")
      const isMagicLinkVerify = ctx.path === "/magic-link/verify"
      if (!isCallback && !isMagicLinkVerify) return

      const newSession = ctx.context.newSession
      const newUser = newSession?.user
      if (!newUser?.id || !newUser.email) return

      const gate = await enforceDomainAndInviteGate({ id: newUser.id, email: newUser.email })
      if (!gate.ok) {
        // Rewrite the success redirect to the sign-in page with an error code.
        // Both verify's success and error paths are 302s, so using `ctx.redirect`
        // keeps status parity and avoids better-auth's toResponse mixing a 403
        // status onto an existing 302 Location header. The session cookie that
        // `setSessionCookie` planted earlier is left in place because its
        // session row was cascade-deleted with the user — `/get-session`
        // returns null for the stale cookie until the browser replaces it.
        const errorUrl = new URL(
          `/auth/sign-in?error=${gate.reason}`,
          ctx.context.baseURL,
        ).toString()
        throw ctx.redirect(errorUrl)
      }
      await promoteInvitedOrFirstUser(newUser.id)
    }),
  },
})

export type Auth = typeof auth
