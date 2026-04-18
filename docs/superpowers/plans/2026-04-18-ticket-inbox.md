# Ticket Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's plain reports table with a working triage inbox — status / assignee / priority / tags on every report, faceted filtering + search + sort, bulk status/assignee operations, and an auto-recorded activity log surfaced on the drawer.

**Architecture:** Extend the existing `reports` table with four triage columns and an `updated_at`; add one `report_events` table for the activity log; extend `GET /api/projects/:id/reports` with filters + facet counts; add three new endpoints (PATCH, bulk-update, events feed); extend the existing members endpoint with a `?role=` filter; rewrite `reports.vue` as a three-column faceted inbox reusing D's drawer shell.

**Tech Stack:** Nuxt 4 + Nitro + Drizzle ORM + Postgres 17 (Docker) + better-auth + Zod + Tailwind v4; Bun for tooling; oxlint + oxfmt on pre-commit.

**Reference spec:** `docs/superpowers/specs/2026-04-18-ticket-inbox-design.md`

**Baseline:** tag `v0.4.1-collectors-hardening`. Dashboard-only changes — no SDK bundle impact. Postgres container must be running on `:5436` (existing docker compose).

---

## File map (locks decomposition)

```
packages/shared/src/
└── reports.ts                                            MODIFY  — add enums + extend ReportSummaryDTO + add Event/Patch/Bulk DTOs

apps/dashboard/server/
├── db/schema/
│   ├── reports.ts                                        MODIFY  — add status/assignee_id/priority/tags/updated_at + indexes
│   ├── report-events.ts                                  CREATE
│   └── index.ts                                          MODIFY  — re-export report-events
├── db/migrations/NNNN_ticket_inbox.sql                   GENERATE
├── lib/
│   ├── report-events.ts                                  CREATE  — emit helper (single-report and bulk)
│   └── inbox-query.ts                                    CREATE  — tag diff, sort builder, assignee resolver
└── api/projects/[id]/
    ├── reports/
    │   ├── index.get.ts                                  MODIFY  — filters + facets + search + sort
    │   ├── bulk-update.post.ts                           CREATE
    │   └── [reportId]/
    │       ├── index.patch.ts                            CREATE
    │       └── events/
    │           └── index.get.ts                          CREATE
    └── members/index.get.ts                              MODIFY  — optional ?role= filter

apps/dashboard/tests/api/inbox.test.ts                    CREATE  — 12 integration tests
apps/dashboard/tests/lib/inbox-query.test.ts              CREATE  — unit tests for pure helpers

apps/dashboard/app/
├── pages/projects/[id]/reports.vue                       REWRITE
├── composables/use-inbox-query.ts                        CREATE  — URL ↔ filter state round-trip
└── components/
    ├── inbox/
    │   ├── status-tabs.vue                               CREATE
    │   ├── facet-sidebar.vue                             CREATE
    │   ├── search-sort.vue                               CREATE
    │   ├── report-row.vue                                CREATE
    │   └── bulk-action-bar.vue                           CREATE
    └── report-drawer/
        ├── drawer.vue                                    MODIFY  — pin triage panel, prepend Activity tab
        ├── triage-panel.vue                              CREATE
        └── activity-tab.vue                              CREATE

docs/superpowers/security/threat-model.md                 MODIFY  — append §F section
```

---

## Phase 1 — Schema + migration

### Task 1: Extend `reports` schema — triage columns + indexes

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/reports.ts`

- [ ] **Step 1: Replace the `reports` table block with the extended version**

Replace the entire `export const reports = pgTable(...)` block with:

```ts
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
    context: jsonb("context")
      .notNull()
      .default(sql`'{}'::jsonb`),
    origin: text("origin"),
    ip: text("ip"),
    status: text("status", { enum: ["open", "in_progress", "resolved", "closed"] })
      .notNull()
      .default("open"),
    assigneeId: text("assignee_id"),
    priority: text("priority", { enum: ["low", "normal", "high", "urgent"] })
      .notNull()
      .default("normal"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectCreatedIdx: index("reports_project_created_idx").on(
      table.projectId,
      sql`${table.createdAt} DESC`,
    ),
    projectStatusCreatedIdx: index("reports_project_status_created_idx").on(
      table.projectId,
      table.status,
      sql`${table.createdAt} DESC`,
    ),
    projectAssigneeIdx: index("reports_project_assignee_idx").on(
      table.projectId,
      table.assigneeId,
    ),
    projectPriorityIdx: index("reports_project_priority_idx").on(
      table.projectId,
      table.priority,
    ),
    tagsGinIdx: index("reports_tags_gin_idx").using("gin", table.tags),
  }),
)
```

Note: `assigneeId` has NO `.references(() => user.id, ...)` clause in Drizzle because cross-schema references to the better-auth `user` table are brittle with drizzle-kit's current pushing behavior; the FK constraint is added by hand in the migration SQL in Task 3.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -5`
Expected: no new errors (same pre-existing warnings only).

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/db/schema/reports.ts
git commit -m "feat(db): add status/assignee_id/priority/tags/updated_at to reports"
```

---

### Task 2: Create `report_events` schema

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/report-events.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/index.ts`

- [ ] **Step 1: Create `report-events.ts`**

```ts
import { sql } from "drizzle-orm"
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { reports } from "./reports"

export const reportEvents = pgTable(
  "report_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    actorId: text("actor_id"),
    kind: text("kind", {
      enum: [
        "status_changed",
        "assignee_changed",
        "priority_changed",
        "tag_added",
        "tag_removed",
      ],
    }).notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    reportCreatedIdx: index("report_events_report_created_idx").on(
      table.reportId,
      sql`${table.createdAt} DESC`,
    ),
  }),
)

export type ReportEvent = typeof reportEvents.$inferSelect
export type NewReportEvent = typeof reportEvents.$inferInsert
export type ReportEventKind = NonNullable<ReportEvent["kind"]>
```

- [ ] **Step 2: Re-export from `schema/index.ts`**

Modify `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/index.ts` — add one line:

```ts
export * from "./report-events"
```

The final file contents should be (add the new line at the end):

```ts
export * from "./auth-schema"
export * from "./projects"
export * from "./project-members"
export * from "./app-settings"
export * from "./reports"
export * from "./report-events"
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -5`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/db/schema/report-events.ts apps/dashboard/server/db/schema/index.ts
git commit -m "feat(db): add report_events table for triage activity log"
```

---

### Task 3: Generate and apply migration

**Files:**
- Create: `apps/dashboard/server/db/migrations/NNNN_ticket_inbox.sql` (drizzle-kit generates the filename)

- [ ] **Step 1: Generate the migration**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run db:gen 2>&1 | tail -15
```

Expected: a new SQL migration file appears under `apps/dashboard/server/db/migrations/`. Snapshot is updated. It adds the 4 new columns to `reports`, creates `report_events`, and creates the 5 indexes named in Tasks 1 + 2.

- [ ] **Step 2: Inspect the generated SQL**

Run: `ls -la apps/dashboard/server/db/migrations/*.sql | tail -3`

Open the newest `.sql` file. Verify it contains:
- `ALTER TABLE "reports" ADD COLUMN "status" ...` (+ assignee_id, priority, tags, updated_at)
- `CREATE TABLE "report_events" (...)`
- `CREATE INDEX "reports_project_status_created_idx" ...` and the other new indexes

If the migration is missing the FK constraint for `reports.assignee_id → user.id`, **append** these two lines to the end of the SQL file (the drizzle schema omits the cross-schema FK intentionally):

```sql
ALTER TABLE "reports"
  ADD CONSTRAINT "reports_assignee_id_user_id_fk"
  FOREIGN KEY ("assignee_id") REFERENCES "user"("id") ON DELETE SET NULL;
ALTER TABLE "report_events"
  ADD CONSTRAINT "report_events_actor_id_user_id_fk"
  FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL;
```

- [ ] **Step 3: Apply the migration**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run db:push 2>&1 | tail -5
```

Expected: migration applied, no errors.

- [ ] **Step 4: Verify columns + FKs in Postgres**

```bash
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "\d reports" | grep -E "status|assignee_id|priority|tags|updated_at"
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "\d report_events"
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "\di reports_*"
```

Expected output includes:
- `status` / `assignee_id` / `priority` / `tags` / `updated_at` columns on `reports` with correct types + defaults
- `report_events` table with all 5 columns
- All new indexes listed (project_status_created, project_assignee, project_priority, tags_gin, report_events_report_created)
- FK `reports_assignee_id_user_id_fk` and `report_events_actor_id_user_id_fk` present (check `\d reports` and `\d report_events`)

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/db/migrations/
git commit -m "feat(db): migration — ticket inbox schema (triage columns + report_events)"
```

---

## Phase 2 — Shared types

### Task 4: Extend `@feedback-tool/shared` with triage Zod schemas

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/src/reports.ts`

- [ ] **Step 1: Add new enums + schemas to `reports.ts`**

After the existing `ReportContext` block, BEFORE `ReportIntakeInput`, insert:

```ts
export const ReportStatus = z.enum(["open", "in_progress", "resolved", "closed"])
export type ReportStatus = z.infer<typeof ReportStatus>

export const ReportPriority = z.enum(["low", "normal", "high", "urgent"])
export type ReportPriority = z.infer<typeof ReportPriority>

export const ProjectMemberRole = z.enum(["owner", "developer", "viewer"])
export type ProjectMemberRole = z.infer<typeof ProjectMemberRole>

export const ReportAssigneeDTO = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().email(),
})
export type ReportAssigneeDTO = z.infer<typeof ReportAssigneeDTO>

export const ReportEventKind = z.enum([
  "status_changed",
  "assignee_changed",
  "priority_changed",
  "tag_added",
  "tag_removed",
])
export type ReportEventKind = z.infer<typeof ReportEventKind>

export const ReportEventDTO = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  actor: ReportAssigneeDTO.nullable(),
  kind: ReportEventKind,
  payload: z.record(z.string(), z.unknown()),
})
export type ReportEventDTO = z.infer<typeof ReportEventDTO>

