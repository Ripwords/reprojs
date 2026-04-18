# Intake Anti-Abuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the public intake endpoint with four layered, zero-external-dep defenses (honeypot, min-dwell, daily ceiling, tiered anon rate limit).

**Architecture:** SDK adds two hidden signals (`_hp`, `_dwellMs`) to every submitted report; intake endpoint validates them as inexpensive early rejections before expensive DB writes. New `projects.daily_report_cap` column gates total volume per project per 24h. Rate limiter gets a second, stricter bucket for anonymous submissions (no `reporter.userId`).

**Tech Stack:** Nuxt 4 (Nitro server), Drizzle ORM + Postgres, Preact (SDK widget in Shadow DOM), Zod (boundary validation), Bun test.

**Spec:** [docs/superpowers/specs/2026-04-18-intake-anti-abuse-design.md](../specs/2026-04-18-intake-anti-abuse-design.md)

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `packages/shared/src/reports.ts` | MODIFY | Extend `ReportIntakeInput` Zod with `_hp`, `_dwellMs` (both optional) |
| `packages/shared/src/projects.ts` | MODIFY | Add `dailyReportCap` to `ProjectDTO` and `UpdateProjectInput` |
| `apps/dashboard/server/db/schema/projects.ts` | MODIFY | Add `dailyReportCap integer not null default 1000` |
| `apps/dashboard/server/db/migrations/0007_*.sql` | CREATE (via drizzle-kit) | Committed migration for prod |
| `apps/dashboard/server/api/projects/[id]/index.get.ts` | MODIFY | Return `dailyReportCap` in response |
| `apps/dashboard/server/api/projects/[id]/index.patch.ts` | MODIFY | Accept + persist `dailyReportCap` + return it |
| `apps/dashboard/app/pages/projects/[id]/settings.vue` | MODIFY | Add "Daily report limit" number input |
| `apps/dashboard/server/lib/rate-limit.ts` | MODIFY | Add `getAnonKeyLimiter()` with separate bucket + env |
| `apps/dashboard/server/api/intake/reports.ts` | MODIFY | Add all four checks in the correct order |
| `apps/dashboard/tests/api/intake.test.ts` | MODIFY | Integration tests for each defense |
| `packages/core/src/intake-client.ts` | MODIFY | Accept + serialize `dwellMs` and `honeypot` in wire JSON |
| `packages/core/src/index.ts` | MODIFY | Plumb `dwellMs` + `honeypot` from UI callback to intake-client |
| `packages/ui/src/mount.ts` | MODIFY | Record `openedAt` on open; expose to `onSubmit` callback |
| `packages/ui/src/wizard/step-describe.tsx` | MODIFY | Render hidden honeypot input; include its value in submit |

No new packages. No new top-level files except the generated migration.

---

## Task 1: Extend Zod schemas for intake wire + project DTO

**Files:**
- Modify: `packages/shared/src/reports.ts:163-169`
- Modify: `packages/shared/src/projects.ts:6-34`

- [ ] **Step 1: Extend `ReportIntakeInput` in shared**

Replace the existing block at `packages/shared/src/reports.ts:163-170`:

```ts
export const ReportIntakeInput = z.object({
  projectKey: z.string().regex(/^ft_pk_[A-Za-z0-9]{24}$/),
  title: z.string().min(1).max(120),
  description: z.string().max(10_000).optional(),
  context: ReportContext,
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  // Anti-abuse: honeypot (hidden field that real users never fill) and
  // dwell time in ms between widget open and submit.
  _hp: z.string().max(200).optional(),
  _dwellMs: z.number().int().min(0).max(86_400_000).optional(),
})
export type ReportIntakeInput = z.infer<typeof ReportIntakeInput>
```

- [ ] **Step 2: Extend `ProjectDTO` and `UpdateProjectInput` in shared**

In `packages/shared/src/projects.ts`, add `dailyReportCap` to both schemas. Find `export const ProjectDTO = z.object({` and add inside the object before the closing brace:

```ts
  dailyReportCap: z.number().int().min(1).max(1_000_000),
```

Find `export const UpdateProjectInput = z.object({` and add:

```ts
  dailyReportCap: z.number().int().min(1).max(1_000_000).optional(),
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/reports.ts packages/shared/src/projects.ts
git commit -m "feat(shared): anti-abuse fields on intake + daily cap on projects"
```

---

## Task 2: Add `daily_report_cap` column + migration

**Files:**
- Modify: `apps/dashboard/server/db/schema/projects.ts`
- Create: `apps/dashboard/server/db/migrations/0007_<adjective>_<noun>.sql` (via drizzle-kit)

- [ ] **Step 1: Add the column to the schema**

In `apps/dashboard/server/db/schema/projects.ts`, inside the `pgTable("projects", { ... })` object, add after `allowedOrigins`:

```ts
    dailyReportCap: integer("daily_report_cap").notNull().default(1000),
```

Also ensure `integer` is imported from `drizzle-orm/pg-core` at the top of the file (it may already be). If missing, append `integer` to the existing import list.

- [ ] **Step 2: Generate the migration (interactive)**

Run from the repo root:

```bash
bun run db:gen
```

drizzle-kit will print the diff ("+ daily_report_cap column") and exit without prompting because a NOT NULL column with a DEFAULT is non-destructive. A new file `server/db/migrations/0007_<adjective>_<noun>.sql` will be written containing:

```sql
ALTER TABLE "projects" ADD COLUMN "daily_report_cap" integer DEFAULT 1000 NOT NULL;
```

Expected: one new file in `apps/dashboard/server/db/migrations/` and an updated `meta/_journal.json` + new `meta/0007_snapshot.json`.

- [ ] **Step 3: Apply to local dev DB**

```bash
bun run db:push --force
```

If drizzle-kit requires a TTY, apply the DDL directly via docker:

```bash
PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$PG" psql -U postgres -d feedback_tool -c "ALTER TABLE projects ADD COLUMN IF NOT EXISTS daily_report_cap integer NOT NULL DEFAULT 1000"
```

- [ ] **Step 4: Verify**

```bash
docker exec "$PG" psql -U postgres -d feedback_tool -c "\d projects" | grep daily_report_cap
```

Expected output includes `daily_report_cap | integer | | not null | 1000`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/db/schema/projects.ts apps/dashboard/server/db/migrations/
git commit -m "feat(db): projects.daily_report_cap (migration 0007)"
```

---

## Task 3: Project API surfaces and accepts `dailyReportCap`

**Files:**
- Modify: `apps/dashboard/server/api/projects/[id]/index.get.ts`
- Modify: `apps/dashboard/server/api/projects/[id]/index.patch.ts`
- Modify: `apps/dashboard/server/api/projects/index.get.ts`
- Modify: `apps/dashboard/server/api/projects/index.post.ts`

- [ ] **Step 1: Include `dailyReportCap` in GET /api/projects/:id response**

In `apps/dashboard/server/api/projects/[id]/index.get.ts`, inside the returned object (currently ends with `allowedOrigins: p.allowedOrigins,`), add:

```ts
    dailyReportCap: p.dailyReportCap,
