import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { desc, eq, sql } from "drizzle-orm"
import { db } from "../../server/db"
import { user, verification } from "../../server/db/schema"
import { apiFetch, createUser, signIn, truncateDomain } from "../helpers"

setDefaultTimeout(30000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

async function findLatestToken(email: string): Promise<string | null> {
  const rows = await db
    .select({ identifier: verification.identifier })
    .from(verification)
    .where(sql`${verification.value} LIKE ${`%"email":"${email}"%`}`)
    .orderBy(desc(verification.createdAt))
    .limit(1)
  return rows[0]?.identifier ?? null
}

async function sendMagicLink(email: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, callbackURL: "/" }),
  })
}

describe("magic-link auth", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("send accepts an existing user's email and writes a verification row", async () => {
    await createUser("known@example.com")
    const res = await sendMagicLink("known@example.com")
    expect(res.status).toBe(200)

    const token = await findLatestToken("known@example.com")
    expect(token).not.toBeNull()
    expect((token ?? "").length).toBeGreaterThanOrEqual(16)
  })

  test("send for a brand-new email succeeds (no enumeration — user created at verify time)", async () => {
    // better-auth's magic-link plugin creates the user at /magic-link/verify,
    // NOT at /sign-in/magic-link — so "send" does not reveal whether the
    // email exists, defending against email-enumeration.
    const res = await sendMagicLink("new@example.com")
    expect(res.status).toBe(200)

    const [row] = await db.select().from(user).where(eq(user.email, "new@example.com"))
    expect(row).toBeUndefined()
  })

  test("clicking a valid link signs the user in and sets a session cookie", async () => {
    await createUser("hello@example.com")
    const cookie = await signIn("hello@example.com")
    expect(cookie.length).toBeGreaterThan(0)

    const me = await apiFetch<{ user?: { email?: string } }>("/api/auth/get-session", {
      headers: { cookie },
    })
    expect(me.status).toBe(200)
    expect(me.body.user?.email).toBe("hello@example.com")
  })

  test("clicking an expired link fails", async () => {
    await createUser("expired@example.com")
    const sent = await sendMagicLink("expired@example.com")
    expect(sent.status).toBe(200)

    // Backdate the verification row so the expiry is in the past.
    await db.execute(
      sql`UPDATE verification SET expires_at = now() - interval '1 minute' WHERE value LIKE ${`%"email":"expired@example.com"%`}`,
    )

    const token = await findLatestToken("expired@example.com")
    expect(token).not.toBeNull()

    const res = await fetch(
      `${BASE_URL}/api/auth/magic-link/verify?token=${encodeURIComponent(token ?? "")}&callbackURL=/`,
      { redirect: "manual" },
    )
    // better-auth's verify redirects to errorCallbackURL (default = callbackURL)
    // with ?error=EXPIRED_TOKEN when the token is past its expiry.
    expect([302, 303].includes(res.status)).toBe(true)
    const location = res.headers.get("location") ?? ""
    expect(location).toContain("error=EXPIRED_TOKEN")
  })

  test("clicking an unknown token fails with INVALID_TOKEN", async () => {
    const bogus = randomBytes(16).toString("hex")
    const res = await fetch(`${BASE_URL}/api/auth/magic-link/verify?token=${bogus}&callbackURL=/`, {
      redirect: "manual",
    })
    expect([302, 303].includes(res.status)).toBe(true)
    const location = res.headers.get("location") ?? ""
    expect(location).toContain("error=INVALID_TOKEN")
  })

  test("first sign-in via magic-link promotes invited → active", async () => {
    // Seed a pre-invited user row (status=invited) the way
    // /api/users POST would.
    const id = randomBytes(16).toString("hex")
    const now = new Date()
    await db.insert(user).values({
      id,
      email: "invitee@example.com",
      name: "invitee",
      emailVerified: false,
      role: "member",
      status: "invited",
      createdAt: now,
      updatedAt: now,
    })

    const cookie = await signIn("invitee@example.com")
    expect(cookie.length).toBeGreaterThan(0)

    const [row] = await db.select().from(user).where(eq(user.id, id))
    expect(row?.status).toBe("active")
  })

  test("signupGated=true still lets an existing active user sign in (and does NOT delete their row)", async () => {
    // REGRESSION: the after-hook previously looked up by status='invited' and
    // called db.delete(user) when no match was found — which wiped EXISTING
    // active users (cascade-deleting their sessions + oauth accounts too)
    // every time they tried to log in while the gate was on.
    const id = await createUser("stayer@example.com")
    await db.execute(sql`UPDATE app_settings SET signup_gated = true WHERE id = 1`)

    const cookie = await signIn("stayer@example.com")
    expect(cookie.length).toBeGreaterThan(0)

    // Existing user row must still be there after sign-in.
    const [row] = await db.select().from(user).where(eq(user.id, id))
    expect(row).toBeDefined()
    expect(row?.status).toBe("active")

    // And the session must actually be valid (not just "cookie was set on a
    // since-deleted user" — that's what the bug produced).
    const me = await apiFetch<{ user?: { email?: string } }>("/api/auth/get-session", {
      headers: { cookie },
    })
    expect(me.status).toBe(200)
    expect(me.body.user?.email).toBe("stayer@example.com")
  })

  test("signupGated=true blocks a brand-new email at verify and leaves no orphan user row", async () => {
    await db.execute(sql`UPDATE app_settings SET signup_gated = true WHERE id = 1`)

    // Send succeeds (no enumeration oracle).
    const sent = await sendMagicLink("stranger@example.com")
    expect(sent.status).toBe(200)
    const token = await findLatestToken("stranger@example.com")
    expect(token).not.toBeNull()

    const res = await fetch(
      `${BASE_URL}/api/auth/magic-link/verify?token=${encodeURIComponent(token ?? "")}&callbackURL=/`,
      { redirect: "manual" },
    )
    expect([302, 303].includes(res.status)).toBe(true)
    const location = res.headers.get("location") ?? ""
    expect(location).toContain("/auth/sign-in")
    expect(location).toContain("error=not_invited")

    // No orphan row for an email that never had an invitation.
    const [row] = await db.select().from(user).where(eq(user.email, "stranger@example.com"))
    expect(row).toBeUndefined()
  })

  test("domain allowlist blocks magic-link sign-in for a non-allowed domain", async () => {
    await db.execute(
      sql`UPDATE app_settings SET allowed_email_domains = ARRAY['allowed.com']::text[] WHERE id = 1`,
    )
    // The send always succeeds (no enumeration oracle); the gate runs at verify.
    const sent = await sendMagicLink("bad@blocked.com")
    expect(sent.status).toBe(200)
    const token = await findLatestToken("bad@blocked.com")
    expect(token).not.toBeNull()

    // The after-hook rewrites the verify redirect to /auth/sign-in?error=
    // (same 302 status as the success redirect — keeps response surface
    // consistent and gives the UI a clear error to render).
    const res = await fetch(
      `${BASE_URL}/api/auth/magic-link/verify?token=${encodeURIComponent(token ?? "")}&callbackURL=/`,
      { redirect: "manual" },
    )
    expect([302, 303].includes(res.status)).toBe(true)
    const location = res.headers.get("location") ?? ""
    expect(location).toContain("/auth/sign-in")
    expect(location).toContain("error=domain_not_allowed")

    // Orphan-user defense: the after-hook deletes the just-created user row
    // so an attacker can't bypass the domain gate by racing the verify.
    const [row] = await db.select().from(user).where(eq(user.email, "bad@blocked.com"))
    expect(row).toBeUndefined()

    // And the Set-Cookie (if any) doesn't buy the attacker a valid session:
    // /get-session returns null because the user + session rows are gone.
    const setCookie = res.headers.get("set-cookie") ?? ""
    const match = /([^=]+=[^;]+)/.exec(setCookie)
    if (match) {
      const me = await apiFetch<{ user?: unknown } | null>("/api/auth/get-session", {
        headers: { cookie: match[1] },
      })
      // /get-session returns `null` (not `{ user: null }`) when the session
      // token references a deleted user/session row.
      const sessionUser = me.body && typeof me.body === "object" ? me.body.user : null
      expect(sessionUser).toBeFalsy()
    }
  })
})