export const TriagePatchInput = z
  .object({
    status: ReportStatus.optional(),
    assigneeId: z.string().nullable().optional(),
    priority: ReportPriority.optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.assigneeId !== undefined ||
      v.priority !== undefined ||
      v.tags !== undefined,
    { message: "At least one field must be present" },
  )
export type TriagePatchInput = z.infer<typeof TriagePatchInput>

export const BulkUpdateInput = z
  .object({
    reportIds: z.array(z.string().uuid()).min(1).max(100),
    status: ReportStatus.optional(),
    assigneeId: z.string().nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.assigneeId !== undefined, {
    message: "At least one of status or assigneeId must be present",
  })
export type BulkUpdateInput = z.infer<typeof BulkUpdateInput>
```

- [ ] **Step 2: Replace `ReportSummaryDTO` to add triage fields**

Find the existing `export const ReportSummaryDTO = z.object({ ... })` block and replace it with:

```ts
export const ReportSummaryDTO = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  context: ReportContext,
  reporterEmail: z.string().nullable(),
  pageUrl: z.string(),
  thumbnailUrl: z.string().nullable(),
  receivedAt: z.string(),
  updatedAt: z.string(),
  status: ReportStatus,
  priority: ReportPriority,
  tags: z.array(z.string()),
  assignee: ReportAssigneeDTO.nullable(),
})
export type ReportSummaryDTO = z.infer<typeof ReportSummaryDTO>
```

Also replace `ReportDetailDTO`:

```ts
export const ReportDetailDTO = ReportSummaryDTO.extend({
  attachments: z.array(AttachmentDTO),
})
export type ReportDetailDTO = z.infer<typeof ReportDetailDTO>
```

(It extends the now-richer summary — no need to redeclare description/context.)

- [ ] **Step 3: Verify typecheck**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/shared && bunx tsc --noEmit 2>&1 | head -10
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -10
```

Expected: no new errors. Existing consumers of `ReportSummaryDTO` may flag errors about the new required fields — those are fixed in later tasks when the list endpoint starts returning them.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/shared/src/reports.ts
git commit -m "feat(shared): add triage enums + Event/Patch/Bulk DTOs; extend ReportSummaryDTO"
```

---

## Phase 3 — Server lib primitives (TDD)

### Task 5: `diffTags` pure helper

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/inbox-query.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/lib/inbox-query.test.ts`

- [ ] **Step 1: Write failing test file**

```ts
// apps/dashboard/tests/lib/inbox-query.test.ts
import { describe, expect, test } from "bun:test"
import { diffTags } from "../../server/lib/inbox-query"

describe("diffTags", () => {
  test("returns added-only when tags are appended", () => {
    expect(diffTags(["a", "b"], ["a", "b", "c"])).toEqual({ added: ["c"], removed: [] })
  })
  test("returns removed-only when tags are dropped", () => {
    expect(diffTags(["a", "b"], ["a"])).toEqual({ added: [], removed: ["b"] })
  })
  test("returns both when tags are swapped", () => {
    expect(diffTags(["a", "b"], ["a", "c"])).toEqual({ added: ["c"], removed: ["b"] })
  })
  test("ignores order-only changes", () => {
    expect(diffTags(["a", "b"], ["b", "a"])).toEqual({ added: [], removed: [] })
  })
  test("deduplicates so the same tag added twice is one entry", () => {
    expect(diffTags([], ["a", "a", "b"])).toEqual({ added: ["a", "b"], removed: [] })
  })
  test("empty → empty returns nothing", () => {
    expect(diffTags([], [])).toEqual({ added: [], removed: [] })
  })
})
```

- [ ] **Step 2: Run and confirm fail**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/inbox-query.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module ... inbox-query`.

- [ ] **Step 3: Implement `diffTags`**

Create `apps/dashboard/server/lib/inbox-query.ts`:

```ts
export interface TagDiff {
  added: string[]
  removed: string[]
}

export function diffTags(oldTags: readonly string[], newTags: readonly string[]): TagDiff {
  const oldSet = new Set(oldTags)
  const newSet = new Set(newTags)
  const added: string[] = []
  const removed: string[] = []
  for (const t of newSet) if (!oldSet.has(t)) added.push(t)
  for (const t of oldSet) if (!newSet.has(t)) removed.push(t)
  return { added, removed }
}
```

- [ ] **Step 4: Run and confirm 6/6 PASS**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/inbox-query.test.ts 2>&1 | tail -5
```

Expected: `6 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/inbox-query.ts apps/dashboard/tests/lib/inbox-query.test.ts
git commit -m "feat(dashboard): add diffTags helper for triage event emission"
```

---

### Task 6: `resolveAssigneeFilter` helper

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/inbox-query.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/lib/inbox-query.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `tests/lib/inbox-query.test.ts` (inside the file, before the final closing `})` remove it first — actually the file has no top-level `describe` close but does end; just append a new `describe` block at the end of the file):

```ts
import { resolveAssigneeFilter } from "../../server/lib/inbox-query"

describe("resolveAssigneeFilter", () => {
  test("'me' returns { type: 'user', userId: session } ", () => {
    expect(resolveAssigneeFilter(["me"], "user-1")).toEqual([{ type: "user", userId: "user-1" }])
  })
  test("'unassigned' returns { type: 'null' }", () => {
    expect(resolveAssigneeFilter(["unassigned"], "user-1")).toEqual([{ type: "null" }])
  })
  test("plain user ids pass through", () => {
    expect(resolveAssigneeFilter(["user-2", "user-3"], "user-1")).toEqual([
      { type: "user", userId: "user-2" },
      { type: "user", userId: "user-3" },
    ])
  })
  test("mixed tokens preserve order", () => {
    expect(resolveAssigneeFilter(["me", "unassigned", "user-2"], "user-1")).toEqual([
      { type: "user", userId: "user-1" },
      { type: "null" },
      { type: "user", userId: "user-2" },
    ])
  })
  test("empty array returns empty", () => {
    expect(resolveAssigneeFilter([], "user-1")).toEqual([])
  })
  test("dedupes identical tokens", () => {
    expect(resolveAssigneeFilter(["me", "me"], "user-1")).toEqual([
      { type: "user", userId: "user-1" },
    ])
  })
})
```

- [ ] **Step 2: Confirm 6 new tests fail**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/inbox-query.test.ts 2>&1 | tail -5
```

Expected: 6 pass (diffTags), 6 fail (resolveAssigneeFilter not exported).

- [ ] **Step 3: Implement**

Append to `apps/dashboard/server/lib/inbox-query.ts`:

```ts
export type AssigneeFilter =
  | { type: "user"; userId: string }
  | { type: "null" }