```

- [ ] **Step 2: Include in PATCH response**

In `apps/dashboard/server/api/projects/[id]/index.patch.ts`, add the same line inside the returned object. The `...body` spread in the UPDATE already persists `dailyReportCap` when present in the request body (since we extended `UpdateProjectInput` in Task 1), so no SET-clause changes needed.

- [ ] **Step 3: Include in GET /api/projects (list) — admin and member paths**

In `apps/dashboard/server/api/projects/index.get.ts`, both `.map` callbacks return shaped objects. Add `dailyReportCap: r.dailyReportCap,` to each — note the member path selects explicit columns, so also add it there:

Find the `.select({` block and add `dailyReportCap: projects.dailyReportCap,` inside.

- [ ] **Step 4: Include in POST /api/projects response**

In `apps/dashboard/server/api/projects/index.post.ts`, add `dailyReportCap: created.dailyReportCap,` to the returned object.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/api/projects/
git commit -m "feat(api): expose and accept projects.dailyReportCap"
```

---

## Task 4: Settings UI — daily cap input

**Files:**
- Modify: `apps/dashboard/app/pages/projects/[id]/settings.vue`

- [ ] **Step 1: Add daily-cap ref and wire to save()**

In the `<script setup>` of `settings.vue`, add alongside the existing `name` and `originsText` refs:

```ts
const dailyReportCap = ref(project.value?.dailyReportCap ?? 1000)
```

In `save()`, extend the `body:` object passed to `$fetch` to include the new field:

```ts
      body: { name: name.value, allowedOrigins, dailyReportCap: dailyReportCap.value },
```

- [ ] **Step 2: Add the input in the template**

Immediately after the "Allowed origins" textarea `<label>` block, add:

```vue
        <label class="block">
          <span class="text-sm">
            Daily report limit
            <span class="text-neutral-500">
              (hard cap on reports created per 24h; protects against runaway spam)
            </span>
          </span>
          <input
            v-model.number="dailyReportCap"
            type="number"
            min="1"
            max="1000000"
            class="w-full border rounded px-3 py-2"
          />
        </label>
```

- [ ] **Step 3: Smoke-test in the browser**

Start dev server if not running:

```bash
bun run dev
```

Visit `http://localhost:3000/projects/<some-id>/settings`. Confirm the new input appears with the current value (default 1000) and saves without error.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/pages/projects/\[id\]/settings.vue
git commit -m "feat(ui): daily report limit input in project settings"
```

---

## Task 5: Intake — min-dwell check (TDD)

**Files:**
- Modify: `apps/dashboard/tests/api/intake.test.ts`
- Modify: `apps/dashboard/server/api/intake/reports.ts`

- [ ] **Step 1: Write the failing test**

In `apps/dashboard/tests/api/intake.test.ts`, inside the existing `describe("intake API")` block, add a new test after the existing ones. Also add `_dwellMs` and `_hp` as optional fields in `buildReportJSON` so tests can set them:

Replace `buildReportJSON` near the top of the file:

```ts
function buildReportJSON(
  projectKey: string,
  extra: Partial<{ title: string; _dwellMs: number; _hp: string }> = {},
) {
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
    ...(extra._dwellMs !== undefined ? { _dwellMs: extra._dwellMs } : {}),
    ...(extra._hp !== undefined ? { _hp: extra._hp } : {}),
  })
}
```

Then add:

```ts
  test("rejects submissions with dwell < 1500ms", async () => {
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
      body: buildMultipart(buildReportJSON(PK, { _dwellMs: 300 }), makePngBlob()),
    })
    expect(res.status).toBe(400)
  })
```

- [ ] **Step 2: Run and confirm it fails**

```bash
cd apps/dashboard && bun test ./tests/api/intake.test.ts
```

Expected: new test fails with `expect(res.status).toBe(400) // received 201`.

- [ ] **Step 3: Implement the check**

In `apps/dashboard/server/api/intake/reports.ts`, find the block that parses `parsed` from the Zod schema. Immediately after `parsed = ReportIntakeInput.parse(JSON.parse(...))`, add:

```ts
  const MIN_DWELL_MS = Number(process.env.INTAKE_MIN_DWELL_MS ?? 1500)
  if (parsed._dwellMs !== undefined && parsed._dwellMs < MIN_DWELL_MS) {
    throw createError({ statusCode: 400, statusMessage: "Submission too fast" })
  }
```

- [ ] **Step 4: Run and confirm it passes**

```bash
bun test ./tests/api/intake.test.ts
```

