# SDK Core + Minimal Reporter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the smallest end-to-end SDK slice: a host page embeds a script, the user clicks a floating launcher, fills a 2-field form, the viewport screenshot is captured, and the report lands in the dashboard where project members can list + inspect it.

**Architecture:** Two new packages (`packages/core` public API + `packages/ui` Preact widget, bundled together into one IIFE + ESM via tsdown). Dashboard gains a public `POST /api/intake/reports` endpoint (multipart, CORS-gated, rate-limited, 5 MB cap) writing to a `StorageAdapter` (local filesystem default, S3 stub). Projects table extends with `public_key` + `allowed_origins`. A `/projects/:id/reports` Vue page with table + drawer closes the loop. A plain-HTML demo on `:4000` via `Bun.serve` serves as the smoke-test target.

**Tech Stack:** Preact (JSX runtime) + Shadow DOM + `modern-screenshot`, tsdown for dual IIFE/ESM, Drizzle + Bun.sql-compatible `pg` driver, Zod for API validation, in-memory token-bucket rate limiter, Vue/Nuxt for dashboard UI, `bun test` + `@nuxt/test-utils` for integration tests.

**Reference spec:** `docs/superpowers/specs/2026-04-17-sdk-core-reporter-design.md`

**Baseline:** tag `v0.1.0-skeleton` (sub-project A complete). Docker postgres on `:5436`, dashboard on `:3000`, 23 existing tests passing.

---

## Phase 1 — Database + shared types

### Task 1: Project key helper with TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/project-key.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/project-key.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/server/lib/project-key.test.ts
import { describe, expect, test } from "bun:test"
import { generatePublicKey, isValidPublicKey } from "./project-key"

describe("generatePublicKey", () => {
  test("returns ft_pk_ prefix + 24 base62 chars", () => {
    const k = generatePublicKey()
    expect(k).toMatch(/^ft_pk_[A-Za-z0-9]{24}$/)
  })

  test("is unique across 1000 calls", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(generatePublicKey())
    expect(seen.size).toBe(1000)
  })
})

describe("isValidPublicKey", () => {
  test("accepts well-formed keys", () => {
    expect(isValidPublicKey("ft_pk_abc123XYZ456defGHI7890jk")).toBe(true)
  })

  test("rejects wrong prefix", () => {
    expect(isValidPublicKey("abc_pk_abc123XYZ456defGHI7890jk")).toBe(false)
  })

  test("rejects wrong length", () => {
    expect(isValidPublicKey("ft_pk_short")).toBe(false)
  })

  test("rejects non-base62 chars", () => {
    expect(isValidPublicKey("ft_pk_!!!123XYZ456defGHI7890jk")).toBe(false)
  })
})
```

- [ ] **Step 2: Confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test server/lib/project-key.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/server/lib/project-key.ts
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const KEY_LEN = 24
const PREFIX = "ft_pk_"

export function generatePublicKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_LEN))
  let out = PREFIX
  for (let i = 0; i < KEY_LEN; i++) out += BASE62[bytes[i] % 62]
  return out
}

export function isValidPublicKey(s: unknown): s is string {
  if (typeof s !== "string") return false
  if (!s.startsWith(PREFIX)) return false
  const tail = s.slice(PREFIX.length)
  if (tail.length !== KEY_LEN) return false
  return /^[A-Za-z0-9]+$/.test(tail)
}
```

- [ ] **Step 4: Confirm pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test server/lib/project-key.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/project-key.ts apps/dashboard/server/lib/project-key.test.ts
git commit -m "feat(lib): add project public key generator and validator"
```

---

### Task 2: Extend projects schema + add reports schemas + migration + backfill

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/projects.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/reports.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/index.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/plugins/03.backfill-public-keys.ts`
- Generated: `apps/dashboard/server/db/migrations/0001_*.sql` (via drizzle-kit)

- [ ] **Step 1: Extend `projects.ts`**

Replace the contents of `apps/dashboard/server/db/schema/projects.ts` with:

```ts
import { sql } from "drizzle-orm"
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"

export const projects = pgTable(
  "projects",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdBy: text("created_by").notNull(),
    publicKey: text("public_key"),
    allowedOrigins: text("allowed_origins").array().notNull().default(sql`'{}'::text[]`),
    publicKeyRegeneratedAt: timestamp("public_key_regenerated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    slugActiveUnique: uniqueIndex("projects_slug_active_unique")
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    publicKeyUnique: uniqueIndex("projects_public_key_idx").on(table.publicKey),
  }),
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
```

> **Note:** `publicKey` is nullable in the schema so the migration can add the column to existing rows without a non-deterministic default. The backfill plugin in step 4 populates it on boot; the POST project endpoint (Task 10) populates it at create time.

- [ ] **Step 2: Create `reports.ts`**

```ts
// apps/dashboard/server/db/schema/reports.ts
import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { projects } from "./projects"

export const reports = pgTable(
  "reports",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    context: jsonb("context").notNull().default(sql`'{}'::jsonb`),
    origin: text("origin"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectCreatedIdx: index("reports_project_created_idx").on(
      table.projectId,
      sql`${table.createdAt} DESC`,
    ),
  }),
)

export const reportAttachments = pgTable(
  "report_attachments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["screenshot", "annotated-screenshot", "replay", "logs"],
    }).notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    kindCheck: check(
      "report_attachments_kind_check",
      sql`${table.kind} IN ('screenshot', 'annotated-screenshot', 'replay', 'logs')`,
    ),
    reportIdx: index("report_attachments_report_idx").on(table.reportId),
  }),
)

export type Report = typeof reports.$inferSelect
export type NewReport = typeof reports.$inferInsert
export type ReportAttachment = typeof reportAttachments.$inferSelect
export type NewReportAttachment = typeof reportAttachments.$inferInsert
export type AttachmentKind = ReportAttachment["kind"]
```

- [ ] **Step 3: Re-export from barrel**

Edit `apps/dashboard/server/db/schema/index.ts` to add the reports export:

```ts
export * from "./auth-schema"
export * from "./projects"
export * from "./project-members"
export * from "./app-settings"
export * from "./reports"
```

- [ ] **Step 4: Create the backfill plugin**

```ts
// apps/dashboard/server/plugins/03.backfill-public-keys.ts
import { isNull } from "drizzle-orm"
import { db } from "../db"
import { projects } from "../db/schema"
import { generatePublicKey } from "../lib/project-key"

export default defineNitroPlugin(async () => {
  const missing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(isNull(projects.publicKey))

  if (missing.length === 0) return

  for (const { id } of missing) {
    const { eq } = await import("drizzle-orm")
    await db.update(projects).set({ publicKey: generatePublicKey() }).where(eq(projects.id, id))
  }
  console.info(`[backfill-public-keys] generated keys for ${missing.length} project(s)`)
})
```

- [ ] **Step 5: Generate the migration**

Run:
```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run db:gen
```

Expected: `drizzle-kit` writes a new migration file `apps/dashboard/server/db/migrations/0001_<random>.sql` containing `ALTER TABLE projects ADD COLUMN public_key ...`, `ALTER TABLE projects ADD COLUMN allowed_origins ...`, `ALTER TABLE projects ADD COLUMN public_key_regenerated_at ...`, `CREATE UNIQUE INDEX projects_public_key_idx ...`, `CREATE TABLE reports ...`, `CREATE TABLE report_attachments ...`, and the indexes/check.

Review the generated SQL; if anything is surprising (e.g. drizzle decided to drop something), STOP and report.

- [ ] **Step 6: Apply the migration**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run db:migrate
```

Expected: `migrations applied successfully!`

- [ ] **Step 7: Verify schema**

```bash
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "\d projects"
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "\dt"
```
Expected: `projects` has new columns; `reports` and `report_attachments` tables exist.

- [ ] **Step 8: Start dev server to trigger backfill**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000 | xargs -r kill -9 2>/dev/null
bun run dev > /tmp/backfill.log 2>&1 &
PID=$!
sleep 20
curl -s http://localhost:3000/ -o /dev/null -m 5
sleep 2
grep backfill-public-keys /tmp/backfill.log || echo "no backfill needed"
kill $PID 2>/dev/null
wait $PID 2>/dev/null
lsof -ti:3000 | xargs -r kill -9 2>/dev/null

docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "SELECT name, public_key FROM projects"
```
Expected: any pre-existing projects now have a populated `public_key`. If no projects exist yet, the log shows nothing (backfill is a no-op).

- [ ] **Step 9: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/db apps/dashboard/server/plugins/03.backfill-public-keys.ts
git commit -m "feat(db): add public_key + allowed_origins to projects and add reports tables"
```

---

### Task 3: Shared Zod DTOs for reports

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/src/reports.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/src/index.ts`

- [ ] **Step 1: Write `reports.ts`**

```ts
// packages/shared/src/reports.ts
import { z } from "zod"

export const ReporterIdentity = z.object({
  userId: z.string().optional(),
  email: z.string().email().optional(),
  name: z.string().max(200).optional(),
})
export type ReporterIdentity = z.infer<typeof ReporterIdentity>

export const ReportContext = z.object({
  pageUrl: z.string().url(),
  userAgent: z.string().max(1000),
  viewport: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  timestamp: z.string(),
  reporter: ReporterIdentity.optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
})
export type ReportContext = z.infer<typeof ReportContext>

export const ReportIntakeInput = z.object({
  projectKey: z.string().regex(/^ft_pk_[A-Za-z0-9]{24}$/),
  title: z.string().min(1).max(120),
  description: z.string().max(10_000).optional(),
  context: ReportContext,
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
})
export type ReportIntakeInput = z.infer<typeof ReportIntakeInput>

export const AttachmentKind = z.enum(["screenshot", "annotated-screenshot", "replay", "logs"])
export type AttachmentKind = z.infer<typeof AttachmentKind>

export const AttachmentDTO = z.object({
  id: z.uuid(),
  kind: AttachmentKind,
  url: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
})
export type AttachmentDTO = z.infer<typeof AttachmentDTO>

export const ReportSummaryDTO = z.object({
  id: z.uuid(),
  title: z.string(),
  reporterEmail: z.string().nullable(),
  pageUrl: z.string(),
  receivedAt: z.string(),
  thumbnailUrl: z.string().nullable(),
})
export type ReportSummaryDTO = z.infer<typeof ReportSummaryDTO>

export const ReportDetailDTO = ReportSummaryDTO.extend({
  description: z.string().nullable(),
  context: ReportContext,
  attachments: z.array(AttachmentDTO),
})
export type ReportDetailDTO = z.infer<typeof ReportDetailDTO>
```

- [ ] **Step 2: Update index barrel**

Edit `packages/shared/src/index.ts`:

```ts
export * from "./projects"
export * from "./users"
export * from "./settings"
export * from "./reports"
```

- [ ] **Step 3: Verify types resolve**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxi prepare
```
Expected: no module resolution errors referencing `@feedback-tool/shared`.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/shared/src
git commit -m "feat(shared): add report context, intake input, and viewer DTOs"
```

---

## Phase 2 — Intake infrastructure (TDD)

### Task 4: Storage adapter with LocalDisk + S3 stub

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/storage/index.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/storage/local-disk.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/storage/s3.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/storage/local-disk.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/server/lib/storage/local-disk.test.ts
import { describe, expect, test, beforeEach, afterAll } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalDiskAdapter } from "./local-disk"

let root: string
const adapters: LocalDiskAdapter[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ft-storage-"))
  adapters.push(new LocalDiskAdapter(root))
})

afterAll(async () => {
  for (const a of adapters) await rm((a as unknown as { root: string }).root, { recursive: true, force: true })
})

describe("LocalDiskAdapter", () => {
  test("put writes bytes and returns the key", async () => {
    const adapter = new LocalDiskAdapter(root)
    const key = "attachments/abc/screenshot.png"
    const bytes = new Uint8Array([137, 80, 78, 71])
    const result = await adapter.put(key, bytes, "image/png")
    expect(result.key).toBe(key)
  })

  test("get returns the bytes and content-type written by put", async () => {
    const adapter = new LocalDiskAdapter(root)
    const key = "attachments/xyz/foo.png"
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    await adapter.put(key, bytes, "image/png")

    const got = await adapter.get(key)
    expect(Array.from(got.bytes)).toEqual([1, 2, 3, 4, 5])
    expect(got.contentType).toBe("image/png")
  })

  test("put creates parent directories", async () => {
    const adapter = new LocalDiskAdapter(root)
    await adapter.put("a/deeply/nested/key.bin", new Uint8Array([9]), "application/octet-stream")
    const got = await adapter.get("a/deeply/nested/key.bin")
    expect(got.bytes.length).toBe(1)
  })

  test("delete removes the file; deleting missing is not an error", async () => {
    const adapter = new LocalDiskAdapter(root)
    await adapter.put("x.bin", new Uint8Array([1]), "application/octet-stream")
    await adapter.delete("x.bin")
    await expect(adapter.get("x.bin")).rejects.toThrow()
    await adapter.delete("x.bin") // second delete is a no-op
  })
})
```

- [ ] **Step 2: Confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test server/lib/storage/local-disk.test.ts`
Expected: module not found.

- [ ] **Step 3: Write the adapter interface**

```ts
// apps/dashboard/server/lib/storage/index.ts
export interface StorageAdapter {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<{ key: string }>
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string }>
  delete(key: string): Promise<void>
}

let _adapter: StorageAdapter | null = null

export async function getStorage(): Promise<StorageAdapter> {
  if (_adapter) return _adapter
  const driver = process.env.STORAGE_DRIVER ?? "local"
  if (driver === "s3") {
    const { S3Adapter } = await import("./s3")
    _adapter = new S3Adapter()
    return _adapter
  }
  const { LocalDiskAdapter } = await import("./local-disk")
  const root = process.env.STORAGE_LOCAL_ROOT ?? "./.data/attachments"
  _adapter = new LocalDiskAdapter(root)
  return _adapter
}

// Exposed for tests that want to swap adapters.
export function _setStorageForTesting(a: StorageAdapter | null) {
  _adapter = a
}
```

- [ ] **Step 4: Implement `LocalDiskAdapter`**

```ts
// apps/dashboard/server/lib/storage/local-disk.ts
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { StorageAdapter } from "./index"

const CONTENT_TYPE_SUFFIX = ".contenttype"

export class LocalDiskAdapter implements StorageAdapter {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async put(key: string, bytes: Uint8Array, contentType: string) {
    const full = this.resolveKey(key)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, bytes)
    await writeFile(`${full}${CONTENT_TYPE_SUFFIX}`, contentType, "utf8")
    return { key }
  }

  async get(key: string) {
    const full = this.resolveKey(key)
    const bytes = await readFile(full)
    let contentType = "application/octet-stream"
    try {
      contentType = (await readFile(`${full}${CONTENT_TYPE_SUFFIX}`, "utf8")).trim()
    } catch {
      // sidecar missing — fall through to default
    }
    return { bytes: new Uint8Array(bytes), contentType }
  }

  async delete(key: string) {
    const full = this.resolveKey(key)
    await Promise.all(
      [full, `${full}${CONTENT_TYPE_SUFFIX}`].map((p) => unlink(p).catch(() => undefined)),
    )
  }

  private resolveKey(key: string): string {
    const joined = resolve(join(this.root, key))
    if (!joined.startsWith(this.root)) {
      throw new Error(`storage: key "${key}" escapes root`)
    }
    return joined
  }
}
```

- [ ] **Step 5: Implement `S3Adapter` stub**

```ts
// apps/dashboard/server/lib/storage/s3.ts
import type { StorageAdapter } from "./index"

export class S3Adapter implements StorageAdapter {
  put(): never {
    throw new Error("S3 storage not implemented in v1 (see sub-project F/G follow-up)")
  }
  get(): never {
    throw new Error("S3 storage not implemented in v1 (see sub-project F/G follow-up)")
  }
  delete(): never {
    throw new Error("S3 storage not implemented in v1 (see sub-project F/G follow-up)")
  }
}
```

- [ ] **Step 6: Confirm tests pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test server/lib/storage/local-disk.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 7: Add `.data/` to `.gitignore`**

Edit `/Users/jiajingteoh/Documents/feedback-tool/.gitignore`, append if missing:

```
# Attachment storage (LocalDiskAdapter)
apps/dashboard/.data/
```

- [ ] **Step 8: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/storage .gitignore
git commit -m "feat(storage): add StorageAdapter interface with LocalDisk impl and S3 stub"
```

---

### Task 5: In-memory token-bucket rate limiter with TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/rate-limit.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/server/lib/rate-limit.test.ts
import { describe, expect, test } from "bun:test"
import { createRateLimiter } from "./rate-limit"

describe("createRateLimiter", () => {
  test("allows up to limit requests in the window", () => {
    const rl = createRateLimiter({ perMinute: 3, now: () => 0 })
    expect(rl.take("user-1")).toEqual({ allowed: true, retryAfterMs: 0 })
    expect(rl.take("user-1")).toEqual({ allowed: true, retryAfterMs: 0 })
    expect(rl.take("user-1")).toEqual({ allowed: true, retryAfterMs: 0 })
  })

  test("blocks over-limit requests and reports retryAfter", () => {
    const rl = createRateLimiter({ perMinute: 2, now: () => 0 })
    rl.take("user-1")
    rl.take("user-1")
    const third = rl.take("user-1")
    expect(third.allowed).toBe(false)
    expect(third.retryAfterMs).toBeGreaterThan(0)
  })

  test("refills over time (60s window)", () => {
    let t = 0
    const rl = createRateLimiter({ perMinute: 2, now: () => t })
    rl.take("u")
    rl.take("u")
    expect(rl.take("u").allowed).toBe(false)
    t = 60_001 // advance past a full window
    expect(rl.take("u").allowed).toBe(true)
  })

  test("isolates buckets by key", () => {
    const rl = createRateLimiter({ perMinute: 1, now: () => 0 })
    expect(rl.take("a").allowed).toBe(true)
    expect(rl.take("a").allowed).toBe(false)
    expect(rl.take("b").allowed).toBe(true)
  })
})
```

- [ ] **Step 2: Confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test server/lib/rate-limit.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/server/lib/rate-limit.ts
export interface RateLimiterOptions {
  perMinute: number
  now?: () => number
}

export interface TakeResult {
  allowed: boolean
  retryAfterMs: number
}

interface Bucket {
  tokens: number
  lastRefillMs: number
}

const WINDOW_MS = 60_000

export function createRateLimiter(opts: RateLimiterOptions) {
  const { perMinute } = opts
  const now = opts.now ?? (() => Date.now())
  const buckets = new Map<string, Bucket>()

  // periodic sweep to bound memory (every 60s, drop idle buckets)
  const sweep = () => {
    const t = now()
    for (const [k, b] of buckets) {
      if (t - b.lastRefillMs > WINDOW_MS * 10) buckets.delete(k)
    }
  }

  return {
    take(key: string): TakeResult {
      const t = now()
      let b = buckets.get(key)
      if (!b) {
        b = { tokens: perMinute - 1, lastRefillMs: t }
        buckets.set(key, b)
        return { allowed: true, retryAfterMs: 0 }
      }
      const elapsed = t - b.lastRefillMs
      const refill = (elapsed / WINDOW_MS) * perMinute
      b.tokens = Math.min(perMinute, b.tokens + refill)
      b.lastRefillMs = t
      if (b.tokens >= 1) {
        b.tokens -= 1
        return { allowed: true, retryAfterMs: 0 }
      }
      const needed = 1 - b.tokens
      const retryAfterMs = Math.ceil((needed / perMinute) * WINDOW_MS)
      return { allowed: false, retryAfterMs }
    },
    _sweep: sweep,
    _size: () => buckets.size,
  }
}

// Shared singletons used by the intake endpoint.
let _keyLimiter: ReturnType<typeof createRateLimiter> | null = null
let _ipLimiter: ReturnType<typeof createRateLimiter> | null = null

export function getKeyLimiter() {
  if (!_keyLimiter) {
    _keyLimiter = createRateLimiter({ perMinute: Number(process.env.INTAKE_RATE_PER_KEY ?? 60) })
  }
  return _keyLimiter
}

export function getIpLimiter() {
  if (!_ipLimiter) {
    _ipLimiter = createRateLimiter({ perMinute: Number(process.env.INTAKE_RATE_PER_IP ?? 20) })
  }
  return _ipLimiter
}
```

- [ ] **Step 4: Confirm pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test server/lib/rate-limit.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/rate-limit.ts apps/dashboard/server/lib/rate-limit.test.ts
git commit -m "feat(lib): add in-memory token-bucket rate limiter with tests"
```

---

### Task 6: Intake CORS helper

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/intake-cors.ts`

- [ ] **Step 1: Implement**

No dedicated unit test — exercised via the intake endpoint integration tests in Task 7.

```ts
// apps/dashboard/server/lib/intake-cors.ts
import type { H3Event } from "h3"
import { getHeader, setHeaders } from "h3"

/**
 * Applies the CORS response headers for the public intake endpoint. Always
 * reflects the request Origin (if present) so the SDK can read both success
 * and error responses. Actual origin-allowlist enforcement happens against
 * the specific project's allow-list inside the POST handler.
 */
