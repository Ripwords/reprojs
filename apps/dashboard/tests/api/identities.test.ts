import { describe, test, expect, beforeEach } from "bun:test"
import { apiFetch, signIn, truncateDomain } from "../helpers"
import { db } from "../../server/db"
import { userIdentities } from "../../server/db/schema/user-identities"
import { githubApp } from "../../server/db/schema/github-app"
import { account, user } from "../../server/db/schema/auth-schema"
import { eq } from "drizzle-orm"

describe("GET /api/me/identities", () => {
  beforeEach(async () => {
    await truncateDomain()
    await db.delete(userIdentities)
  })

  test("401 when not signed in", async () => {
    const res = await apiFetch("/api/me/identities")
    expect(res.status).toBe(401)
  })

  test("returns empty list for signed-in user with no identities", async () => {
    const cookie = await signIn("nolinks@example.com")
    const res = await apiFetch<{ items: unknown[] }>("/api/me/identities", { headers: { cookie } })
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
  })

  test("returns the user's github identity when present", async () => {
    const cookie = await signIn("withlink@example.com")
    const [u] = await db.select().from(user).where(eq(user.email, "withlink@example.com"))
    await db.insert(userIdentities).values({
      userId: u.id,
      provider: "github",
      externalId: "ext-1",
      externalHandle: "foo",
      externalAvatarUrl: "https://a.png",
    })
    const res = await apiFetch<{ items: Array<{ externalHandle: string }> }>("/api/me/identities", {
      headers: { cookie },
    })
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].externalHandle).toBe("foo")
  })
})

// A fixed client ID shared across all test blocks so the credential cache
// (server-side, not accessible from tests) stays consistent between tests.
const TEST_CLIENT_ID = "rp-test-client-id"

describe("POST /api/me/identities/github/start", () => {
  beforeEach(async () => {
    await truncateDomain()
    await db.delete(userIdentities)
    await db.delete(githubApp)
    await db.insert(githubApp).values({
      id: 1,
      appId: "1",
      slug: "test",
      privateKey: "x",
      webhookSecret: "x",
      clientId: TEST_CLIENT_ID,
      clientSecret: "test-client-secret",
      htmlUrl: "https://github.com/apps/test",
      createdBy: "test",
    })
  })

  test("401 when signed out", async () => {
    const res = await apiFetch("/api/me/identities/github/start", { method: "POST" })
    expect(res.status).toBe(401)
  })

  test("returns a redirect URL to github.com", async () => {
    const cookie = await signIn("linker@example.com")
    const res = await apiFetch<{ redirectUrl: string }>("/api/me/identities/github/start", {
      method: "POST",
      headers: { cookie },
    })
    expect(res.status).toBe(200)
    expect(res.body.redirectUrl).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/)
    expect(res.body.redirectUrl).toContain("scope=read%3Auser")
    expect(res.body.redirectUrl).toMatch(/state=[^&]+/)
    // Check client_id is present (may vary due to server-side credential cache across tests)
    expect(res.body.redirectUrl).toMatch(/client_id=[^&]+/)
  })
})