Expected: all intake tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/api/intake/reports.ts apps/dashboard/tests/api/intake.test.ts
git commit -m "feat(intake): reject submissions with dwell time below 1.5s"
```

---

## Task 6: Intake — honeypot tarpit (TDD)

**Files:**
- Modify: `apps/dashboard/tests/api/intake.test.ts`
- Modify: `apps/dashboard/server/api/intake/reports.ts`

- [ ] **Step 1: Write the failing test**

Append to the `describe("intake API")` block:

```ts
  test("honeypot: non-empty _hp returns fake 201 and does not persist", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK, { _hp: "i-am-a-bot" }), makePngBlob()),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/)
    // Assert NO row was written
    const rows = await db
      .select()
      .from(reports)
      .where(sql`project_id = ${projectId}`)
    expect(rows.length).toBe(0)
  })
```

- [ ] **Step 2: Run and confirm it fails**

```bash
bun test ./tests/api/intake.test.ts
```

Expected: fails with `expect(rows.length).toBe(0) // received 1` (honeypot is currently ignored, so a report was inserted).

- [ ] **Step 3: Implement the check**

In `apps/dashboard/server/api/intake/reports.ts`, import `randomUUID` at the top:

```ts
import { randomUUID } from "node:crypto"
```

Then find the block immediately AFTER the `isOriginAllowed` check and BEFORE the rate limiter `take()` calls. Insert a new block. Actually the honeypot check must run AFTER rate limiting (so we still throttle abusive IPs/keys — don't give them a free pass) but BEFORE any DB writes. Insert it right before the `const logsPart = parts.find(...)` line (i.e., after both rate-limit takes):

```ts
  if (parsed._hp && parsed._hp.length > 0) {
    // Tarpit: look successful to the attacker so they don't switch tactics.
    // Fake UUID, no DB write, no enqueue.
    event.node.res.statusCode = 201
    return { id: randomUUID() }
  }
```

- [ ] **Step 4: Run and confirm it passes**

```bash
bun test ./tests/api/intake.test.ts
```

Expected: all tests pass. Two earlier tests (`rejects wrong origin`, `rejects bad project key`) should still pass because the honeypot check runs AFTER those.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/api/intake/reports.ts apps/dashboard/tests/api/intake.test.ts
git commit -m "feat(intake): honeypot tarpit — fake 201, no persist"
```

---

## Task 7: Intake — daily ceiling check (TDD)

**Files:**
- Modify: `apps/dashboard/tests/api/intake.test.ts`
- Modify: `apps/dashboard/server/api/intake/reports.ts`

- [ ] **Step 1: Write the failing test**

Append to the `describe("intake API")` block:

```ts
  test("daily ceiling: rejects when cap already met", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    // Lower the cap to something testable
    await db
      .update(projects)
      .set({ dailyReportCap: 1 })
      .where(sql`id = ${projectId}`)

    // First submission — allowed
    const r1 = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(r1.status).toBe(201)

    // Second submission — at cap, rejected
    const r2 = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK), makePngBlob()),
    })
    expect(r2.status).toBe(429)
    expect(r2.headers.get("retry-after")).toBe("3600")
  })
```

Add `projects` to the existing schema import at the top of intake.test.ts (currently `import { reports, reportAttachments } from "..."`). Update to:

```ts
import { projects, reports, reportAttachments } from "../../server/db/schema"
```

- [ ] **Step 2: Run and confirm it fails**

```bash
bun test ./tests/api/intake.test.ts
```

Expected: fails with `expect(r2.status).toBe(429) // received 201`.

- [ ] **Step 3: Implement the check**

In `apps/dashboard/server/api/intake/reports.ts`, add `gte, and, count` to the drizzle-orm import (you may already have `eq`). Change:

```ts
import { eq } from "drizzle-orm"
```

to:

```ts
import { and, count, eq, gte } from "drizzle-orm"
```

Find the block AFTER the rate limiter `take()` calls and BEFORE the honeypot check (added in Task 6). Insert:

```ts
  // Daily ceiling — absolute max per project per 24h. Cheap count query
  // backed by the (project_id, created_at) index.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [{ c: todayCount }] = await db
    .select({ c: count() })
    .from(reports)
    .where(and(eq(reports.projectId, project.id), gte(reports.createdAt, dayAgo)))
  if (todayCount >= project.dailyReportCap) {
    event.node.res.setHeader("Retry-After", "3600")
    throw createError({ statusCode: 429, statusMessage: "Daily report cap reached" })
  }
```

- [ ] **Step 4: Run and confirm it passes**

```bash
bun test ./tests/api/intake.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/api/intake/reports.ts apps/dashboard/tests/api/intake.test.ts
git commit -m "feat(intake): per-project daily report ceiling"
```

---

## Task 8: Intake — tiered anonymous rate limit (TDD)

**Files:**
- Modify: `apps/dashboard/server/lib/rate-limit.ts`
- Modify: `apps/dashboard/server/api/intake/reports.ts`
- Modify: `apps/dashboard/tests/api/intake.test.ts`

- [ ] **Step 1: Add `getAnonKeyLimiter()` to rate-limit.ts**

Open `apps/dashboard/server/lib/rate-limit.ts`. Add a third module-level singleton and factory alongside the existing two. Find the declaration:

```ts
let _keyLimiter: RateLimiter | null = null
let _ipLimiter: RateLimiter | null = null
```

Change to:

```ts
let _keyLimiter: RateLimiter | null = null
let _anonKeyLimiter: RateLimiter | null = null
let _ipLimiter: RateLimiter | null = null
```

Then add a new exported function after `getIpLimiter()`:

```ts
export async function getAnonKeyLimiter(): Promise<RateLimiter> {
  if (!_anonKeyLimiter) {
    _anonKeyLimiter = await buildLimiter(Number(process.env.INTAKE_RATE_PER_KEY_ANON ?? 10))
  }
  return _anonKeyLimiter
}
```

- [ ] **Step 2: Wire intake to pick the limiter tier**

In `apps/dashboard/server/api/intake/reports.ts`, update the import:

```ts
import { getAnonKeyLimiter, getIpLimiter, getKeyLimiter } from "../../lib/rate-limit"
```

Replace the existing `const keyTake = await (await getKeyLimiter()).take(...)` block with:

```ts
  const isAnon = !parsed.context.reporter?.userId
  const keyLimiter = await (isAnon ? getAnonKeyLimiter() : getKeyLimiter())
  const keyTake = await keyLimiter.take(`${isAnon ? "anon" : "key"}:${project.id}`)
  if (!keyTake.allowed) {
    event.node.res.setHeader("Retry-After", Math.ceil(keyTake.retryAfterMs / 1000).toString())
    throw createError({ statusCode: 429, statusMessage: "Too many reports for this project" })
  }
```

(IP limiter block stays unchanged below.)

- [ ] **Step 3: Write the failing test**

Append to `intake.test.ts`. First extend `buildReportJSON` further so tests can explicitly set a userId in the reporter (which it already does via `reporter: { email: ... }` — but we need `userId` for the authed path):

Change `buildReportJSON` reporter line from `reporter: { email: "user@example.com" }` to conditionally include userId based on an extra flag. Update:

```ts
function buildReportJSON(
  projectKey: string,
  extra: Partial<{
    title: string
    _dwellMs: number
    _hp: string
    reporterUserId: string | null
  }> = {},
) {
  const reporter =
    extra.reporterUserId === null
      ? undefined
      : extra.reporterUserId
        ? { userId: extra.reporterUserId, email: "user@example.com" }
        : { email: "user@example.com" }
  return JSON.stringify({
    projectKey,
    title: extra.title ?? "It broke",
    description: "Clicking the Save button did nothing.",
    context: {
      pageUrl: "http://localhost:4000/app",
      userAgent: "Mozilla/5.0 Test",
      viewport: { w: 1440, h: 900 },
      timestamp: new Date().toISOString(),
      ...(reporter ? { reporter } : {}),
    },
    ...(extra._dwellMs !== undefined ? { _dwellMs: extra._dwellMs } : {}),
    ...(extra._hp !== undefined ? { _hp: extra._hp } : {}),
  })
}
```