export function resolveAssigneeFilter(
  tokens: readonly string[],
  sessionUserId: string,
): AssigneeFilter[] {
  const seen = new Set<string>()
  const out: AssigneeFilter[] = []
  for (const t of tokens) {
    const resolved: AssigneeFilter =
      t === "me"
        ? { type: "user", userId: sessionUserId }
        : t === "unassigned"
          ? { type: "null" }
          : { type: "user", userId: t }
    const key = resolved.type === "null" ? "null" : `u:${resolved.userId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(resolved)
  }
  return out
}
```

- [ ] **Step 4: Confirm 12/12 PASS**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/inbox-query.test.ts 2>&1 | tail -5
```

Expected: `12 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/inbox-query.ts apps/dashboard/tests/lib/inbox-query.test.ts
git commit -m "feat(dashboard): add resolveAssigneeFilter for me/unassigned/uuid tokens"
```

---

### Task 7: `buildSortClause` helper

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/inbox-query.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/lib/inbox-query.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/lib/inbox-query.test.ts`:

```ts
import { buildSortClause } from "../../server/lib/inbox-query"

describe("buildSortClause", () => {
  test("newest → created_at DESC", () => {
    expect(buildSortClause("newest")).toBe('"created_at" DESC')
  })
  test("oldest → created_at ASC", () => {
    expect(buildSortClause("oldest")).toBe('"created_at" ASC')
  })
  test("updated → updated_at DESC", () => {
    expect(buildSortClause("updated")).toBe('"updated_at" DESC')
  })
  test("priority → urgent > high > normal > low, tiebreak newest", () => {
    expect(buildSortClause("priority")).toBe(
      `CASE "priority" WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END ASC, "created_at" DESC`,
    )
  })
  test("unknown key defaults to newest", () => {
    expect(buildSortClause("garbage")).toBe('"created_at" DESC')
  })
})
```

- [ ] **Step 2: Confirm fail**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/inbox-query.test.ts 2>&1 | tail -3
```

Expected: 5 new tests fail.

- [ ] **Step 3: Implement**

Append to `apps/dashboard/server/lib/inbox-query.ts`:

```ts
export type SortKey = "newest" | "oldest" | "priority" | "updated"

export function buildSortClause(sort: string): string {
  switch (sort) {
    case "oldest":
      return `"created_at" ASC`
    case "updated":
      return `"updated_at" DESC`
    case "priority":
      return `CASE "priority" WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END ASC, "created_at" DESC`
    default:
      return `"created_at" DESC`
  }
}
```

- [ ] **Step 4: Confirm 17/17 PASS**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/inbox-query.test.ts 2>&1 | tail -5
```

Expected: `17 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/inbox-query.ts apps/dashboard/tests/lib/inbox-query.test.ts
git commit -m "feat(dashboard): add buildSortClause for inbox ORDER BY"
```

---

### Task 8: `report-events` emit helper

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/report-events.ts`

This is an integration-level helper that talks to the DB; no unit test (covered by the integration tests in Task 14). Keep the implementation small and focused.

- [ ] **Step 1: Create the helper**

```ts
// apps/dashboard/server/lib/report-events.ts
import type { NewReportEvent, ReportEventKind } from "../db/schema"
import { diffTags } from "./inbox-query"

export interface BeforeAfter {
  status?: { from: string; to: string }
  priority?: { from: string; to: string }
  assigneeId?: { from: string | null; to: string | null }
  tags?: { from: string[]; to: string[] }
}

/**
 * Build the list of report_events rows for a single report mutation. Callers
 * pass the "before" and "after" values of each touched field; the helper emits
 * exactly one event per changed scalar field and one event per added/removed
 * tag. No events when a field's from === to.
 *
 * Pure — returns the list. Callers handle the INSERT inside their transaction.
 */
export function buildReportEvents(
  reportId: string,
  actorId: string,
  change: BeforeAfter,
): NewReportEvent[] {
  const events: NewReportEvent[] = []
  const push = (kind: ReportEventKind, payload: Record<string, unknown>) => {
    events.push({ reportId, actorId, kind, payload })
  }

  if (change.status && change.status.from !== change.status.to) {
    push("status_changed", { from: change.status.from, to: change.status.to })
  }
  if (change.priority && change.priority.from !== change.priority.to) {
    push("priority_changed", { from: change.priority.from, to: change.priority.to })
  }
  if (change.assigneeId && change.assigneeId.from !== change.assigneeId.to) {
    push("assignee_changed", { from: change.assigneeId.from, to: change.assigneeId.to })
  }
  if (change.tags) {
    const { added, removed } = diffTags(change.tags.from, change.tags.to)
    for (const name of added) push("tag_added", { name })
    for (const name of removed) push("tag_removed", { name })
  }
  return events
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -5
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/report-events.ts
git commit -m "feat(dashboard): add buildReportEvents helper for triage event emission"
```

---

## Phase 4 — API endpoints

### Task 9: Extend `GET /api/projects/:id/reports` with filters, facets, sort, search

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/index.get.ts`

This task is big but has to land atomically — the list endpoint is the backbone of the inbox.

- [ ] **Step 1: Replace the entire file**

```ts
// apps/dashboard/server/api/projects/[id]/reports/index.get.ts
import { defineEventHandler, getQuery, getRouterParam } from "h3"
import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm"
import {
  ReportPriority,
  ReportStatus,
  type ReportAssigneeDTO,
  type ReportContext,
  type ReportSummaryDTO,
} from "@feedback-tool/shared"
import { db } from "../../../../db"
import { reportAttachments, reports } from "../../../../db/schema"
import { user as userTable } from "../../../../db/schema/auth-schema"
import { buildSortClause, resolveAssigneeFilter } from "../../../../lib/inbox-query"
import { requireProjectRole } from "../../../../lib/permissions"

function parseCsv(v: unknown): string[] {
  if (typeof v !== "string") return []
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 10)
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw new Error("missing project id")
  const { session } = await requireProjectRole(event, id, "viewer")
  const sessionUserId = session.user.id

  const q = getQuery(event)
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)))
  const offset = Math.max(0, Number(q.offset ?? 0))
  const searchRaw = typeof q.q === "string" ? q.q.slice(0, 200).trim() : ""
  const sortClause = buildSortClause(typeof q.sort === "string" ? q.sort : "newest")

  const statusTokens = parseCsv(q.status).filter((v) => ReportStatus.safeParse(v).success)
  const priorityTokens = parseCsv(q.priority).filter((v) => ReportPriority.safeParse(v).success)
  const tagTokens = parseCsv(q.tag)
  const assigneeTokens = parseCsv(q.assignee)
  const assigneeFilters = resolveAssigneeFilter(assigneeTokens, sessionUserId)

  const whereParts = [eq(reports.projectId, id)]
  if (statusTokens.length) whereParts.push(inArray(reports.status, statusTokens))
  if (priorityTokens.length) whereParts.push(inArray(reports.priority, priorityTokens))
  if (tagTokens.length) whereParts.push(sql`${reports.tags} @> ${tagTokens}::text[]`)
  if (assigneeFilters.length) {
    const userIds = assigneeFilters.filter((f) => f.type === "user").map((f) => f.userId)
    const wantUnassigned = assigneeFilters.some((f) => f.type === "null")
    const parts = []
    if (userIds.length) parts.push(inArray(reports.assigneeId, userIds))
    if (wantUnassigned) parts.push(isNull(reports.assigneeId))
    if (parts.length === 1) whereParts.push(parts[0])
    else if (parts.length > 1) whereParts.push(or(...parts))
  }
  if (searchRaw) {
    const pat = `%${searchRaw}%`
    whereParts.push(or(ilike(reports.title, pat), ilike(reports.description, pat)))
  }

  const whereClause = and(...whereParts)

  const [{ total }] = await db.select({ total: count() }).from(reports).where(whereClause)

  const rows = await db
    .select({
      id: reports.id,
      title: reports.title,
      description: reports.description,
      context: reports.context,
      createdAt: reports.createdAt,
      updatedAt: reports.updatedAt,
      status: reports.status,
      priority: reports.priority,
      tags: reports.tags,
      assigneeId: reports.assigneeId,
      assigneeName: userTable.name,
      assigneeEmail: userTable.email,
      attachmentId: reportAttachments.id,
    })
    .from(reports)
    .leftJoin(userTable, eq(userTable.id, reports.assigneeId))
    .leftJoin(
      reportAttachments,
      and(eq(reportAttachments.reportId, reports.id), eq(reportAttachments.kind, "screenshot")),
    )
    .where(whereClause)
    .orderBy(sql.raw(sortClause))
    .limit(limit)
    .offset(offset)

  const items: ReportSummaryDTO[] = rows.map((r) => {
    const ctx = r.context as ReportContext
    const assignee: ReportAssigneeDTO | null =
      r.assigneeId && r.assigneeEmail
        ? { id: r.assigneeId, name: r.assigneeName ?? null, email: r.assigneeEmail }
        : null
    return {
      id: r.id,
      title: r.title,
      description: r.description ?? null,
      context: ctx,
      reporterEmail: ctx.reporter?.email ?? null,
      pageUrl: ctx.pageUrl,
      receivedAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      thumbnailUrl: r.attachmentId
        ? `/api/projects/${id}/reports/${r.id}/attachment?kind=screenshot`
        : null,
      status: r.status,
      priority: r.priority,
      tags: r.tags,
      assignee,
    }
  })

  // Facet counts — all use the same whereClause as the list.
  const statusRows = await db
    .select({ key: reports.status, c: count() })
    .from(reports)
    .where(whereClause)
    .groupBy(reports.status)
  const priorityRows = await db
    .select({ key: reports.priority, c: count() })
    .from(reports)
    .where(whereClause)
    .groupBy(reports.priority)
  const assigneeRows = await db
    .select({
      id: reports.assigneeId,
      name: userTable.name,
      email: userTable.email,
      c: count(),
    })
    .from(reports)
    .leftJoin(userTable, eq(userTable.id, reports.assigneeId))
    .where(whereClause)
    .groupBy(reports.assigneeId, userTable.name, userTable.email)
  const tagRows = await db
    .select({ name: sql<string>`unnest(${reports.tags})`.as("name"), c: count() })
    .from(reports)
    .where(whereClause)
    .groupBy(sql`name`)
    .orderBy(desc(count()))
    .limit(20)

  const statusFacet: Record<string, number> = { open: 0, in_progress: 0, resolved: 0, closed: 0 }
  for (const r of statusRows) statusFacet[r.key] = r.c
  const priorityFacet: Record<string, number> = { low: 0, normal: 0, high: 0, urgent: 0 }
  for (const r of priorityRows) priorityFacet[r.key] = r.c

  return {
    items,
    total,
    facets: {
      status: statusFacet,
      priority: priorityFacet,
      assignees: assigneeRows.map((r) => ({
        id: r.id,
        name: r.name ?? null,
        email: r.email ?? null,
        count: r.c,
      })),
      tags: tagRows.map((r) => ({ name: r.name, count: r.c })),
    },
  }
})
```

- [ ] **Step 2: Verify tsc clean**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -10
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/projects/[id]/reports/index.get.ts
git commit -m "feat(api): extend reports list with filters, facets, sort, search"
```

---

### Task 10: `PATCH /api/projects/:id/reports/:reportId` — single-report triage

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts`

- [ ] **Step 1: Create the endpoint**

```ts
// apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, eq } from "drizzle-orm"
import { TriagePatchInput } from "@feedback-tool/shared"
import { db } from "../../../../../db"
import { projectMembers, reportEvents, reports } from "../../../../../db/schema"
import { buildReportEvents } from "../../../../../lib/report-events"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!id || !reportId) throw createError({ statusCode: 400, statusMessage: "missing params" })
  const { session } = await requireProjectRole(event, id, "developer")
  const actorId = session.user.id

  const body = await readValidatedBody(event, (b: unknown) => TriagePatchInput.parse(b))

  if (body.assigneeId !== undefined && body.assigneeId !== null) {
    const [member] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, id), eq(projectMembers.userId, body.assigneeId)),
      )
      .limit(1)
    if (!member || member.role === "viewer") {
      throw createError({
        statusCode: 400,
        statusMessage: "Assignee must be a developer or owner of this project",
      })
    }
  }

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.id, reportId), eq(reports.projectId, id)))
      .limit(1)
    if (!current) throw createError({ statusCode: 404, statusMessage: "Report not found" })

    const patch: Partial<typeof reports.$inferInsert> = {}
    const change: Parameters<typeof buildReportEvents>[2] = {}
    if (body.status !== undefined && body.status !== current.status) {
      patch.status = body.status
      change.status = { from: current.status, to: body.status }
    }
    if (body.priority !== undefined && body.priority !== current.priority) {
      patch.priority = body.priority
      change.priority = { from: current.priority, to: body.priority }
    }
    if (body.assigneeId !== undefined && body.assigneeId !== current.assigneeId) {
      patch.assigneeId = body.assigneeId
      change.assigneeId = { from: current.assigneeId, to: body.assigneeId }
    }
    if (body.tags !== undefined) {
      // Normalize: dedupe + preserve input order for stored value.
      const seen = new Set<string>()
      const nextTags: string[] = []
      for (const t of body.tags) {
        if (!seen.has(t)) {
          seen.add(t)
          nextTags.push(t)
        }
      }
      if (
        nextTags.length !== current.tags.length ||
        nextTags.some((t, i) => t !== current.tags[i])
      ) {
        patch.tags = nextTags
        change.tags = { from: current.tags, to: nextTags }
      }
    }

    if (Object.keys(patch).length === 0) {
      // No-op — return the current record without bumping updated_at or emitting events.
      return { ok: true, updated: false }
    }

    patch.updatedAt = new Date()
    await tx
      .update(reports)
      .set(patch)
      .where(and(eq(reports.id, reportId), eq(reports.projectId, id)))

    const events = buildReportEvents(reportId, actorId, change)
    if (events.length > 0) await tx.insert(reportEvents).values(events)

    return { ok: true, updated: true }
  })
})
```

- [ ] **Step 2: Verify tsc clean**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -10
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts
git commit -m "feat(api): add PATCH /reports/:reportId for triage mutations"
```

---

### Task 11: `POST /api/projects/:id/reports/bulk-update`

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts`

- [ ] **Step 1: Create**

```ts
// apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { and, eq, inArray } from "drizzle-orm"
import { BulkUpdateInput } from "@feedback-tool/shared"
import { db } from "../../../../db"
import { projectMembers, reportEvents, reports } from "../../../../db/schema"
import { buildReportEvents } from "../../../../lib/report-events"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const { session } = await requireProjectRole(event, id, "developer")
  const actorId = session.user.id

  const body = await readValidatedBody(event, (b: unknown) => BulkUpdateInput.parse(b))

  if (body.assigneeId !== undefined && body.assigneeId !== null) {
    const [member] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, body.assigneeId)))
      .limit(1)
    if (!member || member.role === "viewer") {
      throw createError({
        statusCode: 400,
        statusMessage: "Assignee must be a developer or owner of this project",
      })
    }
  }

  return await db.transaction(async (tx) => {
    const currents = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.projectId, id), inArray(reports.id, body.reportIds)))

    if (currents.length !== body.reportIds.length) {
      throw createError({
        statusCode: 400,
        statusMessage: "One or more reportIds not found in this project",
      })
    }

    const updated: string[] = []
    const allEvents = []
    for (const current of currents) {
      const patch: Partial<typeof reports.$inferInsert> = {}
      const change: Parameters<typeof buildReportEvents>[2] = {}
      if (body.status !== undefined && body.status !== current.status) {
        patch.status = body.status
        change.status = { from: current.status, to: body.status }
      }
      if (body.assigneeId !== undefined && body.assigneeId !== current.assigneeId) {
        patch.assigneeId = body.assigneeId
        change.assigneeId = { from: current.assigneeId, to: body.assigneeId }
      }
      if (Object.keys(patch).length === 0) continue

      patch.updatedAt = new Date()
      await tx.update(reports).set(patch).where(eq(reports.id, current.id))
      updated.push(current.id)
      allEvents.push(...buildReportEvents(current.id, actorId, change))
    }

    if (allEvents.length > 0) await tx.insert(reportEvents).values(allEvents)

    return { updated }
  })
})
```

- [ ] **Step 2: Verify tsc clean**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts
git commit -m "feat(api): add bulk-update endpoint for batched status/assignee changes"
```

---

### Task 12: `GET /api/projects/:id/reports/:reportId/events` — events feed

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/[reportId]/events/index.get.ts`

- [ ] **Step 1: Create**

```ts
// apps/dashboard/server/api/projects/[id]/reports/[reportId]/events/index.get.ts
import { createError, defineEventHandler, getQuery, getRouterParam } from "h3"
import { and, count, desc, eq } from "drizzle-orm"
import type { ReportEventDTO } from "@feedback-tool/shared"
import { db } from "../../../../../../db"
import { reportEvents, reports } from "../../../../../../db/schema"
import { user as userTable } from "../../../../../../db/schema/auth-schema"
import { requireProjectRole } from "../../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!id || !reportId) throw createError({ statusCode: 400, statusMessage: "missing params" })
  await requireProjectRole(event, id, "viewer")

  // Confirm the report belongs to this project before returning anything.
  const [owned] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.projectId, id)))
    .limit(1)
  if (!owned) throw createError({ statusCode: 404, statusMessage: "Report not found" })

  const q = getQuery(event)
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)))
  const offset = Math.max(0, Number(q.offset ?? 0))

  const [{ total }] = await db
    .select({ total: count() })
    .from(reportEvents)
    .where(eq(reportEvents.reportId, reportId))

  const rows = await db
    .select({
      id: reportEvents.id,
      createdAt: reportEvents.createdAt,
      kind: reportEvents.kind,
      payload: reportEvents.payload,
      actorId: reportEvents.actorId,
      actorName: userTable.name,
      actorEmail: userTable.email,
    })
    .from(reportEvents)
    .leftJoin(userTable, eq(userTable.id, reportEvents.actorId))
    .where(eq(reportEvents.reportId, reportId))
    .orderBy(desc(reportEvents.createdAt))
    .limit(limit)
    .offset(offset)

  const items: ReportEventDTO[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    kind: r.kind,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    actor:
      r.actorId && r.actorEmail
        ? { id: r.actorId, name: r.actorName ?? null, email: r.actorEmail }
        : null,
  }))

  return { items, total }
})
```

- [ ] **Step 2: Verify tsc clean**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/projects/[id]/reports/[reportId]/events/index.get.ts
git commit -m "feat(api): add events feed endpoint for the activity log"
```

---

### Task 13: Extend `GET /api/projects/:id/members` with `?role=` filter

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/members/index.get.ts`

- [ ] **Step 1: Read the current handler**

Run: `cat /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/members/index.get.ts`

- [ ] **Step 2: Add the `role` filter**

Edit the file: after `await requireProjectRole(...)` and before the main select, parse the optional role param and push an `inArray` filter into the existing `where`. Import `inArray` from drizzle-orm and `ProjectMemberRole` from `@feedback-tool/shared` alongside existing imports. Concretely, change the `where(...)` clause that currently filters by `projectId` to include an optional role array filter.

Add above the select:

```ts
import { ProjectMemberRole } from "@feedback-tool/shared"
import { inArray } from "drizzle-orm"

// ... inside the handler, after requireProjectRole:
const q = getQuery(event)
const roleParam = typeof q.role === "string" ? q.role : ""
const roleTokens = roleParam
  .split(",")
  .map((s) => s.trim())
  .filter((s) => ProjectMemberRole.safeParse(s).success)
  .slice(0, 3)
```

Then update the `where()` clause from `eq(projectMembers.projectId, id)` to:

```ts
and(
  eq(projectMembers.projectId, id),
  roleTokens.length ? inArray(projectMembers.role, roleTokens) : undefined,
)
```

If `getQuery` isn't already imported, add it to the `h3` import line.

- [ ] **Step 3: Verify tsc clean**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -5
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/projects/[id]/members/index.get.ts
git commit -m "feat(api): add optional ?role= filter to members list"
```

---

### Task 14: Integration tests — 12 scenarios covering all endpoints

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/api/inbox.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// apps/dashboard/tests/api/inbox.test.ts
import { setup } from "@nuxt/test-utils/e2e"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(30000)
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import {
  apiFetch,
  createUser,
  makePngBlob,
  seedProject,
  signIn,
  truncateDomain,
  truncateReports,
} from "../helpers"
import { db } from "../../server/db"
import { projectMembers, reportAttachments, reportEvents, reports } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })

const PK = "ft_pk_INBX1234567890abcdef1234"
const ORIGIN = "http://localhost:4000"

async function seedReport(
  projectId: string,
  overrides: Partial<typeof reports.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(reports)
    .values({
      projectId,
      title: overrides.title ?? "Seed report",
      description: overrides.description ?? null,
      context: overrides.context ?? {
        pageUrl: "http://localhost:4000/p",
        userAgent: "UA",
        viewport: { w: 1000, h: 800 },
        timestamp: new Date().toISOString(),
      },
      status: overrides.status ?? "open",
      priority: overrides.priority ?? "normal",
      tags: overrides.tags ?? [],
      assigneeId: overrides.assigneeId ?? null,
    })
    .returning({ id: reports.id })
  return row.id
}

async function addMember(projectId: string, userId: string, role: "developer" | "viewer") {
  await db.insert(projectMembers).values({ projectId, userId, role })
}

describe("ticket inbox API", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("list filters by status CSV", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { status: "open" })
    await seedReport(pid, { status: "open" })
    await seedReport(pid, { status: "in_progress" })
    await seedReport(pid, { status: "closed" })
    const cookie = await signIn("owner@example.com")
    const { status, body } = await apiFetch<{ items: Array<{ status: string }>; total: number }>(
      `/api/projects/${pid}/reports?status=open,in_progress`,
      { headers: { cookie } },
    )
    expect(status).toBe(200)
    expect(body.total).toBe(3)
    expect(new Set(body.items.map((i) => i.status))).toEqual(new Set(["open", "in_progress"]))
  })

  test("list filters by assignee=me", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { assigneeId: owner })
    await seedReport(pid, { assigneeId: null })
    const cookie = await signIn("owner@example.com")
    const { status, body } = await apiFetch<{
      items: Array<{ assignee: { id: string } | null }>
    }>(`/api/projects/${pid}/reports?assignee=me`, { headers: { cookie } })
    expect(status).toBe(200)
    expect(body.items.length).toBe(1)
    expect(body.items[0].assignee?.id).toBe(owner)
  })

  test("list filters by tag AND semantics", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { tags: ["mobile", "ios"] })
    await seedReport(pid, { tags: ["mobile"] })
    await seedReport(pid, { tags: ["ios"] })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{ items: Array<{ tags: string[] }>; total: number }>(
      `/api/projects/${pid}/reports?tag=mobile,ios`,
      { headers: { cookie } },
    )
    expect(body.total).toBe(1)
    expect(body.items[0].tags.sort()).toEqual(["ios", "mobile"])
  })

  test("text search is case-insensitive on title and description", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { title: "Checkout crash on Safari" })
    await seedReport(pid, { description: "the CHECKOUT is slow" })
    await seedReport(pid, { title: "Unrelated" })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{ total: number }>(
      `/api/projects/${pid}/reports?q=checkout`,
      { headers: { cookie } },
    )
    expect(body.total).toBe(2)
  })

  test("facet counts reflect current filter set", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await seedReport(pid, { status: "open", priority: "high" })
    await seedReport(pid, { status: "open", priority: "low" })
    await seedReport(pid, { status: "closed", priority: "high" })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{
      facets: { priority: Record<string, number>; status: Record<string, number> }
    }>(`/api/projects/${pid}/reports?status=open`, { headers: { cookie } })
    expect(body.facets.priority.high).toBe(1)
    expect(body.facets.priority.low).toBe(1)
    expect(body.facets.status.open).toBe(2)
    expect(body.facets.status.closed).toBe(0)
  })

  test("PATCH single field emits exactly one event", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const rid = await seedReport(pid)
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { status: "in_progress" },
    })
    expect(status).toBe(200)
    const evs = await db.select().from(reportEvents).where(eq(reportEvents.reportId, rid))
    expect(evs.length).toBe(1)
    expect(evs[0].kind).toBe("status_changed")
  })

  test("PATCH multiple fields emits one event per changed field", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const rid = await seedReport(pid)
    const cookie = await signIn("owner@example.com")
    await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { status: "in_progress", priority: "high", assigneeId: owner },
    })
    const evs = await db.select().from(reportEvents).where(eq(reportEvents.reportId, rid))
    expect(evs.length).toBe(3)
    expect(new Set(evs.map((e) => e.kind))).toEqual(
      new Set(["status_changed", "priority_changed", "assignee_changed"]),
    )
  })

  test("PATCH tags diffs into per-add/per-remove events", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const rid = await seedReport(pid, { tags: ["a", "b"] })
    const cookie = await signIn("owner@example.com")
    await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { tags: ["a", "c"] },
    })
    const evs = await db.select().from(reportEvents).where(eq(reportEvents.reportId, rid))
    const kinds = evs.map((e) => e.kind).sort()
    expect(kinds).toEqual(["tag_added", "tag_removed"])
  })

  test("bulk-update returns only reports that actually changed", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const r1 = await seedReport(pid, { status: "open" })
    const r2 = await seedReport(pid, { status: "open" })
    const r3 = await seedReport(pid, { status: "resolved" })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{ updated: string[] }>(
      `/api/projects/${pid}/reports/bulk-update`,
      {
        method: "POST",
        headers: { cookie },
        body: { reportIds: [r1, r2, r3], status: "resolved" },
      },
    )
    expect(body.updated.sort()).toEqual([r1, r2].sort())
  })

  test("viewer cannot PATCH", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const viewer = await createUser("viewer@example.com", "member")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await addMember(pid, viewer, "viewer")
    const rid = await seedReport(pid)
    const cookie = await signIn("viewer@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { status: "closed" },
    })
    expect(status).toBe(403)
    const [current] = await db.select().from(reports).where(eq(reports.id, rid))
    expect(current.status).toBe("open")
  })

  test("assigning to a viewer is rejected", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const viewer = await createUser("viewer@example.com", "member")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await addMember(pid, viewer, "viewer")
    const rid = await seedReport(pid)
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { assigneeId: viewer },
    })
    expect(status).toBe(400)
  })

  test("events feed returns actor-embedded DTOs in reverse-chrono", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "Inbox",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const rid = await seedReport(pid)
    const cookie = await signIn("owner@example.com")
    await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { status: "in_progress" },
    })
    await apiFetch(`/api/projects/${pid}/reports/${rid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { priority: "high" },
    })
    const { body } = await apiFetch<{
      items: Array<{ kind: string; actor: { email: string } | null }>
    }>(`/api/projects/${pid}/reports/${rid}/events`, { headers: { cookie } })
    expect(body.items.length).toBe(2)
    expect(body.items[0].kind).toBe("priority_changed") // newer
    expect(body.items[0].actor?.email).toBe("owner@example.com")
    expect(body.items[1].kind).toBe("status_changed") // older
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_events, report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE" >/dev/null 2>&1 || true
cd apps/dashboard && bun test tests/api/inbox.test.ts 2>&1 | tail -10
```

Expected: `12 pass, 0 fail`.

- [ ] **Step 3: Run intake regression**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/intake.test.ts tests/api/logs-intake.test.ts 2>&1 | tail -10
```

Expected: all existing intake tests still pass (the list endpoint shape grew — no existing caller breaks).

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/tests/api/inbox.test.ts
git commit -m "test(api): add 12 ticket-inbox integration tests"
```

---

## Phase 5 — UI (inbox page)

### Task 15: URL ↔ filter state composable

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/composables/use-inbox-query.ts`

- [ ] **Step 1: Create**

```ts
// apps/dashboard/app/composables/use-inbox-query.ts
import type { LocationQueryRaw } from "vue-router"

export interface InboxQuery {
  status: string[]
  priority: string[]
  tag: string[]
  assignee: string[]
  q: string
  sort: "newest" | "oldest" | "priority" | "updated"
  limit: number
  offset: number
}

function parseCsv(v: unknown): string[] {
  if (typeof v !== "string") return []
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function useInboxQuery() {
  const route = useRoute()
  const router = useRouter()

  const query = computed<InboxQuery>(() => {
    const q = route.query
    const sort = (typeof q.sort === "string" ? q.sort : "newest") as InboxQuery["sort"]
    return {
      status: parseCsv(q.status),
      priority: parseCsv(q.priority),
      tag: parseCsv(q.tag),
      assignee: parseCsv(q.assignee),
      q: typeof q.q === "string" ? q.q : "",
      sort: ["newest", "oldest", "priority", "updated"].includes(sort) ? sort : "newest",
      limit: Number(q.limit ?? 50),
      offset: Number(q.offset ?? 0),
    }
  })

  function update(patch: Partial<InboxQuery>): void {
    const merged = { ...query.value, ...patch }
    const next: LocationQueryRaw = {}
    if (merged.status.length) next.status = merged.status.join(",")
    if (merged.priority.length) next.priority = merged.priority.join(",")
    if (merged.tag.length) next.tag = merged.tag.join(",")
    if (merged.assignee.length) next.assignee = merged.assignee.join(",")
    if (merged.q) next.q = merged.q
    if (merged.sort !== "newest") next.sort = merged.sort
    if (merged.offset > 0) next.offset = String(merged.offset)
    router.replace({ query: next })
  }

  function toApi(): string {
    const parts: string[] = []
    if (query.value.status.length) parts.push(`status=${query.value.status.join(",")}`)
    if (query.value.priority.length) parts.push(`priority=${query.value.priority.join(",")}`)
    if (query.value.tag.length) parts.push(`tag=${query.value.tag.join(",")}`)
    if (query.value.assignee.length) parts.push(`assignee=${query.value.assignee.join(",")}`)
    if (query.value.q) parts.push(`q=${encodeURIComponent(query.value.q)}`)
    parts.push(`sort=${query.value.sort}`)
    parts.push(`limit=${query.value.limit}`)
    parts.push(`offset=${query.value.offset}`)
    return parts.join("&")
  }

  return { query, update, toApi }
}
```

- [ ] **Step 2: Verify tsc clean**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3 && bunx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/composables/use-inbox-query.ts
git commit -m "feat(dashboard): add useInboxQuery composable for URL ↔ filter state"
```

---

### Task 16: `status-tabs.vue` component

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/inbox/status-tabs.vue`

- [ ] **Step 1: Create**

```vue
<!-- apps/dashboard/app/components/inbox/status-tabs.vue -->
<script setup lang="ts">
import type { ReportStatus } from "@feedback-tool/shared"

interface Props {
  selected: ReportStatus[]
  counts: Record<ReportStatus, number>
  total: number
}

const props = defineProps<Props>()
const emit = defineEmits<{ change: [ReportStatus[]] }>()

const TABS: Array<{ key: "all" | ReportStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
]

function isActive(key: "all" | ReportStatus): boolean {
  if (key === "all") return props.selected.length === 0
  return props.selected.length === 1 && props.selected[0] === key
}

function onClick(key: "all" | ReportStatus) {
  emit("change", key === "all" ? [] : [key])
}

function countFor(key: "all" | ReportStatus): number {
  return key === "all" ? props.total : (props.counts[key] ?? 0)
}
</script>

<template>
  <nav class="flex gap-1 border-b text-sm">
    <button
      v-for="t in TABS"
      :key="t.key"
      type="button"
      class="px-3 py-2 border-b-2 -mb-px"
      :class="
        isActive(t.key)
          ? 'border-neutral-900 font-semibold'
          : 'border-transparent text-neutral-500 hover:text-neutral-900'
      "
      @click="onClick(t.key)"
    >
      {{ t.label }}
      <span class="ml-1 text-xs text-neutral-400">{{ countFor(t.key) }}</span>
    </button>
  </nav>
</template>
```

- [ ] **Step 2: Verify nuxt prepare clean**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/inbox/status-tabs.vue
git commit -m "feat(dashboard): add status-tabs component for the inbox header"
```

---

### Task 17: `facet-sidebar.vue` component

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/inbox/facet-sidebar.vue`

- [ ] **Step 1: Create**

```vue
<!-- apps/dashboard/app/components/inbox/facet-sidebar.vue -->
<script setup lang="ts">
import type { ReportPriority } from "@feedback-tool/shared"

interface Assignee {
  id: string | null
  name: string | null
  email: string | null
  count: number
}

interface Props {
  priorityCounts: Record<ReportPriority, number>
  assignees: Assignee[]
  tags: Array<{ name: string; count: number }>
  selectedPriority: ReportPriority[]
  selectedAssignee: string[] // 'me' / 'unassigned' / userId
  selectedTags: string[]
  sessionUserId: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  priority: [ReportPriority[]]
  assignee: [string[]]
  tag: [string[]]
}>()

function togglePriority(p: ReportPriority) {
  const has = props.selectedPriority.includes(p)
  emit("priority", has ? props.selectedPriority.filter((x) => x !== p) : [...props.selectedPriority, p])
}
function toggleAssignee(token: string) {
  const has = props.selectedAssignee.includes(token)
  emit("assignee", has ? props.selectedAssignee.filter((x) => x !== token) : [...props.selectedAssignee, token])
}
function toggleTag(name: string) {
  const has = props.selectedTags.includes(name)
  emit("tag", has ? props.selectedTags.filter((x) => x !== name) : [...props.selectedTags, name])
}

const PRIORITIES: ReportPriority[] = ["urgent", "high", "normal", "low"]

function isAssigneeSelected(a: Assignee): boolean {
  if (a.id === null) return props.selectedAssignee.includes("unassigned")
  if (a.id === props.sessionUserId) return props.selectedAssignee.includes("me")
  return props.selectedAssignee.includes(a.id)
}
function assigneeToken(a: Assignee): string {
  if (a.id === null) return "unassigned"
  if (a.id === props.sessionUserId) return "me"
  return a.id
}
function assigneeLabel(a: Assignee): string {
  if (a.id === null) return "Unassigned"
  if (a.id === props.sessionUserId) return "Me"
  return a.name ?? a.email ?? a.id
}
</script>

<template>
  <aside class="space-y-5 text-sm p-3">
    <section>
      <h3 class="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Assignee</h3>
      <ul class="space-y-1">
        <li v-for="a in assignees" :key="a.id ?? '__unassigned'">
          <label class="flex items-center gap-2 cursor-pointer hover:bg-neutral-50 rounded px-1 py-0.5">
            <input
              type="checkbox"
              :checked="isAssigneeSelected(a)"
              @change="toggleAssignee(assigneeToken(a))"
            />
            <span class="truncate flex-1">{{ assigneeLabel(a) }}</span>
            <span class="text-xs text-neutral-400">{{ a.count }}</span>
          </label>
        </li>
      </ul>
    </section>

    <section>
      <h3 class="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Priority</h3>
      <ul class="space-y-1">
        <li v-for="p in PRIORITIES" :key="p">
          <label class="flex items-center gap-2 cursor-pointer hover:bg-neutral-50 rounded px-1 py-0.5 capitalize">
            <input
              type="checkbox"
              :checked="selectedPriority.includes(p)"
              @change="togglePriority(p)"
            />
            <span class="flex-1">{{ p }}</span>
            <span class="text-xs text-neutral-400">{{ priorityCounts[p] ?? 0 }}</span>
          </label>
        </li>
      </ul>
    </section>

    <section v-if="tags.length">
      <h3 class="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Tags</h3>
      <ul class="space-y-1">
        <li v-for="t in tags" :key="t.name">
          <label class="flex items-center gap-2 cursor-pointer hover:bg-neutral-50 rounded px-1 py-0.5">
            <input
              type="checkbox"
              :checked="selectedTags.includes(t.name)"
              @change="toggleTag(t.name)"
            />
            <span class="truncate flex-1">{{ t.name }}</span>
            <span class="text-xs text-neutral-400">{{ t.count }}</span>
          </label>
        </li>
      </ul>
    </section>
  </aside>
</template>
```

- [ ] **Step 2: Verify nuxt prepare clean**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/inbox/facet-sidebar.vue
git commit -m "feat(dashboard): add facet-sidebar component (assignee/priority/tags)"
```

---

### Task 18: `search-sort.vue` component

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/inbox/search-sort.vue`

- [ ] **Step 1: Create**

```vue
<!-- apps/dashboard/app/components/inbox/search-sort.vue -->
<script setup lang="ts">
interface Props {
  query: string
  sort: "newest" | "oldest" | "priority" | "updated"
}
const props = defineProps<Props>()
const emit = defineEmits<{
  "update:query": [string]
  "update:sort": [Props["sort"]]
}>()

const localQuery = ref(props.query)
watch(
  () => props.query,
  (v) => {
    localQuery.value = v
  },
)
// Debounced emit so URL doesn't update on every keystroke.
let timer: ReturnType<typeof setTimeout> | null = null
function onInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  localQuery.value = v
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => emit("update:query", v), 250)
}
</script>

<template>
  <div class="flex items-center gap-2 p-2 border-b">
    <input
      :value="localQuery"
      class="flex-1 border rounded px-2 py-1 text-sm"
      placeholder="Search title or description…"
      @input="onInput"
    />
    <select
      :value="sort"
      class="border rounded px-2 py-1 text-sm"
      @change="emit('update:sort', ($event.target as HTMLSelectElement).value as Props['sort'])"
    >
      <option value="newest">Newest</option>
      <option value="oldest">Oldest</option>
      <option value="priority">Priority</option>
      <option value="updated">Recently updated</option>
    </select>
  </div>
</template>
```

- [ ] **Step 2: Verify nuxt prepare clean**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/inbox/search-sort.vue
git commit -m "feat(dashboard): add search-sort toolbar component"
```

---

### Task 19: `report-row.vue` component

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/inbox/report-row.vue`

- [ ] **Step 1: Create**

```vue
<!-- apps/dashboard/app/components/inbox/report-row.vue -->
<script setup lang="ts">
import type { ReportSummaryDTO } from "@feedback-tool/shared"

interface Props {
  report: ReportSummaryDTO
  checked: boolean
}
defineProps<Props>()
const emit = defineEmits<{
  "toggle-check": []
  open: []
}>()

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  normal: "bg-neutral-100 text-neutral-600",
  low: "bg-neutral-50 text-neutral-400",
}

function initials(name: string | null, email: string): string {
  const base = name?.trim() || email
  return base.slice(0, 2).toUpperCase()
}
function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
</script>

<template>
  <tr class="border-t hover:bg-neutral-50 cursor-pointer" @click="emit('open')">
    <td class="p-2" @click.stop>
      <input type="checkbox" :checked="checked" @change="emit('toggle-check')" />
    </td>
    <td class="p-2">
      <span
        :class="[PRIORITY_COLOR[report.priority], 'px-2 py-0.5 rounded text-xs uppercase font-semibold']"
      >{{ report.priority }}</span>
    </td>
    <td class="p-2 font-medium truncate max-w-md">{{ report.title }}</td>
    <td class="p-2">
      <span v-if="report.assignee" class="inline-flex items-center gap-1 text-xs">
        <span
          class="w-5 h-5 rounded-full bg-neutral-200 text-neutral-700 flex items-center justify-center text-[10px] font-semibold"
        >{{ initials(report.assignee.name, report.assignee.email) }}</span>
        <span class="truncate max-w-[8rem]">{{ report.assignee.name ?? report.assignee.email }}</span>
      </span>
      <span v-else class="text-neutral-400 text-xs">—</span>
    </td>
    <td class="p-2 text-xs text-neutral-500 whitespace-nowrap">{{ relTime(report.updatedAt) }}</td>
  </tr>
</template>
```

- [ ] **Step 2: Verify**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/inbox/report-row.vue
git commit -m "feat(dashboard): add report-row component for the inbox list"
```

---

### Task 20: `bulk-action-bar.vue` component

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/inbox/bulk-action-bar.vue`

- [ ] **Step 1: Create**

```vue
<!-- apps/dashboard/app/components/inbox/bulk-action-bar.vue -->
<script setup lang="ts">
import type { ReportStatus } from "@feedback-tool/shared"

interface AssigneeOption {
  value: string | null
  label: string
}
interface Props {
  count: number
  assigneeOptions: AssigneeOption[]
  submitting: boolean
}
defineProps<Props>()
const emit = defineEmits<{
  status: [ReportStatus]
  assign: [string | null]
  clear: []
}>()

const STATUS_OPTIONS: ReportStatus[] = ["open", "in_progress", "resolved", "closed"]
</script>

<template>
  <div
    v-if="count > 0"
    class="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-neutral-900 text-white rounded-lg shadow-xl flex items-center gap-3 px-3 py-2 text-sm"
  >
    <span class="font-semibold">{{ count }} selected</span>
    <select
      class="bg-neutral-800 rounded px-2 py-1"
      :disabled="submitting"
      @change="emit('status', ($event.target as HTMLSelectElement).value as ReportStatus)"
    >
      <option value="" disabled selected>Status…</option>
      <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option>
    </select>
    <select
      class="bg-neutral-800 rounded px-2 py-1"
      :disabled="submitting"
      @change="emit('assign', (($event.target as HTMLSelectElement).value || null) as string | null)"
    >
      <option value="" disabled selected>Assign…</option>
      <option v-for="opt in assigneeOptions" :key="opt.value ?? '__none'" :value="opt.value ?? ''">
        {{ opt.label }}
      </option>
    </select>
    <button
      type="button"
      class="text-neutral-400 hover:text-white px-2"
      :disabled="submitting"
      @click="emit('clear')"
    >
      ✕ Clear
    </button>
  </div>
</template>
```

- [ ] **Step 2: Verify**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/inbox/bulk-action-bar.vue
git commit -m "feat(dashboard): add bulk-action-bar component"
```

---

### Task 21: Rewrite `reports.vue` — wire everything together

**Files:**
- Rewrite: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/projects/[id]/reports.vue`

- [ ] **Step 1: Replace the file**

```vue
<!-- apps/dashboard/app/pages/projects/[id]/reports.vue -->
<script setup lang="ts">
import type { ReportPriority, ReportStatus, ReportSummaryDTO } from "@feedback-tool/shared"
import ReportDrawer from "~/components/report-drawer/drawer.vue"
import StatusTabs from "~/components/inbox/status-tabs.vue"
import FacetSidebar from "~/components/inbox/facet-sidebar.vue"
import SearchSort from "~/components/inbox/search-sort.vue"
import ReportRow from "~/components/inbox/report-row.vue"
import BulkActionBar from "~/components/inbox/bulk-action-bar.vue"
import { useInboxQuery } from "~/composables/use-inbox-query"

const route = useRoute()
const projectId = computed(() => route.params.id as string)
const { data: session } = useSession()
const sessionUserId = computed(() => session.value?.user.id ?? "")

const { query, update, toApi } = useInboxQuery()

const listUrl = computed(() => `/api/projects/${projectId.value}/reports?${toApi()}`)
const { data, refresh } = useApi<{
  items: ReportSummaryDTO[]
  total: number
  facets: {
    status: Record<ReportStatus, number>
    priority: Record<ReportPriority, number>
    assignees: Array<{ id: string | null; name: string | null; email: string | null; count: number }>
    tags: Array<{ name: string; count: number }>
  }
}>(listUrl, { watch: [listUrl] })

const selected = ref<ReportSummaryDTO | null>(null)
const checked = ref<Set<string>>(new Set())
const submittingBulk = ref(false)

function toggleCheck(id: string) {
  if (checked.value.has(id)) checked.value.delete(id)
  else checked.value.add(id)
  checked.value = new Set(checked.value)
}
function clearSelection() {
  checked.value = new Set()
}
async function bulkStatus(status: ReportStatus) {
  submittingBulk.value = true
  try {
    await $fetch(`/api/projects/${projectId.value}/reports/bulk-update`, {
      method: "POST",
      body: { reportIds: [...checked.value], status },
      credentials: "include",
    })
    clearSelection()
    await refresh()
  } finally {
    submittingBulk.value = false
  }
}
async function bulkAssign(assigneeId: string | null) {
  submittingBulk.value = true
  try {
    await $fetch(`/api/projects/${projectId.value}/reports/bulk-update`, {
      method: "POST",
      body: { reportIds: [...checked.value], assigneeId },
      credentials: "include",
    })
    clearSelection()
    await refresh()
  } finally {
    submittingBulk.value = false
  }
}

const assigneeOptions = computed(() => {
  const opts: Array<{ value: string | null; label: string }> = [
    { value: null, label: "Unassign" },
    { value: sessionUserId.value, label: "Me" },
  ]
  for (const a of data.value?.facets.assignees ?? []) {
    if (a.id && a.id !== sessionUserId.value) {
      opts.push({ value: a.id, label: a.name ?? a.email ?? a.id })
    }
  }
  return opts
})
</script>

<template>
  <div class="space-y-3">
    <header class="flex items-baseline justify-between">
      <h1 class="text-2xl font-semibold">Reports</h1>
      <span class="text-sm text-neutral-500">{{ data?.total ?? 0 }} matches</span>
    </header>

    <StatusTabs
      :selected="query.status as ReportStatus[]"
      :counts="data?.facets.status ?? ({} as Record<ReportStatus, number>)"
      :total="data?.total ?? 0"
      @change="update({ status: $event })"
    />

    <div class="grid grid-cols-1 xl:grid-cols-[220px_1fr] gap-3">
      <FacetSidebar
        :priority-counts="data?.facets.priority ?? ({} as Record<ReportPriority, number>)"
        :assignees="data?.facets.assignees ?? []"
        :tags="data?.facets.tags ?? []"
        :selected-priority="query.priority as ReportPriority[]"
        :selected-assignee="query.assignee"
        :selected-tags="query.tag"
        :session-user-id="sessionUserId"
        @priority="update({ priority: $event })"
        @assignee="update({ assignee: $event })"
        @tag="update({ tag: $event })"
      />

      <div class="bg-white border rounded">
        <SearchSort
          :query="query.q"
          :sort="query.sort"
          @update:query="update({ q: $event })"
          @update:sort="update({ sort: $event })"
        />
        <div v-if="!data?.items?.length" class="p-8 text-center text-sm text-neutral-500">
          No reports match these filters.
        </div>
        <table v-else class="w-full text-sm">
          <tbody>
            <ReportRow
              v-for="r in data.items"
              :key="r.id"
              :report="r"
              :checked="checked.has(r.id)"
              @toggle-check="toggleCheck(r.id)"
              @open="selected = r"
            />
          </tbody>
        </table>
      </div>
    </div>

    <BulkActionBar
      :count="checked.size"
      :assignee-options="assigneeOptions"
      :submitting="submittingBulk"
      @status="bulkStatus"
      @assign="bulkAssign"
      @clear="clearSelection"
    />

    <ReportDrawer
      v-if="selected"
      :project-id="projectId"
      :report="selected"
      @close="selected = null; refresh()"
    />
  </div>
</template>
```

- [ ] **Step 2: Verify nuxt prepare + build**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt build 2>&1 | tail -5
```

Expected: build succeeds, no new tsc errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/pages/projects/[id]/reports.vue
git commit -m "feat(dashboard): rewrite reports page as faceted triage inbox"
```

---

## Phase 6 — Drawer additions

### Task 22: `triage-panel.vue` component

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/report-drawer/triage-panel.vue`

- [ ] **Step 1: Create**

```vue
<!-- apps/dashboard/app/components/report-drawer/triage-panel.vue -->
<script setup lang="ts">
import type {
  ReportPriority,
  ReportStatus,
  ReportSummaryDTO,
} from "@feedback-tool/shared"

interface Member {
  userId: string
  name: string | null
  email: string
}
interface Props {
  projectId: string
  report: ReportSummaryDTO
  canEdit: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{ patched: [] }>()

const STATUSES: ReportStatus[] = ["open", "in_progress", "resolved", "closed"]
const PRIORITIES: ReportPriority[] = ["urgent", "high", "normal", "low"]
const STATUS_COLOR: Record<ReportStatus, string> = {
  open: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  resolved: "bg-green-100 text-green-800",
  closed: "bg-neutral-200 text-neutral-700",
}
const PRIORITY_COLOR: Record<ReportPriority, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  normal: "bg-neutral-100 text-neutral-600",
  low: "bg-neutral-50 text-neutral-400",
}

const { data: members } = useApi<Member[]>(
  `/api/projects/${props.projectId}/members?role=developer,owner`,
)

const tagDraft = ref("")
const posting = ref(false)

async function patch(body: Record<string, unknown>) {
  posting.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/reports/${props.report.id}`, {
      method: "PATCH",
      body,
      credentials: "include",
    })
    emit("patched")
  } finally {
    posting.value = false
  }
}

async function addTag() {
  const name = tagDraft.value.trim()
  if (!name || props.report.tags.includes(name)) {
    tagDraft.value = ""
    return
  }
  tagDraft.value = ""
  await patch({ tags: [...props.report.tags, name] })
}
async function removeTag(name: string) {
  await patch({ tags: props.report.tags.filter((t) => t !== name) })
}
</script>

<template>
  <div class="p-3 border-b space-y-2 text-sm">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-xs uppercase text-neutral-500">Status</span>
      <select
        :value="report.status"
        :disabled="!canEdit || posting"
        class="rounded px-2 py-0.5 text-xs font-semibold"
        :class="STATUS_COLOR[report.status]"
        @change="patch({ status: ($event.target as HTMLSelectElement).value })"
      >
        <option v-for="s in STATUSES" :key="s" :value="s">{{ s.replace("_", " ") }}</option>
      </select>

      <span class="text-xs uppercase text-neutral-500 ml-2">Priority</span>
      <select
        :value="report.priority"
        :disabled="!canEdit || posting"
        class="rounded px-2 py-0.5 text-xs uppercase font-semibold"
        :class="PRIORITY_COLOR[report.priority]"
        @change="patch({ priority: ($event.target as HTMLSelectElement).value })"
      >
        <option v-for="p in PRIORITIES" :key="p" :value="p">{{ p }}</option>
      </select>

      <span class="text-xs uppercase text-neutral-500 ml-2">Assignee</span>
      <select
        :value="report.assignee?.id ?? ''"
        :disabled="!canEdit || posting"
        class="rounded px-2 py-0.5 text-xs border"
        @change="
          patch({
            assigneeId: ($event.target as HTMLSelectElement).value || null,
          })
        "
      >
        <option value="">Unassigned</option>
        <option v-for="m in members ?? []" :key="m.userId" :value="m.userId">
          {{ m.name ?? m.email }}
        </option>
      </select>
    </div>

    <div class="flex flex-wrap items-center gap-1">
      <span class="text-xs uppercase text-neutral-500 mr-1">Tags</span>
      <span
        v-for="t in report.tags"
        :key="t"
        class="inline-flex items-center gap-1 bg-neutral-100 rounded px-2 py-0.5 text-xs"
      >
        {{ t }}
        <button v-if="canEdit" type="button" class="text-neutral-400 hover:text-neutral-900" @click="removeTag(t)">
          ×
        </button>
      </span>
      <input
        v-if="canEdit"
        v-model="tagDraft"
        class="border rounded px-2 py-0.5 text-xs w-24"
        placeholder="+ tag"
        @keydown.enter.prevent="addTag"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 2: Verify**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/report-drawer/triage-panel.vue
git commit -m "feat(dashboard): add triage-panel with status/priority/assignee/tags editors"
```

---

### Task 23: `activity-tab.vue` component

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/report-drawer/activity-tab.vue`

- [ ] **Step 1: Create**

```vue
<!-- apps/dashboard/app/components/report-drawer/activity-tab.vue -->
<script setup lang="ts">
import type { ReportEventDTO, ReportSummaryDTO } from "@feedback-tool/shared"

interface Props {
  projectId: string
  report: ReportSummaryDTO
}
const props = defineProps<Props>()

const { data, refresh } = useApi<{ items: ReportEventDTO[]; total: number }>(
  `/api/projects/${props.projectId}/reports/${props.report.id}/events?limit=50`,
)

defineExpose({ refresh })

function summary(e: ReportEventDTO): string {
  const p = e.payload as Record<string, unknown>
  switch (e.kind) {
    case "status_changed":
      return `changed status ${String(p.from)} → ${String(p.to)}`
    case "priority_changed":
      return `set priority ${String(p.to)} (was ${String(p.from)})`
    case "assignee_changed": {
      const from = p.from ? "someone" : "nobody"
      const to = p.to ? "someone" : "nobody"
      return `reassigned from ${from} to ${to}`
    }
    case "tag_added":
      return `added tag ${String(p.name)}`
    case "tag_removed":
      return `removed tag ${String(p.name)}`
    default:
      return e.kind
  }
}
function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
function actorLabel(e: ReportEventDTO): string {
  return e.actor?.name ?? e.actor?.email ?? "System"
}
</script>

<template>
  <div class="p-3 text-sm space-y-2">
    <div v-if="!data?.items?.length" class="text-neutral-500">No activity yet.</div>
    <ul v-else class="space-y-2">
      <li v-for="e in data.items" :key="e.id" class="flex items-start gap-2">
        <span
          class="w-6 h-6 rounded-full bg-neutral-200 text-neutral-700 flex items-center justify-center text-[10px] font-semibold"
        >
          {{ actorLabel(e).slice(0, 2).toUpperCase() }}
        </span>
        <div class="flex-1">
          <div>
            <span class="font-semibold">{{ actorLabel(e) }}</span>
            <span class="text-neutral-600"> {{ summary(e) }}</span>
          </div>
          <div class="text-xs text-neutral-400">{{ relTime(e.createdAt) }}</div>
        </div>
      </li>
    </ul>
  </div>
</template>
```

- [ ] **Step 2: Verify**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/report-drawer/activity-tab.vue
git commit -m "feat(dashboard): add activity-tab component for event feed"
```

---

### Task 24: Wire triage panel + Activity tab into the existing drawer

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/report-drawer/drawer.vue`

- [ ] **Step 1: Read the current drawer**

```bash
cat /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/report-drawer/drawer.vue
```

- [ ] **Step 2: Replace the file with the updated version**

```vue
<!-- apps/dashboard/app/components/report-drawer/drawer.vue -->
<script setup lang="ts">
import type { LogsAttachment, ReportSummaryDTO } from "@feedback-tool/shared"
import ActivityTab from "./activity-tab.vue"
import ConsoleTab from "./console-tab.vue"
import CookiesTab from "./cookies-tab.vue"
import NetworkTab from "./network-tab.vue"
import OverviewTab from "./overview-tab.vue"
import Tabs from "./tabs.vue"
import TriagePanel from "./triage-panel.vue"

const props = defineProps<{ projectId: string; report: ReportSummaryDTO }>()
const emit = defineEmits<{ close: [] }>()

type TabName = "activity" | "overview" | "console" | "network" | "cookies"
const activeTab = ref<TabName>("activity")
const logs = ref<LogsAttachment | null>(null)
const logsLoaded = ref(false)

// Local report copy so triage-panel updates feel instant. Re-sync when parent
// passes a new report.
const current = ref<ReportSummaryDTO>(props.report)
watch(
  () => props.report.id,
  () => {
    current.value = props.report
  },
)

// Role check for edit permission. Viewer-only users see read-only pills.
const { data: meRole } = useApi<{ role: string }>(
  `/api/projects/${props.projectId}/me`,
  { default: () => ({ role: "viewer" }) },
)
const canEdit = computed(() => meRole.value?.role !== "viewer")

async function ensureLogs() {
  if (logsLoaded.value) return
  logsLoaded.value = true
  const res = await $fetch<LogsAttachment>(
    `/api/projects/${props.projectId}/reports/${props.report.id}/attachment?kind=logs`,
    { credentials: "include" },
  ).catch(() => null)
  logs.value = res ?? null
}

watch(activeTab, (t) => {
  if (t === "console" || t === "network" || t === "cookies") ensureLogs()
})

const activityRef = ref<InstanceType<typeof ActivityTab> | null>(null)
async function onPatched() {
  const fresh = await $fetch<{
    items: Array<ReportSummaryDTO & { id: string }>
  }>(`/api/projects/${props.projectId}/reports?limit=50`, { credentials: "include" })
  const row = fresh.items.find((r) => r.id === current.value.id)
  if (row) current.value = row
  if (activityRef.value) await activityRef.value.refresh()
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close")
    return
  }
  if (e.key === "1") activeTab.value = "activity"
  if (e.key === "2") activeTab.value = "overview"
  if (e.key === "3") activeTab.value = "console"
  if (e.key === "4") activeTab.value = "network"
  if (e.key === "5") activeTab.value = "cookies"
}
onMounted(() => window.addEventListener("keydown", onKey))
onUnmounted(() => window.removeEventListener("keydown", onKey))
</script>

<template>
  <div class="fixed inset-0 bg-black/40 z-50" @click="emit('close')">
    <aside
      class="absolute right-0 top-0 h-full w-[720px] max-w-full bg-white shadow-2xl overflow-y-auto"
      @click.stop
    >
      <header class="p-4 border-b flex items-center justify-between">
        <h2 class="font-semibold truncate">{{ current.title }}</h2>
        <button type="button" class="text-neutral-500" @click="emit('close')">Close</button>
      </header>
      <TriagePanel
        :project-id="projectId"
        :report="current"
        :can-edit="canEdit"
        @patched="onPatched"
      />
      <Tabs :active-tab="activeTab" :logs="logs" @change="activeTab = $event" />
      <ActivityTab
        v-if="activeTab === 'activity'"
        ref="activityRef"
        :project-id="projectId"
        :report="current"
      />
      <OverviewTab
        v-else-if="activeTab === 'overview'"
        :project-id="projectId"
        :report="current"
      />
      <ConsoleTab v-else-if="activeTab === 'console'" :logs="logs" />
      <NetworkTab v-else-if="activeTab === 'network'" :logs="logs" />
      <CookiesTab v-else-if="activeTab === 'cookies'" :project-id="projectId" :report="current" />
    </aside>
  </div>
</template>
```

- [ ] **Step 3: Update `tabs.vue` to include the Activity tab**

Modify `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/report-drawer/tabs.vue`:

Change the `Props.activeTab` union to include `"activity"` and prepend `"activity"` to the tab loop. Full replacement:

```vue
<!-- apps/dashboard/app/components/report-drawer/tabs.vue -->
<script setup lang="ts">
import type { LogsAttachment } from "@feedback-tool/shared"

interface Props {
  activeTab: "activity" | "overview" | "console" | "network" | "cookies"
  logs: LogsAttachment | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ change: [tab: Props["activeTab"]] }>()

const consoleCount = computed(() =>
  props.logs ? props.logs.console.length + props.logs.breadcrumbs.length : null,
)
const networkCount = computed(() => (props.logs ? props.logs.network.length : null))
const networkErrors = computed(() =>
  props.logs
    ? props.logs.network.filter((n) => n.status === null || (n.status && n.status >= 400)).length
    : 0,
)
</script>

<template>
  <nav class="flex gap-4 border-b px-4 text-sm">
    <button
      v-for="tab in ['activity', 'overview', 'console', 'network', 'cookies'] as const"
      :key="tab"
      type="button"
      class="py-2 capitalize border-b-2 -mb-px"
      :class="
        activeTab === tab
          ? 'border-neutral-900 font-semibold'
          : 'border-transparent text-neutral-500 hover:text-neutral-900'
      "
      @click="emit('change', tab)"
    >
      {{ tab }}
      <span
        v-if="tab === 'console' && consoleCount !== null"
        class="ml-1 text-xs text-neutral-500"
      >· {{ consoleCount }}</span>
      <span
        v-if="tab === 'network' && networkCount !== null"
        class="ml-1 text-xs text-neutral-500"
      >
        · {{ networkCount }}
        <span v-if="networkErrors > 0" class="text-red-600">· {{ networkErrors }}✗</span>
      </span>
    </button>
  </nav>
</template>
```

- [ ] **Step 4: Add the `/api/projects/:id/me` endpoint so the drawer can check role**

Create `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/me.get.ts`:

```ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { requireProjectRole } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const { effectiveRole } = await requireProjectRole(event, id, "viewer")
  return { role: effectiveRole }
})
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/report-drawer/drawer.vue \
        apps/dashboard/app/components/report-drawer/tabs.vue \
        apps/dashboard/server/api/projects/[id]/me.get.ts