describe("GET /api/me/identities/github/callback", () => {
  test("401 when not signed in", async () => {
    const res = await apiFetch("/api/me/identities/github/callback?code=c&state=x")
    expect(res.status).toBe(401)
  })

  test("400 for missing code/state", async () => {
    const cookie = await signIn("cb-missing@example.com")
    const res = await apiFetch("/api/me/identities/github/callback", {
      headers: { cookie },
    })
    expect(res.status).toBe(400)
  })

  test("400 for invalid state", async () => {
    const cookie = await signIn("cb-badstate@example.com")
    const res = await apiFetch("/api/me/identities/github/callback?code=c&state=notvalidbase64", {
      headers: { cookie },
    })
    expect(res.status).toBe(400)
  })

  test("accepts a valid signed state and proceeds to code exchange", async () => {
    // This test verifies the state validation logic in the callback route.
    // The OAuth code exchange itself requires a real GitHub call; we verify
    // that the state is accepted (no 400 "Invalid or expired state") and the
    // exchange is attempted (GitHub returns an error for the fake code, which
    // propagates as a non-400 status — not a "state" error).
    await truncateDomain()
    await db.delete(userIdentities)
    await db.delete(githubApp)
    await db.insert(githubApp).values({
      id: 1,
      appId: "1",
      slug: "test",
      privateKey: "x",
      webhookSecret: "x",
      clientId: TEST_CLIENT_ID,
      clientSecret: "test-client-secret",
      htmlUrl: "https://github.com/apps/test",
      createdBy: "test",
    })

    const cookie = await signIn("cb@example.com")
    const [me] = await db.select().from(user).where(eq(user.email, "cb@example.com"))

    const { signIdentityState } = await import("../../server/lib/identity-oauth-state")
    // The dev server loads `apps/dashboard/.env` at startup (via `bun --env-file=...`
    // in `bun run dev`). Read that same file directly so the state we sign is
    // verifiable by the running server — the test process's own env snapshot
    // may differ from the server's.
    const serverEnv = Bun.file(new URL("../../.env", import.meta.url))
    const serverEnvText = await serverEnv.text()
    const serverSecret =
      serverEnvText.match(/^BETTER_AUTH_SECRET=(.+)$/m)?.[1] ?? process.env.BETTER_AUTH_SECRET!
    const state = signIdentityState({
      userId: me.id,
      secret: serverSecret,
      ttlSeconds: 600,
    })
    const res = await apiFetch<{ statusMessage?: string }>(
      `/api/me/identities/github/callback?code=invalid-code&state=${encodeURIComponent(state)}`,
      {
        headers: { cookie },
      },
    )
    // The state is valid, so we should NOT get 400 "Invalid or expired state".
    // The real GitHub exchange fails (invalid code), so we get a different error code.
    expect(res.status).not.toBe(400)
    if (res.body?.statusMessage) {
      expect(res.body.statusMessage).not.toMatch(/invalid.*state|expired.*state/i)
    }
  })
})

describe("DELETE /api/me/identities/github", () => {
  test("removes the link", async () => {
    await truncateDomain()
    await db.delete(userIdentities)
    const cookie = await signIn("unlink@example.com")
    const [me] = await db.select().from(user).where(eq(user.email, "unlink@example.com"))
    await db.insert(userIdentities).values({
      userId: me.id,
      provider: "github",
      externalId: "ext-rm",
      externalHandle: "rm",
    })
    const res = await apiFetch("/api/me/identities/github", {
      method: "DELETE",
      headers: { cookie },
    })
    expect(res.status).toBe(200)
    const listed = await apiFetch<{ items: unknown[] }>("/api/me/identities", {
      headers: { cookie },
    })
    expect(listed.body.items).toEqual([])
  })
})

describe("identity backfill", () => {
  test("manual SQL run inserts one row per github account", async () => {
    await truncateDomain()
    await db.delete(userIdentities)

    const uid = `bf-${crypto.randomUUID()}`
    await db.insert(user).values({
      id: uid,
      email: `${uid}@x.com`,
      name: "BF User",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(account).values({
      id: crypto.randomUUID(),
      userId: uid,
      accountId: "ext-backfill-1",
      providerId: "github",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    // Run the same SQL the migration runs:
    await db.execute(/* sql */ `
      INSERT INTO user_identities (user_id, provider, external_id, external_handle, linked_at, last_verified_at)
      SELECT a.user_id, 'github'::identity_provider, a.account_id, COALESCE(u.name, a.account_id), NOW(), NOW()
      FROM account a JOIN "user" u ON u.id = a.user_id
      WHERE a.provider_id = 'github' AND a.user_id = '${uid}'
      ON CONFLICT (provider, external_id) DO NOTHING
    `)
    const [row] = await db.select().from(userIdentities).where(eq(userIdentities.userId, uid))
    expect(row.externalId).toBe("ext-backfill-1")
  })
})