Add the test:

```ts
  test("tiered rate limit: anonymous stricter than authenticated", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })

    // Set anon limit to 2/min for deterministic testing
    process.env.INTAKE_RATE_PER_KEY_ANON = "2"

    // Fire 3 anonymous submissions — third should 429
    for (let i = 0; i < 2; i++) {
      const r = await fetch("http://localhost:3000/api/intake/reports", {
        method: "POST",
        headers: { Origin: ORIGIN },
        body: buildMultipart(buildReportJSON(PK, { reporterUserId: null }), makePngBlob()),
      })
      expect(r.status).toBe(201)
    }
    const r3 = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(buildReportJSON(PK, { reporterUserId: null }), makePngBlob()),
    })
    expect(r3.status).toBe(429)

    // An authenticated submission still goes through (uses the 60/min bucket)
    const authed = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildMultipart(
        buildReportJSON(PK, { reporterUserId: "user_1" }),
        makePngBlob(),
      ),
    })
    expect(authed.status).toBe(201)
  })
```

Note: because the intake test file runs under `@nuxt/test-utils`, the env var set in the test only takes effect on the NEXT module load of `rate-limit.ts`. The simpler assertion is: just verify anon gets rate-limited at some threshold. The test above writes `INTAKE_RATE_PER_KEY_ANON=2` before spinning up the limiter. Since the test file is imported once and `_anonKeyLimiter` is memoized, the set must happen before any anon request. The code above sets it inside the test AFTER `setup()` already ran — this works because `getAnonKeyLimiter` reads the env the FIRST time it is invoked, which is inside this test.

If this proves flaky across runs (env leaks across tests), move the `process.env.INTAKE_RATE_PER_KEY_ANON = "2"` to a module-level assignment near the top of the test file BEFORE `setup()`.

- [ ] **Step 4: Run and confirm it fails**

```bash
bun test ./tests/api/intake.test.ts
```

Expected before the implementation: all anon submissions succeed (no tiered bucket yet), so the test fails at `expect(r3.status).toBe(429)`.

After the implementation in Step 2 above, the test should pass on re-run.

- [ ] **Step 5: Run and confirm it passes**

```bash
bun test ./tests/api/intake.test.ts
```

Expected: all 8 intake tests pass (4 original + 4 anti-abuse).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/server/lib/rate-limit.ts apps/dashboard/server/api/intake/reports.ts apps/dashboard/tests/api/intake.test.ts
git commit -m "feat(intake): tiered rate limit — stricter for anonymous submissions"
```

---

## Task 9: SDK — honeypot input + dwell tracking

**Files:**
- Modify: `packages/ui/src/mount.ts`
- Modify: `packages/ui/src/reporter.tsx`
- Modify: `packages/ui/src/wizard/step-describe.tsx`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/intake-client.ts`

- [ ] **Step 1: Extend IntakeInput in intake-client**

In `packages/core/src/intake-client.ts`, extend `IntakeInput`:

```ts
export interface IntakeInput {
  title: string
  description: string
  context: ReportContext
  metadata?: Record<string, string | number | boolean>
  screenshot: Blob | null
  logs?: LogsAttachment | null
  dwellMs?: number
  honeypot?: string
}
```

In `postReport`, update the JSON.stringify block to serialize the new fields using the wire name `_dwellMs` and `_hp`:

```ts
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
          ...(input.dwellMs !== undefined ? { _dwellMs: input.dwellMs } : {}),
          ...(input.honeypot !== undefined ? { _hp: input.honeypot } : {}),
        }),
      ],
      { type: "application/json" },
    ),
  )
```

- [ ] **Step 2: Track open time in the widget**