git commit -m "feat(dashboard): wire triage panel + Activity tab into drawer"
```

---

## Phase 7 — Gate + docs

### Task 25: Threat model append + tag v0.5.0-inbox

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/docs/superpowers/security/threat-model.md`

- [ ] **Step 1: Append the F section**

Open `docs/superpowers/security/threat-model.md` and append (after the "Known deferrals" section):

```markdown
## Sub-project F — Ticket inbox

- **Mutation authorization.** Every `PATCH /reports/:id` and `POST /reports/bulk-update` calls `requireProjectRole(event, id, 'developer')`. Viewers get 403. Tested.
- **Assignee scoping.** The picker + validation constrain assignees to `developer` / `owner` members of the same project. Assigning to a viewer (or a user from another project) returns 400. Tested.
- **Concurrent writes.** Last-write-wins on `PATCH`. Two admins racing to change status = whichever hits the DB second wins. The events log records both transitions in order, so the history is intact even if the final state reflects only the last writer.
- **Event log integrity.** Mutation + event inserts share a single DB transaction. Either all events for a mutation land or none; no ghost events.
- **Search performance.** ILIKE on title + description without a trigram index is acceptable up to ~10k reports per project. Follow-up: add `pg_trgm` + GIN on `lower(title || ' ' || coalesce(description, ''))` once real installs need it.
- **DoS mitigation.** Query-param arrays capped at 10 values per key; `q` ≤200 chars; `reportIds` ≤100; `limit` ≤100.
```