export function applyIntakeCors(event: H3Event) {
  const origin = getHeader(event, "origin") ?? "*"
  setHeaders(event, {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  })
}

/**
 * Returns true if `origin` is accepted by the project's allow-list.
 * Dev leniency: empty allow-list + localhost origin passes.
 */
export function isOriginAllowed(origin: string | null | undefined, allowed: string[]): boolean {
  if (!origin) return false
  if (allowed.length > 0) return allowed.includes(origin)
  try {
    const u = new URL(origin)
    return u.hostname === "localhost" || u.hostname === "127.0.0.1"
  } catch {
    return false
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/intake-cors.ts
git commit -m "feat(lib): add intake CORS helpers"
```

---

## Phase 3 — Intake endpoint

### Task 7: `POST /api/intake/reports` + integration tests

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/intake/reports.post.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/api/intake.test.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/.env.example` (add new env vars)
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/helpers.ts` (add report-related helpers)

- [ ] **Step 1: Update `.env.example`**

Append to `/Users/jiajingteoh/Documents/feedback-tool/.env.example`:

```
# Intake storage
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=./apps/dashboard/.data/attachments

# Intake limits
INTAKE_RATE_PER_KEY=60
INTAKE_RATE_PER_IP=20
INTAKE_MAX_BYTES=5242880
```

Also append to your local `.env` so the dev server picks them up.

- [ ] **Step 2: Extend `tests/helpers.ts`**

Edit `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/helpers.ts` and append after the existing exports:

```ts
import { projects, reports, reportAttachments } from "../server/db/schema"

export async function truncateReports() {
  const { sql } = await import("drizzle-orm")
  await db.execute(
    sql`TRUNCATE report_attachments, reports RESTART IDENTITY CASCADE`,
  )
}

export async function seedProject(opts: {
  name: string
  publicKey: string
  allowedOrigins?: string[]
  createdBy: string
}): Promise<string> {
  const [p] = await db
    .insert(projects)
    .values({
      name: opts.name,
      slug: opts.name.toLowerCase().replace(/\s+/g, "-"),
      createdBy: opts.createdBy,
      publicKey: opts.publicKey,
      allowedOrigins: opts.allowedOrigins ?? [],
    })
    .returning()
  return p.id
}

export function makePngBlob(): Blob {
  // tiny valid 1x1 PNG (8 bytes of signature + IHDR + IDAT + IEND chunks)
  const bytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
    0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180,
    0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ])
  return new Blob([bytes], { type: "image/png" })
}
```

- [ ] **Step 3: Write the failing test**

```ts
// apps/dashboard/tests/api/intake.test.ts
import { setup } from "@nuxt/test-utils/e2e"
import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { createUser, makePngBlob, seedProject, truncateDomain, truncateReports } from "../helpers"
import { db } from "../../server/db"
import { reports, reportAttachments } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })

const PK = "ft_pk_ABCDEF1234567890abcdef12"
const BAD_PK = "ft_pk_ZZZZZZZZZZZZZZZZZZZZZZZZ"
const ORIGIN = "http://localhost:4000"

function buildReportJSON(projectKey: string, extra: Partial<{ title: string }> = {}) {
  return JSON.stringify({
    projectKey,
    title: extra.title ?? "It broke",
    description: "Clicking the Save button did nothing.",
    context: {
      pageUrl: "http://localhost:4000/app",
      userAgent: "Mozilla/5.0 Test",
      viewport: { w: 1440, h: 900 },
      timestamp: new Date().toISOString(),
      reporter: { email: "user@example.com" },
    },
  })
}

function buildMultipart(reportJson: string, screenshot?: Blob): FormData {
  const fd = new FormData()
  fd.set("report", new Blob([reportJson], { type: "application/json" }))
  if (screenshot) fd.set("screenshot", screenshot, "screenshot.png")
  return fd
}

describe("intake API", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("happy path: 201, creates report + attachment", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })

    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN)

    const [row] = await db.select().from(reports).where(sql`id = ${body.id}`)
    expect(row.title).toBe("It broke")
    const atts = await db.select().from(reportAttachments).where(sql`report_id = ${body.id}`)
    expect(atts.length).toBe(1)
    expect(atts[0].kind).toBe("screenshot")
  })

  test("rejects wrong origin with 403 (but still sets ACAO)", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: ["http://prod.example.com"],
      createdBy: admin,
    })

    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: "http://evil.example.com" },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(res.status).toBe(403)
    expect(res.headers.get("access-control-allow-origin")).toBe("http://evil.example.com")
  })

  test("rejects bad project key with 401", async () => {
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(BAD_PK), makePngBlob()),
    })
    expect(res.status).toBe(401)
  })

  test("OPTIONS preflight returns 204 with ACAO reflecting origin", async () => {
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN)
    expect(res.headers.get("access-control-allow-methods")).toContain("POST")
  })
})
```

- [ ] **Step 4: Confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/intake.test.ts`
Expected: FAIL (endpoint not implemented).

- [ ] **Step 5: Implement the endpoint**

```ts
// apps/dashboard/server/api/intake/reports.post.ts
import { createError, defineEventHandler, getHeader, getRequestIP, readMultipartFormData } from "h3"
import { eq } from "drizzle-orm"
import { ReportIntakeInput } from "@feedback-tool/shared"
import { db } from "../../db"
import { projects, reports, reportAttachments } from "../../db/schema"
import { applyIntakeCors, isOriginAllowed } from "../../lib/intake-cors"
import { getIpLimiter, getKeyLimiter } from "../../lib/rate-limit"
import { getStorage } from "../../lib/storage"

const MAX_BYTES = Number(process.env.INTAKE_MAX_BYTES ?? 5 * 1024 * 1024)

export default defineEventHandler(async (event) => {
  applyIntakeCors(event)

  if (event.method === "OPTIONS") {
    event.node.res.statusCode = 204
    return ""
  }

  if (event.method !== "POST") {
    throw createError({ statusCode: 405, statusMessage: "Method not allowed" })
  }

  const origin = getHeader(event, "origin") ?? ""
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? "unknown"

  // 1. Read multipart payload with size cap.
  let parts: Awaited<ReturnType<typeof readMultipartFormData>>
  try {
    parts = await readMultipartFormData(event)
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid multipart body" })
  }
  if (!parts) {
    throw createError({ statusCode: 400, statusMessage: "Expected multipart/form-data" })
  }
  const totalBytes = parts.reduce((n, p) => n + (p.data?.length ?? 0), 0)
  if (totalBytes > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Payload too large" })
  }

  const reportPart = parts.find((p) => p.name === "report")
  if (!reportPart) {
    throw createError({ statusCode: 400, statusMessage: "Missing 'report' part" })
  }

  let parsed: ReturnType<typeof ReportIntakeInput.parse>
  try {
    parsed = ReportIntakeInput.parse(JSON.parse(reportPart.data.toString("utf8")))
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid report payload" })
  }

  // 2. Project lookup by publicKey.
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.publicKey, parsed.projectKey))
    .limit(1)
  if (!project || project.deletedAt) {
    throw createError({ statusCode: 401, statusMessage: "Invalid project key" })
  }

  // 3. Rate limit.
  const keyTake = getKeyLimiter().take(`key:${project.id}`)
  if (!keyTake.allowed) {
    event.node.res.setHeader("Retry-After", Math.ceil(keyTake.retryAfterMs / 1000).toString())
    throw createError({ statusCode: 429, statusMessage: "Too many reports for this project" })
  }
  const ipTake = getIpLimiter().take(`ip:${ip}`)
  if (!ipTake.allowed) {
    event.node.res.setHeader("Retry-After", Math.ceil(ipTake.retryAfterMs / 1000).toString())
    throw createError({ statusCode: 429, statusMessage: "Too many reports from this IP" })
  }

  // 4. Origin allow-list.
  if (!isOriginAllowed(origin, project.allowedOrigins)) {
    throw createError({ statusCode: 403, statusMessage: "Origin not allowed" })
  }

  // 5. Persist.
  const screenshotPart = parts.find((p) => p.name === "screenshot")
  const [report] = await db
    .insert(reports)
    .values({
      projectId: project.id,
      title: parsed.title,
      description: parsed.description ?? null,
      context: { ...parsed.context, ...(parsed.metadata ? { metadata: parsed.metadata } : {}) },
      origin,
      ip,
    })
    .returning()

  if (screenshotPart?.data && screenshotPart.data.length > 0) {
    const storage = await getStorage()
    const key = `attachments/${report.id}/screenshot.png`
    await storage.put(key, new Uint8Array(screenshotPart.data), "image/png")
    await db.insert(reportAttachments).values({
      reportId: report.id,
      kind: "screenshot",
      storageKey: key,
      contentType: "image/png",
      sizeBytes: screenshotPart.data.length,
    })
  }

  event.node.res.statusCode = 201
  return { id: report.id }
})
```

- [ ] **Step 6: Confirm tests pass**

Ensure dev server is running and DB is clean:
```bash
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000 | xargs -r kill -9 2>/dev/null
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE" >/dev/null
bun run dev > /tmp/intake-test.log 2>&1 &
PID=$!
sleep 22
cd apps/dashboard && bun test tests/api/intake.test.ts 2>&1 | tail -15
kill $PID 2>/dev/null
wait $PID 2>/dev/null
lsof -ti:3000 | xargs -r kill -9 2>/dev/null
```
Expected: 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/intake apps/dashboard/tests/api/intake.test.ts apps/dashboard/tests/helpers.ts .env.example
git commit -m "feat(api): add POST /api/intake/reports with CORS, rate limit, and multipart handling"
```

---

## Phase 4 — Dashboard viewer

### Task 8: `GET /api/projects/:id/reports` list endpoint with tests

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/index.get.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/api/reports.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/tests/api/reports.test.ts
import { setup } from "@nuxt/test-utils/e2e"
import { afterEach, describe, expect, test } from "bun:test"
import type { ReportSummaryDTO } from "@feedback-tool/shared"
import {
  apiFetch,
  createUser,
  makePngBlob,
  seedProject,
  signIn,
  truncateDomain,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })

const PK = "ft_pk_ABCDEF1234567890abcdef12"
const ORIGIN = "http://localhost:4000"

async function submitReport(title: string) {
  const fd = new FormData()
  fd.set(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey: PK,
          title,
          description: "d",
          context: {
            pageUrl: "http://localhost:4000/p",
            userAgent: "UA",
            viewport: { w: 1000, h: 800 },
            timestamp: new Date().toISOString(),
            reporter: { email: "u@example.com" },
          },
        }),
      ],
      { type: "application/json" },
    ),
  )
  fd.set("screenshot", makePngBlob(), "s.png")
  const res = await fetch("http://localhost:3000/api/intake/reports", {
    method: "POST",
    headers: { Origin: ORIGIN },
    body: fd,
  })
  if (res.status !== 201) throw new Error(`intake failed: ${res.status}`)
  return ((await res.json()) as { id: string }).id
}

describe("reports list API", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("admin sees reports for a project ordered newest first", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await submitReport("first")
    await new Promise((r) => setTimeout(r, 10))
    await submitReport("second")

    const cookie = await signIn("admin@example.com")
    const { status, body } = await apiFetch<{ items: ReportSummaryDTO[]; total: number }>(
      `/api/projects/${projectId}/reports`,
      { headers: { cookie } },
    )
    expect(status).toBe(200)
    expect(body.total).toBe(2)
    expect(body.items[0].title).toBe("second")
    expect(body.items[1].title).toBe("first")
    expect(body.items[0].reporterEmail).toBe("u@example.com")
    expect(body.items[0].thumbnailUrl).toContain("/attachment")
  })

  test("non-member gets 404", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await createUser("stranger@example.com", "member")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await submitReport("private")

    const cookie = await signIn("stranger@example.com")
    const { status } = await apiFetch(`/api/projects/${projectId}/reports`, { headers: { cookie } })
    expect(status).toBe(404)
  })
})
```