In `packages/ui/src/mount.ts`, find `MountOptions.onSubmit` definition. Extend the payload type to include `dwellMs` and `honeypot`:

```ts
  onSubmit: (payload: {
    title: string
    description: string
    dwellMs: number
    honeypot: string
  }) => Promise<ReporterSubmitResult>
```

In the mount.ts module, keep a module-level `let _openedAt = 0`. When the widget opens (the `open()` exported function), set `_openedAt = performance.now()`. Expose `_openedAt` via a getter passed into `<Reporter>`.

Locate the `open()` function in `mount.ts` (or wherever the widget mount happens). Add at the top of that function:

```ts
let _openedAt = 0
```

And inside the open handler:

```ts
_openedAt = performance.now()
```

- [ ] **Step 3: Collect honeypot value and compute dwell in step-describe.tsx**

In `packages/ui/src/wizard/step-describe.tsx`, the form submission already wraps title/description. Extend it to include the hidden honeypot input and pass dwell time to `onSubmit`. Near the top of the component, read `openedAt` from props or from a module-level accessor imported from `mount.ts`. Add a `const hpRef = useRef<HTMLInputElement>(null)`.

In the form, immediately after the description textarea, add:

```tsx
        <input
          ref={hpRef}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-9999px",
            top: "-9999px",
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
```

Update the existing submit handler. Find `const res = await onSubmit({ title: title.trim(), description: description.trim() })` and change it to:

```tsx
    const res = await onSubmit({
      title: title.trim(),
      description: description.trim(),
      dwellMs: Math.max(0, Math.round(performance.now() - openedAt)),
      honeypot: hpRef.current?.value ?? "",
    })
```

You will need to thread `openedAt` from `mount.ts` through to `step-describe.tsx`. The cleanest way: add an `openedAt: number` prop on `Reporter` → forward to `StepDescribe`. Update the Props interfaces in `reporter.tsx` and `step-describe.tsx` to include `openedAt: number`.

- [ ] **Step 4: Thread openedAt through Reporter → StepDescribe**

In `packages/ui/src/reporter.tsx`, extend `ReporterProps` with `openedAt: number`, destructure it, and pass to `<StepDescribe openedAt={openedAt} ... />`.

In `packages/ui/src/mount.ts`, in the render call inside the open handler, pass `openedAt={_openedAt}` to the `<Reporter>` element.

- [ ] **Step 5: Update core index.ts to forward dwellMs + honeypot**

In `packages/core/src/index.ts`, the `onSubmit` callback currently takes `{ title, description, screenshot }`. Extend it to accept `dwellMs` and `honeypot`:

```ts
    onSubmit: async ({ title, description, screenshot, dwellMs, honeypot }) => {
```

And pass them through to `postReport`:

```ts
      const result = await postReport(_config, {
        title: final.title,
        description: final.description,
        context: final.context,
        metadata: _config.metadata,
        screenshot: final.screenshot,
        logs: final.logs,
        dwellMs,
        honeypot,
      })
```

Note the `onSubmit` signature in `mount.ts` needs to propagate `screenshot` too (it currently does — keep that wiring, just add the two new fields).

- [ ] **Step 6: Build the SDK locally and smoke-test via the demo**

```bash
bun run sdk:build
```

Then open `packages/ui/demo/index.html` in a browser, configure it with a real project key and the local dashboard, and file a test report. Confirm in the dashboard that the report appears.

If you have DevTools open, check the POST request body: the `report` part should contain `_dwellMs` (a reasonable number, probably ≥ 1500 since you took time to fill the form) and `_hp` (empty string).

- [ ] **Step 7: Commit**

```bash
git add packages/core/ packages/ui/
git commit -m "feat(sdk): honeypot input + dwell tracking"
```

---

## Task 10: Full gate + tag v0.6.3-anti-abuse

**Files:**
- None (validation + tag only)