- [ ] **Step 2: Run the full gate**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run check 2>&1 | tail -3
(cd apps/dashboard && bun test tests/lib/inbox-query.test.ts 2>&1 | tail -5)
lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_events, report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE" >/dev/null 2>&1 || true
(cd apps/dashboard && bun test 2>&1 | tail -10)
```

Expected:
- `bun run check` → 0 errors (19 pre-existing warnings are fine).
- Unit tests (inbox-query): 17 pass.
- Dashboard integration tests: all pass (12 new inbox + previous intake + members + logs-intake).

- [ ] **Step 3: Manual smoke walk**

Document the outcome below in the commit message and proceed only after all four pass:

1. **URL round-trip.** Open the dashboard, navigate to a project's reports, apply 2-3 filters (e.g., status=open, priority=high, assignee=me, q="crash"). Copy the URL. Open in a new tab. All filters are pre-selected.
2. **Triage single report.** Open a report, change status → in_progress via the drawer's triage panel, change priority → high, assign to another developer, add a tag `mobile`. Open the Activity tab; four events appear in reverse-chrono with actor "me".
3. **Bulk close 3 reports.** Select 3 rows via checkboxes, click the "Status" dropdown in the bulk bar → Closed. Rows vanish from the Open tab; the Closed tab count jumps by 3; each of the 3 reports has a `status_changed` event.
4. **Viewer lockdown.** Sign out; sign in as a `viewer` of the same project. Reports load, but triage pills are disabled + no bulk checkboxes render. Attempting a direct `PATCH` via DevTools returns 403.

- [ ] **Step 4: Commit + tag**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add docs/superpowers/security/threat-model.md
git commit -m "docs(security): document sub-project F threat model additions"

git tag -a v0.5.0-inbox -m "Sub-project F complete: ticket inbox

- Schema: status/assignee_id/priority/tags/updated_at on reports + report_events
  table for the activity log.
- API: extended list endpoint (filters + facets + search + sort), PATCH and
  bulk-update mutation endpoints, events feed, members role filter.
- UI: faceted three-column inbox (sidebar / list / drawer). Drawer gains pinned
  triage panel + Activity tab prepended to D's existing tabs.
- Activity log auto-records status/assignee/priority/tag changes — no user
  comments in v1 (deferred to future collab pass).
- 12 integration tests + 17 unit tests. All green.
- Dashboard-only change; no SDK bundle impact."

git tag | tail -5
```

