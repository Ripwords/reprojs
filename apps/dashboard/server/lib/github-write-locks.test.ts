// apps/dashboard/server/lib/github-write-locks.test.ts
// Integration tests — these hit the real Postgres instance.
// Run with: bun test apps/dashboard/server/lib/github-write-locks.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { db } from "../db"
import { githubWriteLocks, projects, reports } from "../db/schema"
import {
  cleanupExpiredLocks,
  consumeWriteLock,
  recordWriteLock,
  WRITE_LOCK_TTL_MS,
} from "./github-write-locks"

// We need a real report row to satisfy the FK
let testProjectId: string
let testReportId: string

async function truncate() {
  await db.execute(sql`TRUNCATE github_write_locks RESTART IDENTITY CASCADE`)
}

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE project_invitations, project_members, projects, "account", "session", "verification", "user" RESTART IDENTITY CASCADE`,
  )
  await db.execute(sql`TRUNCATE report_attachments, reports RESTART IDENTITY CASCADE`)
  await truncate()

  const [p] = await db
    .insert(projects)
    .values({
      name: "test",
      createdBy: "user-test",
      publicKey: "rp_pk_writelocktest",
      allowedOrigins: [],
    })
    .returning()
  testProjectId = p.id

  const [r] = await db
    .insert(reports)
    .values({
      projectId: testProjectId,
      title: "test report",
      description: "test",
      context: {
        pageUrl: "http://example.com",
        userAgent: "UA",
        viewport: { w: 1, h: 1 },
        timestamp: new Date().toISOString(),
      },
    })
    .returning()
  testReportId = r.id
})

afterEach(async () => {
  await truncate()
  await db.execute(sql`TRUNCATE report_attachments, reports RESTART IDENTITY CASCADE`)
  await db.execute(
    sql`TRUNCATE project_invitations, project_members, projects, "account", "session", "verification", "user" RESTART IDENTITY CASCADE`,
  )
})

describe("recordWriteLock", () => {
  test("inserts a row with correct fields", async () => {
    await recordWriteLock(db, {
      reportId: testReportId,
      kind: "title",
      signature: "abc123",
    })

    const rows = await db.select().from(githubWriteLocks)
    expect(rows.length).toBe(1)
    expect(rows[0]?.reportId).toBe(testReportId)
    expect(rows[0]?.kind).toBe("title")
    expect(rows[0]?.signature).toBe("abc123")
    expect(rows[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(rows[0]?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + WRITE_LOCK_TTL_MS + 1000)
  })
})

describe("consumeWriteLock", () => {
  test("returns true and deletes when matching live row exists", async () => {
    await recordWriteLock(db, {
      reportId: testReportId,
      kind: "state",
      signature: "sig-xyz",
    })

    const result = await consumeWriteLock(db, {
      reportId: testReportId,
      kind: "state",
      signature: "sig-xyz",
    })

    expect(result).toBe(true)
    const rows = await db.select().from(githubWriteLocks)
    expect(rows.length).toBe(0)
  })

  test("returns false when no matching row", async () => {
    const result = await consumeWriteLock(db, {
      reportId: testReportId,
      kind: "labels",
      signature: "nonexistent",
    })
    expect(result).toBe(false)
  })

  test("returns false when signature differs", async () => {
    await recordWriteLock(db, {
      reportId: testReportId,
      kind: "labels",
      signature: "correct-sig",
    })

    const result = await consumeWriteLock(db, {
      reportId: testReportId,
      kind: "labels",
      signature: "wrong-sig",
    })
    expect(result).toBe(false)
  })

  test("returns false for expired rows", async () => {
    // Insert an already-expired lock directly
    const expiresAt = new Date(Date.now() - 1000)
    await db.insert(githubWriteLocks).values({
      reportId: testReportId,
      kind: "title",
      signature: "expired-sig",
      expiresAt,
    })

    const result = await consumeWriteLock(db, {
      reportId: testReportId,
      kind: "title",
      signature: "expired-sig",
    })
    expect(result).toBe(false)
  })
})

describe("cleanupExpiredLocks", () => {
  test("removes only expired rows, leaves live rows", async () => {
    // Insert one live and one expired lock
    const expired = new Date(Date.now() - 1000)
    await db.insert(githubWriteLocks).values([
      {
        reportId: testReportId,
        kind: "labels",
        signature: "live-sig",
        expiresAt: new Date(Date.now() + WRITE_LOCK_TTL_MS),
      },
      {
        reportId: testReportId,
        kind: "state",
        signature: "expired-sig",
        expiresAt: expired,
      },
    ])

    const count = await cleanupExpiredLocks(db)
    expect(count).toBe(1)

    const remaining = await db.select().from(githubWriteLocks)
    expect(remaining.length).toBe(1)
    expect(remaining[0]?.signature).toBe("live-sig")
  })

  test("returns 0 when no expired rows", async () => {
    await recordWriteLock(db, {
      reportId: testReportId,
      kind: "title",
      signature: "live",
    })

    const count = await cleanupExpiredLocks(db)
    expect(count).toBe(0)
  })
})