- [ ] **Step 2: Confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/reports.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the list endpoint**

```ts
// apps/dashboard/server/api/projects/[id]/reports/index.get.ts
import { defineEventHandler, getQuery, getRouterParam } from "h3"
import { and, count, desc, eq, sql } from "drizzle-orm"
import type { ReportContext, ReportSummaryDTO } from "@feedback-tool/shared"
import { db } from "../../../../db"
import { reports, reportAttachments } from "../../../../db/schema"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw new Error("missing project id")
  await requireProjectRole(event, id, "viewer")

  const q = getQuery(event)
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)))
  const offset = Math.max(0, Number(q.offset ?? 0))

  const [{ total }] = await db
    .select({ total: count() })
    .from(reports)
    .where(eq(reports.projectId, id))

  const rows = await db
    .select({
      id: reports.id,
      title: reports.title,
      context: reports.context,
      createdAt: reports.createdAt,
      attachmentId: reportAttachments.id,
      attachmentKind: reportAttachments.kind,
    })
    .from(reports)
    .leftJoin(
      reportAttachments,
      and(eq(reportAttachments.reportId, reports.id), eq(reportAttachments.kind, "screenshot")),
    )
    .where(eq(reports.projectId, id))
    .orderBy(desc(reports.createdAt))
    .limit(limit)
    .offset(offset)

  const items: ReportSummaryDTO[] = rows.map((r) => {
    const ctx = r.context as ReportContext
    return {
      id: r.id,
      title: r.title,
      reporterEmail: ctx.reporter?.email ?? null,
      pageUrl: ctx.pageUrl,
      receivedAt: r.createdAt.toISOString(),
      thumbnailUrl: r.attachmentId
        ? `/api/projects/${id}/reports/${r.id}/attachment?kind=screenshot`
        : null,
    }
  })

  return { items, total }
})
```

- [ ] **Step 4: Confirm tests pass**

Ensure dev server is up then:
```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/reports.test.ts
```
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/projects apps/dashboard/tests/api/reports.test.ts
git commit -m "feat(api): add GET /api/projects/:id/reports list endpoint"
```

---

### Task 9: Attachment streaming endpoint

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/[reportId]/attachment.get.ts`
- Test: append to `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/api/reports.test.ts`

- [ ] **Step 1: Extend the test file**

Append to `apps/dashboard/tests/api/reports.test.ts`:

```ts
describe("attachment GET", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("streams PNG bytes with correct Content-Type", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const reportId = await submitReport("pic")

    const cookie = await signIn("admin@example.com")
    const res = await fetch(
      `http://localhost:3000/api/projects/${projectId}/reports/${reportId}/attachment?kind=screenshot`,
      { headers: { cookie } },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/png")
    const buf = new Uint8Array(await res.arrayBuffer())
    // PNG signature
    expect(Array.from(buf.slice(0, 4))).toEqual([137, 80, 78, 71])
  })

  test("cross-project attachment access returns 404", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectA = await seedProject({
      name: "A",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const projectB = await seedProject({
      name: "B",
      publicKey: "ft_pk_BBBBBBBBBBBBBBBBBBBBBBBB",
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const reportId = await submitReport("in A")

    const cookie = await signIn("admin@example.com")
    const res = await fetch(
      `http://localhost:3000/api/projects/${projectB}/reports/${reportId}/attachment?kind=screenshot`,
      { headers: { cookie } },
    )
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/reports.test.ts`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/server/api/projects/[id]/reports/[reportId]/attachment.get.ts
import {
  createError,
  defineEventHandler,
  getQuery,
  getRouterParam,
  setHeader,
  setResponseStatus,
} from "h3"
import { and, eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { reportAttachments, reports } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"
import { getStorage } from "../../../../../lib/storage"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) throw createError({ statusCode: 400, statusMessage: "bad params" })
  await requireProjectRole(event, projectId, "viewer")

  const kindRaw = getQuery(event).kind
  const kind = typeof kindRaw === "string" ? kindRaw : "screenshot"

  const [row] = await db
    .select({
      storageKey: reportAttachments.storageKey,
      contentType: reportAttachments.contentType,
    })
    .from(reportAttachments)
    .innerJoin(reports, eq(reports.id, reportAttachments.reportId))
    .where(
      and(
        eq(reportAttachments.reportId, reportId),
        eq(reportAttachments.kind, kind as "screenshot" | "annotated-screenshot" | "replay" | "logs"),
        eq(reports.projectId, projectId),
      ),
    )
    .limit(1)

  if (!row) throw createError({ statusCode: 404, statusMessage: "Attachment not found" })

  const storage = await getStorage()
  const { bytes, contentType } = await storage.get(row.storageKey)

  setHeader(event, "Content-Type", contentType || row.contentType)
  setHeader(event, "Cache-Control", "private, max-age=3600")
  setResponseStatus(event, 200)
  return Buffer.from(bytes)
})
```

- [ ] **Step 4: Confirm tests pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/reports.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add "apps/dashboard/server/api/projects/[id]/reports/[reportId]" apps/dashboard/tests/api/reports.test.ts
git commit -m "feat(api): add GET report attachment streaming endpoint"
```

---

### Task 10: Reports viewer page + project settings (public_key + allowed_origins UI)

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/projects/[id]/reports.vue`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/projects/[id]/index.vue` (add Reports nav link)
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/projects/[id]/settings.vue` (manage public_key + allowed_origins)
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/rotate-key.post.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/index.patch.ts` (accept `allowedOrigins` in body; return `publicKey` + `allowedOrigins` in response)
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/index.get.ts` (include `publicKey` + `allowedOrigins`)
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/src/projects.ts` (extend `ProjectDTO` with `publicKey`, `allowedOrigins`; extend `UpdateProjectInput` with `allowedOrigins`)

- [ ] **Step 1: Extend shared DTO**

In `packages/shared/src/projects.ts`, replace the `ProjectDTO` and `UpdateProjectInput` definitions:

```ts
export const ProjectDTO = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  effectiveRole: ProjectRole,
  publicKey: z.string().nullable(),
  allowedOrigins: z.array(z.string()),
})
export type ProjectDTO = z.infer<typeof ProjectDTO>

export const UpdateProjectInput = z.object({
  name: z.string().min(1).max(80).optional(),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9](-?[a-z0-9])*$/, "Slug must be lowercase alphanumeric with dashes")
    .optional(),
  allowedOrigins: z.array(z.string().url()).max(20).optional(),
})
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>
```

- [ ] **Step 2: Update the GET project endpoint**

Edit `apps/dashboard/server/api/projects/[id]/index.get.ts` — update the return object to include `publicKey: p.publicKey` and `allowedOrigins: p.allowedOrigins`:

```ts
return {
  id: p.id,
  name: p.name,
  slug: p.slug,
  createdBy: p.createdBy,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
  effectiveRole,
  publicKey: p.publicKey,
  allowedOrigins: p.allowedOrigins,
}
```

- [ ] **Step 3: Update the PATCH project endpoint**

Edit `apps/dashboard/server/api/projects/[id]/index.patch.ts` — the handler already passes `...body` through to drizzle; Zod now accepts `allowedOrigins`. Extend the return object similarly:

```ts
return {
  id: updated.id,
  name: updated.name,
  slug: updated.slug,
  createdBy: updated.createdBy,
  createdAt: updated.createdAt.toISOString(),
  updatedAt: updated.updatedAt.toISOString(),
  effectiveRole: "owner" as const,
  publicKey: updated.publicKey,
  allowedOrigins: updated.allowedOrigins,
}
```

- [ ] **Step 4: Add the rotate-key endpoint**

```ts
// apps/dashboard/server/api/projects/[id]/rotate-key.post.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { projects } from "../../../db/schema"
import { requireProjectRole } from "../../../lib/permissions"
import { generatePublicKey } from "../../../lib/project-key"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing id" })
  await requireProjectRole(event, id, "owner")

  const newKey = generatePublicKey()
  const [updated] = await db
    .update(projects)
    .set({ publicKey: newKey, publicKeyRegeneratedAt: new Date(), updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning()

  return { publicKey: updated.publicKey }
})
```

- [ ] **Step 5: Update the project index page nav**

Edit `apps/dashboard/app/pages/projects/[id]/index.vue`, replacing the `<div class="flex gap-3 text-sm">` block to include the Reports link:

```vue
<div class="flex gap-3 text-sm">
  <NuxtLink :to="`/projects/${project?.id}/reports`" class="underline">Reports</NuxtLink>
  <NuxtLink :to="`/projects/${project?.id}/members`" class="underline">Members</NuxtLink>
  <NuxtLink
    v-if="project?.effectiveRole === 'owner'"
    :to="`/projects/${project?.id}/settings`"
    class="underline"
  >Settings</NuxtLink>
</div>
```

Also update the placeholder card text:

```vue
<div class="border rounded-lg p-6 bg-white text-neutral-500 text-sm">
  Bug reports sent from your SDK embed will appear in <NuxtLink
    :to="`/projects/${project?.id}/reports`"
    class="underline"
  >Reports</NuxtLink>. See <NuxtLink :to="`/projects/${project?.id}/settings`" class="underline">Settings</NuxtLink> for your project's embed key.
</div>
```

- [ ] **Step 6: Update the project settings page**

Replace the contents of `apps/dashboard/app/pages/projects/[id]/settings.vue`:

```vue
<script setup lang="ts">
import type { ProjectDTO } from "@feedback-tool/shared"
const route = useRoute()
const { data: project, refresh } = await useApi<ProjectDTO>(`/api/projects/${route.params.id}`)
const name = ref(project.value?.name ?? "")
const slug = ref(project.value?.slug ?? "")
const originsText = ref((project.value?.allowedOrigins ?? []).join("\n"))
const rotating = ref(false)

async function save() {
  const allowedOrigins = originsText.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
  await $fetch(`/api/projects/${route.params.id}`, {
    method: "PATCH",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { name: name.value, slug: slug.value, allowedOrigins },
  })
  await refresh()
}

async function rotateKey() {
  if (!confirm("Rotating invalidates the current key immediately. Embeds using the old key will stop working. Continue?")) return
  rotating.value = true
  try {
    await $fetch(`/api/projects/${route.params.id}/rotate-key`, {
      method: "POST",
      baseURL: useRuntimeConfig().public.betterAuthUrl,
      credentials: "include",
    })
    await refresh()
  } finally {
    rotating.value = false
  }
}

async function softDelete() {
  if (!confirm("Delete this project?")) return
  await $fetch(`/api/projects/${route.params.id}`, {
    method: "DELETE",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
  })
  await navigateTo("/")
}
</script>

<template>
  <div class="space-y-8 max-w-lg">
    <h1 class="text-2xl font-semibold">Project settings</h1>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-neutral-600">General</h2>
      <form class="space-y-3" @submit.prevent="save">
        <label class="block">
          <span class="text-sm">Name</span>
          <input v-model="name" class="w-full border rounded px-3 py-2" />
        </label>
        <label class="block">
          <span class="text-sm">Slug</span>
          <input v-model="slug" class="w-full border rounded px-3 py-2" />
        </label>
        <label class="block">
          <span class="text-sm">Allowed origins <span class="text-neutral-500">(one per line, e.g. <code>http://localhost:4000</code>)</span></span>
          <textarea v-model="originsText" rows="4" class="w-full border rounded px-3 py-2 font-mono text-xs"></textarea>
        </label>
        <button class="bg-neutral-900 text-white rounded px-4 py-2">Save</button>
      </form>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-neutral-600">Embed key</h2>
      <div class="border rounded-lg bg-white p-4 space-y-2">
        <div class="font-mono text-sm break-all">{{ project?.publicKey ?? "(not generated)" }}</div>
        <button class="text-sm underline text-red-600 disabled:opacity-50" :disabled="rotating" @click="rotateKey">
          {{ rotating ? "Rotating…" : "Rotate key" }}
        </button>
      </div>
      <pre class="text-xs bg-neutral-100 rounded p-3 overflow-x-auto"
><code>&lt;script src="&#123;&#123; dashboardUrl &#125;&#125;/sdk/feedback-tool.iife.js"&gt;&lt;/script&gt;
&lt;script&gt;
  FeedbackTool.init(&#123;
    projectKey: "&#123;&#123; project?.publicKey &#125;&#125;",
    endpoint: "&#123;&#123; dashboardUrl &#125;&#125;"
  &#125;)
&lt;/script&gt;</code></pre>
    </section>

    <section class="border-t pt-4">
      <button class="text-red-600" @click="softDelete">Delete project</button>
    </section>
  </div>
</template>
```

(The `dashboardUrl` placeholder reads from runtime config; add this to the script setup if you want it dynamic — `const dashboardUrl = useRuntimeConfig().public.betterAuthUrl`.)

- [ ] **Step 7: Write the reports page**

```vue
<!-- apps/dashboard/app/pages/projects/[id]/reports.vue -->
<script setup lang="ts">
import type { ReportSummaryDTO, ReportContext } from "@feedback-tool/shared"

const route = useRoute()
const { data } = await useApi<{ items: ReportSummaryDTO[]; total: number }>(
  `/api/projects/${route.params.id}/reports?limit=50`,
)

const selected = ref<ReportSummaryDTO | null>(null)
const detailContext = ref<ReportContext | null>(null)
const detailDescription = ref<string | null>(null)

async function openDetail(r: ReportSummaryDTO) {
  selected.value = r
  // Lazy: we have everything we need except description + full context.
  // The list endpoint doesn't carry description; hit a lightweight extension here.
  const detail = await $fetch<{
    description: string | null
    context: ReportContext
  }>(`/api/projects/${route.params.id}/reports?limit=1&offset=0&id=${r.id}`, {
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
  }).catch(() => null)
  // Fallback: if we didn't hydrate detail (the list endpoint doesn't filter by id
  // in v1), fetch the screenshot anyway; context is available on the summary row
  // via pageUrl — good enough for the drawer.
  detailContext.value = detail?.context ?? null
  detailDescription.value = detail?.description ?? null
}

function close() {
  selected.value = null
  detailContext.value = null
  detailDescription.value = null
}

const fmtTime = (iso: string) => new Date(iso).toLocaleString()
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Reports</h1>
      <div class="text-sm text-neutral-500">{{ data?.total ?? 0 }} total</div>
    </div>
    <div v-if="!data?.items?.length" class="border rounded-lg p-6 bg-white text-sm text-neutral-500">
      No reports yet. See the project settings for your embed snippet.
    </div>
    <table v-else class="w-full bg-white border rounded overflow-hidden">
      <thead class="bg-neutral-100 text-left text-sm">
        <tr>
          <th class="p-3 w-14"></th>
          <th class="p-3">Title</th>
          <th class="p-3">Reporter</th>
          <th class="p-3">Page</th>
          <th class="p-3">Received</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in data.items"
          :key="r.id"
          class="border-t hover:bg-neutral-50 cursor-pointer"
          @click="openDetail(r)"
        >
          <td class="p-3">
            <img
              v-if="r.thumbnailUrl"
              :src="r.thumbnailUrl"
              alt=""
              class="w-10 h-10 object-cover rounded border"
              loading="lazy"
            />
          </td>
          <td class="p-3 font-medium">{{ r.title }}</td>
          <td class="p-3 text-sm">{{ r.reporterEmail ?? "anonymous" }}</td>
          <td class="p-3 text-xs text-neutral-600 truncate max-w-sm">{{ r.pageUrl }}</td>
          <td class="p-3 text-sm text-neutral-500">{{ fmtTime(r.receivedAt) }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="selected" class="fixed inset-0 bg-black/40 z-50" @click="close">
      <aside
        class="absolute right-0 top-0 h-full w-[640px] max-w-full bg-white shadow-2xl overflow-y-auto"
        @click.stop
      >
        <header class="p-4 border-b flex items-center justify-between">
          <h2 class="font-semibold">{{ selected.title }}</h2>
          <button class="text-neutral-500" @click="close">Close</button>
        </header>
        <div class="p-4 space-y-4">
          <img
            v-if="selected.thumbnailUrl"
            :src="selected.thumbnailUrl"
            alt=""
            class="w-full border rounded"
          />
          <div class="text-sm">
            <div><span class="text-neutral-500">Reporter:</span> {{ selected.reporterEmail ?? "anonymous" }}</div>
            <div><span class="text-neutral-500">Page:</span> <a :href="selected.pageUrl" target="_blank" class="underline">{{ selected.pageUrl }}</a></div>
            <div><span class="text-neutral-500">Received:</span> {{ fmtTime(selected.receivedAt) }}</div>
          </div>
          <details class="text-xs">
            <summary class="cursor-pointer text-neutral-500">Raw context</summary>
            <pre class="mt-2 bg-neutral-100 p-3 rounded overflow-x-auto">{{ JSON.stringify(detailContext, null, 2) }}</pre>
          </details>
        </div>
      </aside>
    </div>
  </div>
</template>
```

> **Note:** The drawer uses the summary DTO data it already has for page URL + reporter + received-at. Full `description` + complete `context` rendering can be layered on when the list endpoint gets filter-by-id or a dedicated detail endpoint in sub-project F.

- [ ] **Step 8: Smoke-test the UI**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000 | xargs -r kill -9 2>/dev/null
bun run dev > /tmp/viewer.log 2>&1 &
PID=$!
sleep 22
curl -s http://localhost:3000/ -I -m 5 | head -1
kill $PID 2>/dev/null
wait $PID 2>/dev/null
lsof -ti:3000 | xargs -r kill -9 2>/dev/null
grep -E "ERROR" /tmp/viewer.log | grep -v Duplicated | head -5
```
Expected: server compiles without errors (we'll validate the actual page rendering during Task 20's manual smoke).

- [ ] **Step 9: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/pages/projects packages/shared/src/projects.ts apps/dashboard/server/api/projects
git commit -m "feat(dashboard): add reports viewer page and embed-key management in settings"
```

---

## Phase 5 — SDK core

### Task 11: Scaffold `packages/core`

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/package.json`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/tsconfig.json`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/tsdown.config.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/index.ts` (placeholder)

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@feedback-tool/sdk",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.mjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch"
  },
  "dependencies": {
    "@feedback-tool/shared": "workspace:*",
    "@feedback-tool/ui": "workspace:*",
    "modern-screenshot": "^4.6.0"
  },
  "devDependencies": {
    "tsdown": "^0.9.0"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "jsx": "preserve"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/core/tsdown.config.ts`**

```ts
import { defineConfig } from "tsdown"

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    outDir: "dist",
    dts: true,
    platform: "browser",
    target: "es2020",
  },
  {
    entry: { "feedback-tool.iife": "src/index.ts" },
    format: ["iife"],
    outDir: "dist",
    platform: "browser",
    target: "es2020",
    minify: true,
    globalName: "FeedbackTool",
  },
])
```

- [ ] **Step 4: Placeholder entry**

```ts
// packages/core/src/index.ts
// Public API will be filled in by subsequent tasks.
export const __version = "0.0.0"
```

- [ ] **Step 5: Install + verify build**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun install
cd packages/core && bunx tsdown
ls dist/
```
Expected: `dist/index.mjs`, `dist/index.d.ts`, `dist/feedback-tool.iife.js`.

- [ ] **Step 6: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/core bun.lock
git commit -m "chore(sdk): scaffold @feedback-tool/sdk package with tsdown dual build"
```

---

### Task 12: `config.ts` with TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/config.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/config.test.ts`

- [ ] **Step 1: Failing test**

```ts
// packages/core/src/config.test.ts
import { describe, expect, test } from "bun:test"
import { resolveConfig } from "./config"

describe("resolveConfig", () => {
  test("accepts a valid minimal config", () => {
    const c = resolveConfig({
      projectKey: "ft_pk_ABCDEF1234567890abcdef12",
      endpoint: "https://dash.example.com",
    })
    expect(c.projectKey).toBe("ft_pk_ABCDEF1234567890abcdef12")
    expect(c.endpoint).toBe("https://dash.example.com")
    expect(c.position).toBe("bottom-right")
    expect(c.launcher).toBe(true)
  })

  test("strips trailing slash from endpoint", () => {
    const c = resolveConfig({
      projectKey: "ft_pk_ABCDEF1234567890abcdef12",
      endpoint: "https://dash.example.com/",
    })
    expect(c.endpoint).toBe("https://dash.example.com")
  })

  test("throws on missing projectKey", () => {
    // @ts-expect-error — deliberately invalid
    expect(() => resolveConfig({ endpoint: "https://x" })).toThrow(/projectKey/)
  })

  test("throws on malformed endpoint", () => {
    expect(() =>
      resolveConfig({ projectKey: "ft_pk_ABCDEF1234567890abcdef12", endpoint: "not a url" }),
    ).toThrow(/endpoint/)
  })

  test("throws on malformed projectKey", () => {
    expect(() =>
      resolveConfig({ projectKey: "bad", endpoint: "https://x" }),
    ).toThrow(/projectKey/)
  })
})
```

- [ ] **Step 2: Confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/packages/core && bun test src/config.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/config.ts
export interface InitOptions {
  projectKey: string
  endpoint: string
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  launcher?: boolean
  metadata?: Record<string, string | number | boolean>
}

export interface ResolvedConfig {
  projectKey: string
  endpoint: string
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  launcher: boolean
  metadata: Record<string, string | number | boolean> | undefined
}

const KEY_RE = /^ft_pk_[A-Za-z0-9]{24}$/

export function resolveConfig(opts: InitOptions): ResolvedConfig {
  if (!opts || typeof opts.projectKey !== "string" || !KEY_RE.test(opts.projectKey)) {
    throw new Error("FeedbackTool.init: projectKey is required and must match ft_pk_[24 base62 chars]")
  }
  let endpoint: string
  try {
    const u = new URL(opts.endpoint)
    endpoint = u.origin + u.pathname.replace(/\/+$/, "")
    if (endpoint.endsWith("/")) endpoint = endpoint.slice(0, -1)
  } catch {
    throw new Error("FeedbackTool.init: endpoint must be a valid absolute URL")
  }
  return {
    projectKey: opts.projectKey,
    endpoint,
    position: opts.position ?? "bottom-right",
    launcher: opts.launcher ?? true,
    metadata: opts.metadata,
  }
}
```

- [ ] **Step 4: Confirm pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/packages/core && bun test src/config.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/core/src/config.ts packages/core/src/config.test.ts
git commit -m "feat(sdk): add config resolution with tests"
```

---

### Task 13: `context.ts` with TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/context.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/context.test.ts`

- [ ] **Step 1: Failing test**

```ts
// packages/core/src/context.test.ts
import { describe, expect, test, beforeAll } from "bun:test"

// Use happy-dom for DOM globals under bun test.
beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window({ url: "http://localhost:4000/app?x=1" })
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
    navigator: win.navigator,
  })
})

import { gatherContext } from "./context"

describe("gatherContext", () => {
  test("captures core page + viewport + timestamp", () => {
    const ctx = gatherContext(null, undefined)
    expect(ctx.pageUrl).toBe("http://localhost:4000/app?x=1")
    expect(typeof ctx.userAgent).toBe("string")
    expect(ctx.viewport.w).toBeGreaterThan(0)
    expect(ctx.viewport.h).toBeGreaterThan(0)
    expect(ctx.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(ctx.reporter).toBeUndefined()
    expect(ctx.metadata).toBeUndefined()
  })

  test("includes reporter when provided", () => {
    const ctx = gatherContext({ email: "u@example.com", name: "U" }, undefined)
    expect(ctx.reporter).toEqual({ email: "u@example.com", name: "U" })
  })

  test("includes metadata when provided", () => {
    const ctx = gatherContext(null, { plan: "pro", seats: 5 })
    expect(ctx.metadata).toEqual({ plan: "pro", seats: 5 })
  })
})
```

- [ ] **Step 2: Add happy-dom dev dep**

Edit `packages/core/package.json` devDependencies:

```json
"happy-dom": "^15.0.0"
```

Then: `cd /Users/jiajingteoh/Documents/feedback-tool && bun install`.

- [ ] **Step 3: Confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/packages/core && bun test src/context.test.ts`
Expected: module not found.

- [ ] **Step 4: Implement**

```ts
// packages/core/src/context.ts
import type { ReportContext, ReporterIdentity } from "@feedback-tool/shared"

export function gatherContext(
  reporter: ReporterIdentity | null,
  metadata: Record<string, string | number | boolean> | undefined,
): ReportContext {
  return {
    pageUrl: location.href,
    userAgent: navigator.userAgent,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    timestamp: new Date().toISOString(),
    ...(reporter ? { reporter } : {}),
    ...(metadata ? { metadata } : {}),
  }
}
```

- [ ] **Step 5: Confirm pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/packages/core && bun test src/context.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/core bun.lock
git commit -m "feat(sdk): add context gatherer with tests"
```

---

### Task 14: `screenshot.ts` wrapper with TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/screenshot.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/screenshot.test.ts`

- [ ] **Step 1: Failing test**

```ts
// packages/core/src/screenshot.test.ts
import { describe, expect, test, beforeAll, mock } from "bun:test"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window({ url: "http://localhost:4000" })
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
    navigator: win.navigator,
  })
})

// Stub modern-screenshot before importing ./screenshot
mock.module("modern-screenshot", () => ({
  domToBlob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
}))

import { capture } from "./screenshot"

describe("capture", () => {
  test("returns a PNG blob on success", async () => {
    const blob = await capture()
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe("image/png")
  })

  test("hides widget host during capture", async () => {
    const host = document.createElement("div")
    host.id = "feedback-tool-host"
    host.style.display = "block"
    document.body.appendChild(host)
    await capture()
    // Restored after capture
    expect(host.style.display).toBe("block")
    host.remove()
  })
})
```

- [ ] **Step 2: Confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/packages/core && bun test src/screenshot.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/screenshot.ts
import { domToBlob } from "modern-screenshot"

export async function capture(): Promise<Blob | null> {
  const host = typeof document !== "undefined" ? document.getElementById("feedback-tool-host") : null
  const prev = host?.style.display ?? ""
  if (host) host.style.display = "none"
  try {
    return await domToBlob(document.documentElement, {
      scale: window.devicePixelRatio || 1,
      width: window.innerWidth,
      height: window.innerHeight,
    })
  } catch (err) {
    console.warn("[feedback-tool] screenshot capture failed:", err)
    return null
  } finally {
    if (host) host.style.display = prev
  }
}
```

- [ ] **Step 4: Confirm pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/packages/core && bun test src/screenshot.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/core/src/screenshot.ts packages/core/src/screenshot.test.ts
git commit -m "feat(sdk): add screenshot wrapper with tests"
```

---

### Task 15: `intake-client.ts` + public API in `index.ts`

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/intake-client.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/index.ts`

- [ ] **Step 1: Write `intake-client.ts`**

```ts
// packages/core/src/intake-client.ts
import type { ReportContext } from "@feedback-tool/shared"
import type { ResolvedConfig } from "./config"

export interface IntakeInput {
  title: string
  description: string
  context: ReportContext
  metadata?: Record<string, string | number | boolean>
  screenshot: Blob | null
}

export interface IntakeResult {
  ok: true
  id: string
} 

export interface IntakeError {
  ok: false
  status: number
  message: string
}

export async function postReport(
  config: ResolvedConfig,
  input: IntakeInput,
): Promise<IntakeResult | IntakeError> {
  const body = new FormData()
  body.set(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey: config.projectKey,
          title: input.title,
          description: input.description,
          context: input.context,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        }),
      ],
      { type: "application/json" },
    ),
  )
  if (input.screenshot) body.set("screenshot", input.screenshot, "screenshot.png")

  try {
    const res = await fetch(`${config.endpoint}/api/intake/reports`, {
      method: "POST",
      body,
      credentials: "omit",
      signal: AbortSignal.timeout(30_000),
    })
    if (res.ok) {
      const data = (await res.json()) as { id: string }
      return { ok: true, id: data.id }
    }
    let message = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { statusMessage?: string; message?: string }
      message = data.statusMessage ?? data.message ?? message
    } catch {
      // non-JSON error — keep HTTP status
    }
    return { ok: false, status: res.status, message }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "Network error",
    }
  }
}
```

- [ ] **Step 2: Write `index.ts` public API**

Replace `packages/core/src/index.ts` contents with:

```ts
// packages/core/src/index.ts
import type { ReporterIdentity } from "@feedback-tool/shared"
import { mount, open as uiOpen, close as uiClose, unmount } from "@feedback-tool/ui"
import { resolveConfig, type InitOptions, type ResolvedConfig } from "./config"
import { gatherContext } from "./context"
import { capture } from "./screenshot"
import { postReport } from "./intake-client"

