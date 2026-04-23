import { and, eq, inArray } from "drizzle-orm"
import { db } from "../db"
import { userIdentities } from "../db/schema/user-identities"
import { user } from "../db/schema/auth-schema"

export type ResolvedIdentity =
  | { kind: "dashboard-user"; userId: string; githubLogin: string; avatarUrl: string | null }
  | { kind: "github-only"; githubUserId: string; githubLogin: string; avatarUrl: string | null }

export async function resolveGithubUser(
  githubUserId: string,
  githubLogin: string,
  avatarUrl: string | null,
): Promise<ResolvedIdentity> {
  const [row] = await db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(and(eq(userIdentities.provider, "github"), eq(userIdentities.externalId, githubUserId)))
    .limit(1)
  if (row) return { kind: "dashboard-user", userId: row.userId, githubLogin, avatarUrl }
  return { kind: "github-only", githubUserId, githubLogin, avatarUrl }
}

export type GithubIdentityFields = {
  externalId: string
  externalHandle: string
  externalAvatarUrl: string | null
  externalName: string | null
  externalEmail: string | null
}

export async function upsertGithubIdentity(
  userId: string,
  fields: GithubIdentityFields,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(userIdentities)
    .where(
      and(eq(userIdentities.provider, "github"), eq(userIdentities.externalId, fields.externalId)),
    )
    .limit(1)

  if (existing && existing.userId !== userId) {
    throw new Error("This GitHub account is already linked to another dashboard user.")
  }

  if (existing) {
    await db
      .update(userIdentities)
      .set({
        externalHandle: fields.externalHandle,
        externalAvatarUrl: fields.externalAvatarUrl,
        externalName: fields.externalName,
        externalEmail: fields.externalEmail,
        lastVerifiedAt: new Date(),
      })
      .where(eq(userIdentities.id, existing.id))
    return
  }

  await db.insert(userIdentities).values({
    userId,
    provider: "github",
    externalId: fields.externalId,
    externalHandle: fields.externalHandle,
    externalAvatarUrl: fields.externalAvatarUrl,
    externalName: fields.externalName,
    externalEmail: fields.externalEmail,
  })
}

export async function unlinkGithubIdentity(userId: string): Promise<void> {
  await db
    .delete(userIdentities)
    .where(and(eq(userIdentities.userId, userId), eq(userIdentities.provider, "github")))
}

export type LinkedUserMini = { id: string; name: string | null; email: string | null }

export async function resolveGithubUsers(
  externalIds: string[],
): Promise<Map<string, LinkedUserMini>> {
  if (externalIds.length === 0) return new Map()
  const rows = await db
    .select({
      externalId: userIdentities.externalId,
      userId: userIdentities.userId,
      name: user.name,
      email: user.email,
    })
    .from(userIdentities)
    .innerJoin(user, eq(user.id, userIdentities.userId))
    .where(
      and(eq(userIdentities.provider, "github"), inArray(userIdentities.externalId, externalIds)),
    )
  const out = new Map<string, LinkedUserMini>()
  for (const r of rows) out.set(r.externalId, { id: r.userId, name: r.name, email: r.email })
  return out
}