---

## Self-review

### Spec coverage

| Spec section | Task(s) |
| --- | --- |
| §2 locked decisions — 4 statuses, developer+ assignees, priority+tags, facet sidebar, activity log only, bulk status+assignee, TanStack polling, viewer/developer roles | Task 1 (schema), Task 4 (shared enums), Tasks 10/11 (role-scoped PATCH+bulk), Task 21 (facet sidebar), Task 22 (triage panel) |
| §5.1 reports column extensions | Task 1 |
| §5.2 report_events | Task 2 |
| §5.3 indexes | Task 1 + Task 2 |
| §5.4 DTO shapes | Task 4 |
| §6.1 extended list endpoint + facets | Task 9 |
| §6.2 PATCH single | Task 10 |
| §6.3 bulk-update | Task 11 |
| §6.4 events feed | Task 12 |
| §6.5 members role filter | Task 13 |
| §7.1 inbox page + URL state | Task 15 (composable) + Tasks 16-21 (components + page rewrite) |
| §7.2 drawer triage panel + Activity tab | Tasks 22-24 |
| §7.3 permissions | Task 22 (canEdit prop) + Task 24 (/me endpoint) |
| §7.4 polling | Task 21 (useApi + watch) |
| §8.1 integration tests | Task 14 |
| §8.2 unit tests | Tasks 5-7 (diffTags / resolveAssigneeFilter / buildSortClause) |
| §8.4 manual smoke | Task 25 |
| §9 threat model append | Task 25 |
| §10 done criteria + tag | Task 25 |

### Placeholder scan

Plan contains no "TBD", no "implement later", no bare "handle edge cases". Every code step has runnable code.

### Type consistency

- `ReportStatus` / `ReportPriority` / `ProjectMemberRole` Zod enums defined once in Task 4, imported by Tasks 9-13 + Tasks 16-24.
- `ReportSummaryDTO` shape set in Task 4; producers (Task 9) + consumers (Tasks 19, 21, 22, 23, 24) align.
- `ReportEventDTO` shape set in Task 4; producer (Task 12) + consumer (Task 23).
- `TriagePatchInput` / `BulkUpdateInput` defined once (Task 4), consumed by Tasks 10 + 11.
- `buildReportEvents` signature consistent between single-PATCH (Task 10) and bulk-update (Task 11) callers.
