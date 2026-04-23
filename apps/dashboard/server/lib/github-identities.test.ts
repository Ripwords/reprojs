import { describe, test, expect, beforeEach } from "bun:test"
import { resolveGithubUser, upsertGithubIdentity, unlinkGithubIdentity } from "./github-identities"
import { db } from "../db"
import { userIdentities } from "../db/schema/user-identities"
import { user } from "../db/schema/auth-schema"
import { eq } from "drizzle-orm"

async function seedUser(id: string) {
  await db.insert(user).values({
    id,
    email: `${id}@example.com`,
    name: id,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

describe("resolveGithubUser", () => {
  beforeEach(async () => {
    await db.delete(userIdentities)
  })

  test("returns github-only when no identity matches", async () => {
    const res = await resolveGithubUser("ext-999", "octocat", "https://avatars/x.png")
    expect(res).toEqual({
      kind: "github-only",
      githubUserId: "ext-999",
      githubLogin: "octocat",
      avatarUrl: "https://avatars/x.png",
    })
  })

  test("returns dashboard-user when identity exists", async () => {
    const uid = `u-${crypto.randomUUID()}`
    await seedUser(uid)
    await upsertGithubIdentity(uid, {
      externalId: "ext-42",
      externalHandle: "jane",
      externalAvatarUrl: "https://avatars/j.png",
      externalName: "Jane",
      externalEmail: "jane@example.com",
    })
    const res = await resolveGithubUser("ext-42", "jane", "https://avatars/j.png")
    expect(res).toEqual({
      kind: "dashboard-user",
      userId: uid,
      githubLogin: "jane",
      avatarUrl: "https://avatars/j.png",
    })
  })

  test("upsert is idempotent per (provider, externalId)", async () => {
    const uid = `u-${crypto.randomUUID()}`
    await seedUser(uid)
    await upsertGithubIdentity(uid, {
      externalId: "ext-7",
      externalHandle: "foo",
      externalAvatarUrl: null,
      externalName: null,
      externalEmail: null,
    })
    await upsertGithubIdentity(uid, {
      externalId: "ext-7",
      externalHandle: "foo-renamed",
      externalAvatarUrl: "https://avatars/2.png",
      externalName: "Foo R",
      externalEmail: "foo@x.com",
    })
    const rows = await db.select().from(userIdentities).where(eq(userIdentities.userId, uid))
    expect(rows).toHaveLength(1)
    expect(rows[0].externalHandle).toBe("foo-renamed")
  })

  test("upsert rejects collision across different users", async () => {
    const a = `u-${crypto.randomUUID()}`
    const b = `u-${crypto.randomUUID()}`
    await seedUser(a)
    await seedUser(b)
    await upsertGithubIdentity(a, {
      externalId: "ext-collide",
      externalHandle: "collide",
      externalAvatarUrl: null,
      externalName: null,
      externalEmail: null,
    })
    await expect(
      upsertGithubIdentity(b, {
        externalId: "ext-collide",
        externalHandle: "collide",
        externalAvatarUrl: null,
        externalName: null,
        externalEmail: null,
      }),
    ).rejects.toThrow(/already linked/i)
  })

  test("unlink removes the row", async () => {
    const uid = `u-${crypto.randomUUID()}`
    await seedUser(uid)
    await upsertGithubIdentity(uid, {
      externalId: "ext-x",
      externalHandle: "x",
      externalAvatarUrl: null,
      externalName: null,
      externalEmail: null,
    })
    await unlinkGithubIdentity(uid)
    const rows = await db.select().from(userIdentities).where(eq(userIdentities.userId, uid))
    expect(rows).toHaveLength(0)
  })
})