- [ ] **Step 1: Lint**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run check
```

Expected: 0 errors. Warnings (50-ish existing) are acceptable.

- [ ] **Step 2: Unit tests**

```bash
cd apps/dashboard
SKIP_SERVER_CHECK=1 bun test ./server/lib/ ./tests/lib/
```

Expected: all unit tests pass (rate-limit, signed-attachment-url, github-helpers, render-template, etc.).

- [ ] **Step 3: Integration tests**

Ensure `nuxt dev` is running (if not, start it with `bun run dev` from repo root).

```bash
PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_sync_jobs, github_integrations, report_events, report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE; UPDATE app_settings SET signup_gated = false, allowed_email_domains = '{}'::text[] WHERE id = 1"
cd apps/dashboard
bun test
```

Expected: all tests pass (including the 4 new intake tests). Total should be 120 tests across 18 files.

- [ ] **Step 4: Tag**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git tag -a v0.6.3-anti-abuse -m "v0.6.3 — intake anti-abuse (honeypot, min-dwell, daily cap, tiered anon rate)

Four layered defenses for private/UAT deployment posture:
- Honeypot input on the SDK widget; intake tarpits non-empty _hp
  (fake 201, no persist, no alert to attacker)
- Min-dwell check: reject 400 when widget open→submit < 1.5s
- Per-project daily_report_cap column (default 1000); intake 429s
  when day's count reached
- Anonymous submissions (no reporter.userId) bucketed to a stricter
  rate limit (INTAKE_RATE_PER_KEY_ANON, default 10/min). Authenticated
  still at 60/min.

No external deps, no captcha, no privacy tradeoffs. HMAC identity and
Cloudflare Turnstile remain deferred to future iterations if the
deployment posture shifts to public/SaaS."
git tag | tail -5
```

Expected tag list includes `v0.6.3-anti-abuse`.

---

## Self-review

**Spec coverage:**

| Spec section | Task(s) |
| --- | --- |
| §Goal / Non-Goals | (Entire plan) |
| §Threat Model table | Tasks 5, 6, 7, 8 |
| §1 Honeypot Field — SDK input, tarpit on intake | Tasks 6 (intake), 9 (SDK) |
| §2 Min-Time-To-Submit — dwellMs from SDK, intake check | Tasks 5 (intake), 9 (SDK) |
| §3 Per-Project Daily Ceiling — column, intake COUNT, settings UI | Tasks 2 (column), 3 (API), 4 (UI), 7 (intake) |
| §4 Tighter Anonymous Rate Limit — second bucket, env var | Task 8 |
| §SDK API Changes — SDK always populates _hp and _dwellMs | Task 9 |
| §Schema Change — ALTER TABLE projects | Task 2 |
| §UI Change — Daily report limit input | Task 4 |
| §Intake Endpoint Order of Checks | Tasks 5, 6, 7, 8 enforce the order |
| §Configuration Summary — env vars | Tasks 5 (MIN_DWELL_MS), 8 (RATE_PER_KEY_ANON) |
| §Testing Strategy | Tasks 5, 6, 7, 8 step-1 tests |
| §Out-of-Scope Explicit List | Respected throughout |

**Placeholder scan:** No "TBD", "implement later", "handle edge cases". Every step has concrete code or concrete commands.

**Type consistency:**
- Wire field names `_hp` and `_dwellMs` used consistently (Task 1 Zod, Task 9 client serialization, Tasks 5/6 reads).
- SDK surface field names `dwellMs` and `honeypot` (no underscore) used consistently inside the SDK (Task 9); serialization to wire happens only in `postReport`.
- `dailyReportCap` column name consistent (Tasks 2, 3, 4, 7).
- `INTAKE_MIN_DWELL_MS`, `INTAKE_RATE_PER_KEY_ANON` env var names match the spec table.

**Known residual nuance:** Task 8 memoizes the limiter on first access. Setting `INTAKE_RATE_PER_KEY_ANON` inside the test body requires no earlier test to have called `getAnonKeyLimiter`. Task 8 Step 3 calls this out with a fallback (hoist the env set to module-top).
