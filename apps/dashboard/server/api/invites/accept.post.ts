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

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (b: unknown) => AcceptInviteInput.parse(b))

  const [invited] = await db
    .select()
    .from(user)
    .where(
      and(
        eq(user.inviteToken, body.token),
        eq(user.status, "invited"),
        gt(user.inviteTokenExpiresAt, new Date()),
      ),
    )

  if (!invited) {
    throw createError({ statusCode: 404, statusMessage: "Invalid or expired invite token" })
  }

  const passwordHash = await hashPassword(body.password)

  // Update user to active, clear invite token
  await db
    .update(user)
    .set({
      emailVerified: true,
      status: "active",
      inviteToken: null,
      inviteTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(user.id, invited.id))

  // Create credential account record so better-auth can authenticate this user
  await db.insert(account).values({
    id: randomBytes(16).toString("hex"),
    accountId: invited.id,
    providerId: "credential",
    userId: invited.id,
    password: passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  return { ok: true }
})
