import { createError, defineEventHandler, readValidatedBody } from "h3"
import { and, eq, gt } from "drizzle-orm"
import { AcceptInviteInput } from "@feedback-tool/shared"
import { randomBytes, scrypt } from "node:crypto"
import { db } from "../../db"
import { user, account } from "../../db/schema"

/** Hash a password using the same scrypt format as better-auth/utils/password */
function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString("hex")
    scrypt(
      password.normalize("NFKC"),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (err, key) => {
        if (err) reject(err)
        else resolve(`${salt}:${key.toString("hex")}`)
      },
    )
  })
}

type AcceptOutcome = { kind: "accepted" } | { kind: "not_found" } | { kind: "already_used" }

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (b: unknown) => AcceptInviteInput.parse(b))

  const passwordHash = await hashPassword(body.password)

  // Serialize concurrent accepts of the same token:
  // 1. SELECT ... FOR UPDATE holds a row-level lock on the target user,
  //    so a second concurrent request blocks until this transaction commits.
  // 2. Once it unblocks, its own SELECT re-reads the row and sees either
  //    `status = 'active'` (we just flipped it) or `invite_token IS NULL`
  //    (we just cleared it) — either way the guard rejects it.
  // The account insert is inside the same tx so a rollback can't leave a
  // half-accepted user behind.
  const outcome = await db.transaction(async (tx): Promise<AcceptOutcome> => {
    const [invited] = await tx
      .select()
      .from(user)
      .where(
        and(
          eq(user.inviteToken, body.token),
          eq(user.status, "invited"),
          gt(user.inviteTokenExpiresAt, new Date()),
        ),
      )
      .for("update")

    if (!invited) {
      // Either the token never existed / expired, or a concurrent request
      // already flipped it. Distinguish so the client gets an accurate code:
      // a token that currently belongs to an active user → 410 Gone.
      const [stale] = await tx
        .select({ status: user.status })
        .from(user)
        .where(eq(user.inviteToken, body.token))
      if (stale) return { kind: "already_used" }
      return { kind: "not_found" }
    }

    await tx
      .update(user)
      .set({
        emailVerified: true,
        status: "active",
        inviteToken: null,
        inviteTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(user.id, invited.id))

    // Create credential account record so better-auth can authenticate this user.
    // Inside the same tx: if this insert fails (e.g. unique-constraint hit from
    // a racing request that already committed), the whole acceptance rolls back.
    await tx.insert(account).values({
      id: randomBytes(16).toString("hex"),
      accountId: invited.id,
      providerId: "credential",
      userId: invited.id,
      password: passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    return { kind: "accepted" }
  })

  if (outcome.kind === "not_found") {
    throw createError({ statusCode: 404, statusMessage: "Invalid or expired invite token" })
  }
  if (outcome.kind === "already_used") {
    throw createError({ statusCode: 410, statusMessage: "Invite already used or invalid" })
  }

  return { ok: true }
})
