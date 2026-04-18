import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"
import { randomBytes } from "node:crypto"
import { sql } from "drizzle-orm"
import { db } from "../../server/db"
import { user } from "../../server/db/schema"
import { apiFetch, truncateDomain } from "../helpers"

setDefaultTimeout(30000)

type AcceptResponse = { ok?: boolean; statusMessage?: string }

async function seedInvitedUser(opts: {
  email: string
  token: string
  expiresInMs?: number
}): Promise<string> {
  const id = randomBytes(16).toString("hex")
  const expires = new Date(Date.now() + (opts.expiresInMs ?? 7 * 24 * 60 * 60 * 1000))
  await db.insert(user).values({
    id,
    email: opts.email,
    name: opts.email.split("@")[0] ?? opts.email,
    emailVerified: false,
    role: "member",
    status: "invited",
    inviteToken: opts.token,
    inviteTokenExpiresAt: expires,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

describe("invites/accept API", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("accept flips user to active and clears invite token", async () => {
    const token = randomBytes(32).toString("hex")
    const id = await seedInvitedUser({ email: "invitee@example.com", token })

    const { status, body } = await apiFetch<AcceptResponse>("/api/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token, password: "Password123!" }),
    })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)

    const rows = await db.execute(
      sql`SELECT status, invite_token, invite_token_expires_at FROM "user" WHERE id = ${id}`,
    )
    const row = (rows as unknown as { rows: Array<Record<string, unknown>> }).rows[0]
    expect(row.status).toBe("active")
    expect(row.invite_token).toBeNull()
    expect(row.invite_token_expires_at).toBeNull()
  })

  test("unknown token returns 404", async () => {
    const { status } = await apiFetch<AcceptResponse>("/api/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token: randomBytes(16).toString("hex"), password: "Password123!" }),
    })
    expect(status).toBe(404)
  })

  test("second accept with the same token returns 410 (already used)", async () => {
    const token = randomBytes(32).toString("hex")
    await seedInvitedUser({ email: "used@example.com", token })

    const first = await apiFetch<AcceptResponse>("/api/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token, password: "Password123!" }),
    })
    expect(first.status).toBe(200)

    // Re-issue the same token on the now-active user to simulate the race where
    // a stale request references a token that has been spent. We do this by
    // putting the token back on the same row (which is now `status = 'active'`)
    // — the endpoint must reject with 410, not 200.
    await db.execute(
      sql`UPDATE "user" SET invite_token = ${token} WHERE email = 'used@example.com'`,
    )

    const second = await apiFetch<AcceptResponse>("/api/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token, password: "Password123!" }),
    })
    expect(second.status).toBe(410)
  })

  test("concurrent accepts of the same token produce exactly one active user and one account row", async () => {
    const token = randomBytes(32).toString("hex")
    const id = await seedInvitedUser({ email: "race@example.com", token })

    // Fire two in parallel. Exactly one should succeed (200), the other should
    // lose the row lock race and see status=active → 410.
    const [r1, r2] = await Promise.all([
      apiFetch<AcceptResponse>("/api/invites/accept", {
        method: "POST",
        body: JSON.stringify({ token, password: "Password123!" }),
      }),
      apiFetch<AcceptResponse>("/api/invites/accept", {
        method: "POST",
        body: JSON.stringify({ token, password: "Password123!" }),
      }),
    ])

    const statuses = [r1.status, r2.status].toSorted()
    // Loser is either 410 (token still visible when the second tx re-reads)
    // or 404 (the winner already cleared the token before the second tx saw
    // it). Both are valid refusals; what's NOT valid is two 200s.
    expect(statuses[0]).toBe(200)
    expect(statuses[1] === 404 || statuses[1] === 410).toBe(true)

    const accounts = await db.execute(
      sql`SELECT count(*)::int AS c FROM "account" WHERE user_id = ${id} AND provider_id = 'credential'`,
    )
    const accountsRow = (accounts as unknown as { rows: Array<{ c: number }> }).rows[0]
    expect(accountsRow.c).toBe(1)
  })

  test("unique partial index rejects a second pending row holding the same token", async () => {
    const token = randomBytes(32).toString("hex")
    await seedInvitedUser({ email: "first@example.com", token })

    let collision: unknown
    try {
      await seedInvitedUser({ email: "second@example.com", token })
    } catch (e) {
      collision = e
    }
    expect(collision).toBeDefined()
    // drizzle wraps the pg error; the constraint name is on the driver cause.
    const err = collision as { cause?: { constraint?: string; code?: string } }
    const cause = err.cause ?? {}
    expect(cause.constraint).toBe("user_invite_token_idx")
    expect(cause.code).toBe("23505")
  })
})