let _config: ResolvedConfig | null = null
let _reporter: ReporterIdentity | null = null
let _mounted = false

export function init(options: InitOptions): void {
  const cfg = resolveConfig(options)
  _config = cfg
  if (_mounted) unmount()
  mount({
    config: cfg,
    onSubmit: async ({ title, description }) => {
      if (!_config) throw new Error("FeedbackTool not initialized")
      const screenshot = await capture()
      const context = gatherContext(_reporter, _config.metadata)
      const result = await postReport(_config, {
        title,
        description,
        context,
        metadata: _config.metadata,
        screenshot,
      })
      return result
    },
  })
  _mounted = true
}

export function open(): void {
  if (!_config) throw new Error("FeedbackTool.open called before init")
  uiOpen()
}

export function close(): void {
  uiClose()
}

export function identify(reporter: ReporterIdentity | null): void {
  _reporter = reporter
}

// For tests and teardown.
export function _unmount() {
  unmount()
  _mounted = false
  _config = null
  _reporter = null
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/core/src/intake-client.ts packages/core/src/index.ts
git commit -m "feat(sdk): add intake client and public init/open/close/identify API"
```

---

## Phase 6 — UI widget

### Task 16: Scaffold `packages/ui` + Shadow DOM + Preact

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/package.json`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/tsconfig.json`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/shadow.ts`

- [ ] **Step 1: `packages/ui/package.json`**

```json
{
  "name": "@feedback-tool/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "module": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "dependencies": {
    "@feedback-tool/shared": "workspace:*",
    "preact": "^10.23.0"
  }
}
```

> **Note:** `packages/ui` ships no build output of its own; it's bundled into `@feedback-tool/sdk` by that package's tsdown config. `main`/`exports` point at source so tsdown resolves TypeScript directly.

- [ ] **Step 2: `packages/ui/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "jsx": "react-jsx",
    "jsxImportSource": "preact"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: `packages/ui/src/shadow.ts`**

```ts
// packages/ui/src/shadow.ts
export function createShadowHost(): ShadowRoot {
  let host = document.getElementById("feedback-tool-host")
  if (!host) {
    host = document.createElement("div")
    host.id = "feedback-tool-host"
    document.body.appendChild(host)
  }
  if ((host as HTMLElement).shadowRoot) {
    return (host as HTMLElement).shadowRoot as ShadowRoot
  }
  return (host as HTMLElement).attachShadow({ mode: "open" })
}

export function injectStyles(root: ShadowRoot, css: string) {
  const style = document.createElement("style")
  style.textContent = css
  root.appendChild(style)
}

export function unmountShadowHost() {
  const host = document.getElementById("feedback-tool-host")
  host?.remove()
}
```

- [ ] **Step 4: Install**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun install
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/package.json packages/ui/tsconfig.json packages/ui/src/shadow.ts bun.lock
git commit -m "chore(sdk-ui): scaffold @feedback-tool/ui with Shadow DOM host helper"
```

---

### Task 17: Launcher + Reporter components + styles

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/styles.css`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/launcher.tsx`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/reporter.tsx`

- [ ] **Step 1: `styles.css`**

```css
/* packages/ui/src/styles.css — scoped under the shadow root, no leakage to host */
:host, * { box-sizing: border-box; }
.ft-launcher {
  position: fixed;
  width: 56px; height: 56px;
  border-radius: 999px;
  background: #111; color: #fff;
  border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 24px rgba(0,0,0,.18);
  z-index: 2147483640;
  font-family: system-ui, -apple-system, sans-serif;
}
.ft-launcher:hover { background: #000; }
.ft-launcher.pos-bottom-right { right: 24px; bottom: 24px; }
.ft-launcher.pos-bottom-left  { left: 24px;  bottom: 24px; }
.ft-launcher.pos-top-right    { right: 24px; top: 24px; }
.ft-launcher.pos-top-left     { left: 24px;  top: 24px; }

.ft-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.35);
  display: flex; align-items: center; justify-content: center;
  z-index: 2147483641;
  font-family: system-ui, -apple-system, sans-serif;
}
.ft-modal {
  background: #fff; color: #111;
  width: 440px; max-width: calc(100vw - 32px);
  border-radius: 12px; padding: 20px;
  box-shadow: 0 24px 64px rgba(0,0,0,.3);
}
.ft-modal h2 { margin: 0 0 12px; font-size: 18px; font-weight: 600; }
.ft-field { display: block; margin-bottom: 12px; }
.ft-field > span { display: block; font-size: 12px; color: #666; margin-bottom: 4px; }
.ft-field input, .ft-field textarea {
  width: 100%; padding: 8px 10px;
  border: 1px solid #ddd; border-radius: 6px;
  font: inherit; color: inherit; background: #fff;
}
.ft-field textarea { min-height: 80px; resize: vertical; }
.ft-preview {
  display: block; width: 100%;
  max-height: 160px; object-fit: contain;
  border: 1px solid #eee; border-radius: 6px;
  background: #f7f7f7;
}
.ft-preview.empty {
  height: 80px; display: flex; align-items: center; justify-content: center;
  color: #999; font-size: 12px;
}
.ft-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.ft-btn {
  padding: 8px 14px; border-radius: 6px;
  border: 1px solid #ddd; background: #fff; color: #111;
  cursor: pointer; font: inherit;
}
.ft-btn.primary { background: #111; color: #fff; border-color: #111; }
.ft-btn.primary:hover { background: #000; }
.ft-btn[disabled] { opacity: .5; cursor: not-allowed; }
.ft-msg { font-size: 12px; margin-top: 8px; }
.ft-msg.err { color: #c00; }
.ft-msg.ok  { color: #070; }
```

- [ ] **Step 2: `launcher.tsx`**

```tsx
// packages/ui/src/launcher.tsx
import { h } from "preact"

interface LauncherProps {
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  onClick: () => void
}

export function Launcher({ position, onClick }: LauncherProps) {
  return (
    <button
      class={`ft-launcher pos-${position}`}
      aria-label="Report a bug"
      type="button"
      onClick={onClick}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M8 2l1.5 2h5L16 2" />
        <path d="M9 6h6a3 3 0 013 3v6a6 6 0 01-12 0V9a3 3 0 013-3z" />
        <path d="M6 12h-2M6 8h-2M6 16h-2" />
        <path d="M18 12h2M18 8h2M18 16h2" />
      </svg>
    </button>
  )
}
```

- [ ] **Step 3: `reporter.tsx`**

```tsx
// packages/ui/src/reporter.tsx
import { h } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"

export interface ReporterSubmitResult {
  ok: boolean
  message?: string
}

interface ReporterProps {
  onClose: () => void
  onCapture: () => Promise<Blob | null>
  onSubmit: (payload: { title: string; description: string; screenshot: Blob | null }) => Promise<ReporterSubmitResult>
}

export function Reporter({ onClose, onCapture, onSubmit }: ReporterProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [screenshot, setScreenshot] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
    ;(async () => {
      const blob = await onCapture()
      setScreenshot(blob)
      if (blob) setPreviewUrl(URL.createObjectURL(blob))
    })()
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [])

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    setError(null)
    const res = await onSubmit({ title: title.trim(), description: description.trim(), screenshot })
    setSubmitting(false)
    if (res.ok) {
      setSuccess(true)
      setTimeout(onClose, 1500)
    } else {
      setError(res.message ?? "Something went wrong, please try again.")
    }
  }

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div class="ft-overlay" onClick={handleBackdrop}>
      <form class="ft-modal" onSubmit={handleSubmit} aria-labelledby="ft-title">
        <h2 id="ft-title">Report a bug</h2>
        <label class="ft-field">
          <span>Title</span>
          <input
            ref={titleRef}
            value={title}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
            required
            maxLength={120}
            disabled={submitting || success}
          />
        </label>
        <label class="ft-field">
          <span>What happened?</span>
          <textarea
            value={description}
            onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
            maxLength={10000}
            disabled={submitting || success}
          />
        </label>
        <div class="ft-field">
          <span>Screenshot</span>
          {previewUrl ? (
            <img class="ft-preview" src={previewUrl} alt="screenshot preview" />
          ) : (
            <div class="ft-preview empty">{screenshot === null ? "Capturing…" : "Screenshot unavailable"}</div>
          )}
        </div>
        {error && <div class="ft-msg err">{error}</div>}
        {success && <div class="ft-msg ok">Thanks! Report sent.</div>}
        <div class="ft-actions">
          <button type="button" class="ft-btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" class="ft-btn primary" disabled={submitting || success || !title.trim()}>
            {submitting ? "Sending…" : "Send report"}
          </button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src
git commit -m "feat(sdk-ui): add Launcher and Reporter Preact components with scoped styles"
```

---

### Task 18: UI `mount.ts` + `index.ts` + CSS inline import

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/mount.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/index.ts`

- [ ] **Step 1: Write `mount.ts`**

```ts
// packages/ui/src/mount.ts
import { h, render } from "preact"
import { useState } from "preact/hooks"
import type { ReporterSubmitResult } from "./reporter"
import { Launcher } from "./launcher"
import { Reporter } from "./reporter"
import { createShadowHost, injectStyles, unmountShadowHost } from "./shadow"
// @ts-ignore — tsdown bundles this as a string
import cssText from "./styles.css" with { type: "text" }

export interface MountOptions {
  config: {
    position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
    launcher: boolean
  }
  onSubmit: (payload: { title: string; description: string }) => Promise<ReporterSubmitResult & { id?: string }>
}

let _setOpenExternal: ((v: boolean) => void) | null = null

function App({ config, onSubmit, capture }: MountOptions & { capture: () => Promise<Blob | null> }) {
  const [isOpen, setOpen] = useState(false)
  _setOpenExternal = setOpen
  return h("div", null, [
    config.launcher ? h(Launcher, { position: config.position, onClick: () => setOpen(true) }) : null,
    isOpen
      ? h(Reporter, {
          onClose: () => setOpen(false),
          onCapture: capture,
          onSubmit: async (payload) => {
            const result = await onSubmit(payload)
            return { ok: result.ok, message: result.message }
          },
        } as never)
      : null,
  ])
}

let _capture: (() => Promise<Blob | null>) = async () => null
let _mountedRoot: ShadowRoot | null = null

export function mount(opts: MountOptions & { capture?: () => Promise<Blob | null> }) {
  _mountedRoot = createShadowHost()
  injectStyles(_mountedRoot, cssText as unknown as string)
  if (opts.capture) _capture = opts.capture
  const container = document.createElement("div")
  _mountedRoot.appendChild(container)
  render(h(App, { ...opts, capture: _capture } as never), container)
}

export function open() {
  _setOpenExternal?.(true)
}
export function close() {
  _setOpenExternal?.(false)
}
export function unmount() {
  if (_mountedRoot) render(null as never, _mountedRoot as unknown as Element)
  unmountShadowHost()
  _mountedRoot = null
  _setOpenExternal = null
}
```

- [ ] **Step 2: Write `index.ts`**

```ts
// packages/ui/src/index.ts
export { mount, open, close, unmount } from "./mount"
```

- [ ] **Step 3: Update `packages/core` to pass capture through**

Edit `packages/core/src/index.ts` `init()` — the `mount()` call needs `capture`:

Replace the `mount(...)` call with:

```ts
  mount({
    config: { position: cfg.position, launcher: cfg.launcher },
    capture,
    onSubmit: async ({ title, description }) => {
      if (!_config) return { ok: false, message: "Not initialized" }
      const screenshot = await capture()
      const context = gatherContext(_reporter, _config.metadata)
      const result = await postReport(_config, {
        title,
        description,
        context,
        metadata: _config.metadata,
        screenshot,
      })
      return result.ok ? { ok: true } : { ok: false, message: result.message }
    },
  })
```

- [ ] **Step 4: Add CSS-as-text loader config to tsdown**

Edit `packages/core/tsdown.config.ts` — add `loader: { ".css": "text" }` to both entries:

```ts
import { defineConfig } from "tsdown"

const common = {
  platform: "browser",
  target: "es2020",
  loader: { ".css": "text" as const },
}

export default defineConfig([
  { ...common, entry: { index: "src/index.ts" }, format: ["esm"], outDir: "dist", dts: true },
  {
    ...common,
    entry: { "feedback-tool.iife": "src/index.ts" },
    format: ["iife"],
    outDir: "dist",
    minify: true,
    globalName: "FeedbackTool",
  },
])
```

- [ ] **Step 5: Build and verify**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun --filter @feedback-tool/sdk build
ls packages/core/dist/
```
Expected: `index.mjs`, `index.d.ts`, `feedback-tool.iife.js`. The IIFE file should be well under 100 kB (aim: <60 kB gzipped, check with `gzip -c packages/core/dist/feedback-tool.iife.js | wc -c`).

- [ ] **Step 6: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src packages/core
git commit -m "feat(sdk-ui): wire mount/open/close, inline CSS as text, rebuild produces IIFE"
```

---

## Phase 7 — Demo playground + root scripts

### Task 19: Demo HTML + Bun.serve + root scripts

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/demo/index.html`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/demo/serve.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/package.json` (add `demo` script)
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/package.json` (add root `sdk:build`, `sdk:watch`, `demo`)

- [ ] **Step 1: Create `packages/ui/demo/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Feedback Tool — Demo Playground</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #fafafa; color: #111; }
    header { padding: 40px; background: #111; color: #fff; }
    header h1 { margin: 0 0 8px; }
    header p { margin: 0; opacity: .7; }
    main { padding: 32px; max-width: 960px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    .card { background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
    .card h3 { margin: 0 0 8px; font-size: 15px; }
    .card p { margin: 0 0 12px; font-size: 14px; color: #555; }
    .broken-btn { background: #d32f2f; color: #fff; border: 0; padding: 10px 16px; border-radius: 6px; cursor: pointer; }
    form.card label { display: block; margin-bottom: 8px; font-size: 13px; }
    form.card input { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
  </style>
</head>
<body>
  <header>
    <h1>Demo page</h1>
    <p>A deliberately rough page for testing the Feedback Tool SDK. Click the bubble in the corner to report a bug.</p>
  </header>
  <main>
    <section class="card">
      <h3>Click this broken button</h3>
      <p>It doesn't do what you'd expect.</p>
      <button class="broken-btn" onclick="throw new Error('intentional demo error')">Save changes</button>
    </section>

    <section class="card">
      <h3>Follow a dead link</h3>
      <p>This should go somewhere but it 404s.</p>
      <p><a href="/does-not-exist">Learn more →</a></p>
    </section>

    <form class="card">
      <h3>Fill out a form</h3>
      <label>Email<input type="email" placeholder="you@example.com" /></label>
      <label>Name<input type="text" placeholder="Your name" /></label>
      <button type="submit" class="broken-btn">Submit</button>
    </form>

    <section class="card">
      <h3>Check the console</h3>
      <p>Open DevTools — this page logs a noisy warning every 2 seconds.</p>
    </section>
  </main>

  <script>
    setInterval(() => console.warn("[demo] intentionally noisy log"), 2000)
  </script>

  <!-- Load the SDK (served by Bun at /sdk.iife.js) -->
  <script src="/sdk.iife.js"></script>
  <script>
    // Edit this to match your project
    const PROJECT_KEY = window.FT_DEMO_KEY || "ft_pk_REPLACE_ME_REPLACE_ME_REP"
    const ENDPOINT = "http://localhost:3000"

    if (/^ft_pk_[A-Za-z0-9]{24}$/.test(PROJECT_KEY)) {
      FeedbackTool.init({ projectKey: PROJECT_KEY, endpoint: ENDPOINT })
      FeedbackTool.identify({ email: "demo-user@example.com", name: "Demo User" })
    } else {
      console.error("[demo] set PROJECT_KEY in index.html or window.FT_DEMO_KEY before FeedbackTool.init")
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Create `packages/ui/demo/serve.ts`**

```ts
// packages/ui/demo/serve.ts
import { readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const sdkIife = join(repoRoot, "packages", "core", "dist", "feedback-tool.iife.js")
const indexHtml = join(here, "index.html")

Bun.serve({
  port: 4000,
  hostname: "localhost",
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const body = await readFile(indexHtml, "utf8")
      return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    }
    if (url.pathname === "/sdk.iife.js") {
      try {
        const body = await readFile(sdkIife)
        return new Response(body, { headers: { "Content-Type": "application/javascript" } })
      } catch {
        return new Response(
          "// Build the SDK first: bun run sdk:build\n",
          { status: 503, headers: { "Content-Type": "application/javascript" } },
        )
      }
    }
    return new Response("Not found", { status: 404 })
  },
})

console.info("Feedback Tool demo playground: http://localhost:4000")
```

- [ ] **Step 3: Add demo script to `packages/ui/package.json`**

Merge this into the existing package.json:

```json
"scripts": {
  "demo": "bun run demo/serve.ts"
}
```

- [ ] **Step 4: Add root scripts**

Edit `/Users/jiajingteoh/Documents/feedback-tool/package.json`, merge into existing scripts:

```jsonc
"sdk:build":  "bun --filter @feedback-tool/sdk build",
"sdk:watch":  "bun --filter @feedback-tool/sdk dev",
"demo":       "bun run sdk:build && bun --filter @feedback-tool/ui demo"
```

- [ ] **Step 5: Test the playground boot**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run sdk:build
lsof -ti:4000 | xargs -r kill -9 2>/dev/null
bun --filter @feedback-tool/ui demo &
PID=$!
sleep 3
curl -s http://localhost:4000/ | grep -o "Feedback Tool — Demo Playground" | head -1
curl -sI http://localhost:4000/sdk.iife.js | head -1
kill $PID 2>/dev/null
wait $PID 2>/dev/null
lsof -ti:4000 | xargs -r kill -9 2>/dev/null
```
Expected: HTML title matches and `/sdk.iife.js` returns 200.

- [ ] **Step 6: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/demo packages/ui/package.json package.json
git commit -m "feat(sdk-ui): add demo playground served by Bun on :4000"
```

---

## Phase 8 — Verification

### Task 20: End-to-end manual smoke + tag

**Files:** none (verification pass).

- [ ] **Step 1: Fresh state**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000,4000 | xargs -r kill -9 2>/dev/null
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE"
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "UPDATE app_settings SET signup_gated = false WHERE id = 1"
rm -rf apps/dashboard/.data/attachments
```

- [ ] **Step 2: Start dashboard**

```bash
bun run dev
```
(Leave running in one terminal.)

- [ ] **Step 3: Admin + project setup via browser**

1. Sign up at `http://localhost:3000/auth/sign-up` as `admin@example.com` / `Password123!`.
2. Click the Ethereal preview URL from the terminal, verify email, land on `/`.
3. Create a project named "Demo".
4. Navigate to Settings → copy the `publicKey` (e.g. `ft_pk_...`). Paste `http://localhost:4000` into the Allowed origins textarea. Save.

- [ ] **Step 4: Start demo playground**

In a second terminal:

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
FT_DEMO_KEY="<paste-the-project-key-here>" bun run demo
```

Alternative: edit `packages/ui/demo/index.html` to hard-code `const PROJECT_KEY = "ft_pk_..."`.

- [ ] **Step 5: Report a bug**

1. Open `http://localhost:4000`.
2. A dark round launcher appears bottom-right. Click it.
3. The reporter modal opens. A screenshot preview appears within ~1 s.
4. Fill in title "Broken save button", description "Clicking Save does nothing."
5. Click **Send report**. The modal shows "Thanks! Report sent." and auto-closes.

- [ ] **Step 6: Verify in the dashboard**

1. In the first browser, navigate to the Demo project → **Reports** tab.
2. The new report appears in the list with a 40×40 thumbnail, title, reporter email, page URL (`http://localhost:4000/`), and received-at.
3. Click the row → drawer opens with the full screenshot, reporter, page URL (linked), received time, and a collapsible Raw context JSON blob.

- [ ] **Step 7: Run the test matrix**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run check
bun test
```
Expected: no errors. All unit + integration tests pass (23 prior + new ones from Tasks 1, 4, 5, 7, 8, 9, 12, 13, 14).

- [ ] **Step 8: Tag the release**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git tag -a v0.2.0-sdk -m "Sub-project B complete: SDK core + minimal reporter

Framework-agnostic SDK (Preact + Shadow DOM, ~TBD kB gzipped IIFE) with
feedback.init/open/close/identify. Viewport screenshot via modern-screenshot.
Multipart intake with CORS, per-key + per-IP rate limiting, 5 MB cap,
origin allowlist. Reports table + attachments with local-disk storage
adapter. Dashboard viewer at /projects/:id/reports with list + detail drawer.
Demo playground on :4000 via Bun.serve."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
| --- | --- |
| §3 repo layout + distribution | Task 11 (core scaffold), Task 16 (ui scaffold), Task 18 (IIFE/ESM emit) |
| §4.1 projects extensions | Task 2 |
| §4.2 reports | Task 2 |
| §4.3 report_attachments | Task 2 |
| §4.4 context JSONB shape | Task 3 (Zod), Task 13 (gathering) |
| §4.5 invariants | Tasks 7, 9 (transactional insert + cross-project guard) |
| §5 Public API (init/open/close/identify) | Tasks 12, 15 |
| §6.1 config resolution | Task 12 |
| §6.2 widget mount | Tasks 16, 17, 18 |
| §6.3 screenshot | Task 14 |
| §6.4 intake client | Task 15 |
| §6.5 context gathering | Task 13 |
| §7.1 POST /api/intake/reports pipeline | Task 7 |
| §7.2 StorageAdapter (Local + S3 stub) | Task 4 |
| §7.3 rate limiter | Task 5 |
| §7.4 env vars | Task 7 step 1 |
| §8.1 reports page | Task 10 |
| §8.2 list + attachment endpoints | Tasks 8, 9 |
| §8.3 shared DTOs | Task 3 |
| §9 demo playground | Task 19 |
| §10 unit + integration tests | Tasks 1, 4, 5, 7, 8, 9, 12, 13, 14 |
| §11 definition of done | Task 20 |

**Placeholder scan:** No "TBD", "implement later", or silent steps. Task 20 step 8's commit message says "TBD kB gzipped" intentionally — fill in the real number from the `gzip -c` check in Task 18 step 5 before tagging.

**Type consistency:** `ProjectRoleName` / `ProjectRole` / `AttachmentKind` / `ReportContext` / `ReportIntakeInput` / `ReportSummaryDTO` / `ReporterIdentity` / `InitOptions` / `ResolvedConfig` — names match across Tasks 3, 7, 8, 10, 12, 13, 14, 15, 17. `StorageAdapter.put / get / delete` signatures match between Tasks 4, 7, 9. The `onSubmit` contract between `packages/core/src/index.ts` (Task 15) and `packages/ui/src/mount.ts` (Task 18) is the same `(title, description) → { ok, message }` in both.

**One gap fixed inline during review:** Task 18 originally didn't pass `capture` through to `mount()`; the mount signature in Task 17 expected an `onCapture` on `<Reporter>` but mount had no way to wire it. Fixed in Task 18 step 3 by adding `capture` to `MountOptions` and threading it through `App` → `Reporter.onCapture`.
