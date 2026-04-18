# GitHub Issues Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-create GitHub issues for every dashboard report and keep status synchronized between both systems. Dashboard triage edits (priority, tags) flow outbound as GitHub labels; GitHub-side close/reopen events flow inbound to dashboard status.

**Architecture:** Pure adapter package at `packages/integrations/github/` (Octokit + pure HMAC verification). Dashboard has a thin `server/lib/github.ts` shim that reads env vars and constructs adapter clients. A durable Postgres-backed sync queue (`report_sync_jobs`) is drained by a Nitro scheduled task every 10 seconds with exponential backoff. Inbound webhook handler at `/api/integrations/github/webhook` is HMAC-verified. One GitHub App replaces the existing OAuth App and serves both better-auth sign-in AND repo installations.

**Tech Stack:** Drizzle ORM + Postgres 17, Nuxt 4 / Nitro scheduled tasks, `@octokit/rest` + `@octokit/auth-app`, existing better-auth (GitHub provider), Zod, Tailwind v4, Bun for tooling.

**Reference spec:** `docs/superpowers/specs/2026-04-18-github-sync-design.md`

**Baseline:** tag `v0.5.1-inbox-demokey`. Dashboard-only changes; SDK bundle unchanged.

---

## File map

```
packages/integrations/github/                           CREATE — workspace package
├── package.json
├── tsconfig.json
└── src/
    ├── signature.ts                                   pure HMAC verifier
    ├── client.ts                                      Octokit-backed InstallationClient
    ├── types.ts                                       shared interface + types
    └── index.ts                                       barrel

apps/dashboard/server/
├── db/schema/
│   ├── reports.ts                                     MODIFY — add github_* columns
│   ├── report-events.ts                               MODIFY — add 'github_unlinked' kind
│   └── github-integrations.ts                         CREATE — github_integrations + report_sync_jobs
├── db/migrations/NNNN_github_sync.sql                 GENERATE
├── lib/
│   ├── github.ts                                      CREATE — env reader + adapter factory
│   ├── signed-attachment-url.ts                       CREATE — HMAC signer for screenshot URLs
│   ├── github-reconcile.ts                            CREATE — reconcileReport() pure function
│   └── github-helpers.ts                              CREATE — computeBackoff + labelsFor + buildIssueBody
├── api/
│   ├── integrations/github/
│   │   ├── webhook.post.ts                            CREATE
│   │   └── install-callback.get.ts                    CREATE
│   └── projects/[id]/
│       ├── integrations/github/
│       │   ├── index.get.ts                           CREATE
│       │   ├── index.patch.ts                         CREATE
│       │   ├── install-redirect.post.ts               CREATE
│       │   ├── disconnect.post.ts                     CREATE
│       │   └── retry-failed.post.ts                   CREATE
│       └── reports/[reportId]/
│           ├── attachment.get.ts                      MODIFY — accept signed token
│           ├── github-sync.post.ts                    CREATE
│           └── github-unlink.post.ts                  CREATE
├── tasks/
│   └── github-sync.ts                                 CREATE — Nitro scheduled task

apps/dashboard/tests/
├── lib/
│   ├── github-helpers.test.ts                         CREATE — unit tests for pure helpers
│   └── signed-attachment-url.test.ts                  CREATE — unit tests
└── api/
    └── github-sync.test.ts                            CREATE — 20 integration tests

apps/dashboard/app/
├── pages/projects/[id]/settings.vue                   MODIFY — add GitHub tab
├── components/integrations/github/
│   ├── github-panel.vue                               CREATE — main 4-state panel
│   ├── sync-status.vue                                CREATE — failed-jobs table
│   ├── repo-picker.vue                                CREATE — installation repos dropdown
│   └── unlink-dialog.vue                              CREATE — confirm dialog
└── components/
    ├── report-drawer/triage-panel.vue                 MODIFY — add GitHub row
    └── inbox/report-row.vue                           MODIFY — GitHub badge

packages/shared/src/
└── github.ts                                          CREATE — shared Zod DTOs

docs/superpowers/security/threat-model.md              MODIFY — append §G section
```

---

## Phase 1 — Schema + migration

### Task 1: Extend `reports` + `report_events` schemas

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/reports.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/report-events.ts`

- [ ] **Step 1: Add 3 nullable github columns to `reports` table**

In `apps/dashboard/server/db/schema/reports.ts`, inside the `pgTable("reports", ...)` column block (after `updatedAt`), add:

```ts
    githubIssueNumber: integer("github_issue_number"),
    githubIssueNodeId: text("github_issue_node_id"),
    githubIssueUrl: text("github_issue_url"),
```

The existing `integer` and `text` imports are already in place.

- [ ] **Step 2: Add `github_unlinked` to the `report_events.kind` enum**

In `apps/dashboard/server/db/schema/report-events.ts`, change the `kind` column's `enum` array from:

```ts
    kind: text("kind", {
      enum: ["status_changed", "assignee_changed", "priority_changed", "tag_added", "tag_removed"],
    }).notNull(),
```

to:

```ts
    kind: text("kind", {
      enum: [
        "status_changed",
        "assignee_changed",
        "priority_changed",
        "tag_added",
        "tag_removed",
        "github_unlinked",
      ],
    }).notNull(),
```

- [ ] **Step 3: Verify tsc clean**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -5`
Expected: no NEW errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/db/schema/reports.ts apps/dashboard/server/db/schema/report-events.ts
git commit -m "feat(db): add github_issue_* columns on reports + github_unlinked event kind"
```

---

### Task 2: Create `github_integrations` and `report_sync_jobs` schemas

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/github-integrations.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/index.ts`

- [ ] **Step 1: Create the schema file**

```ts
// apps/dashboard/server/db/schema/github-integrations.ts
import { sql } from "drizzle-orm"
import { bigint, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { projects } from "./projects"
import { reports } from "./reports"

export const githubIntegrations = pgTable("github_integrations", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  installationId: bigint("installation_id", { mode: "number" }).notNull(),
  repoOwner: text("repo_owner").notNull().default(""),
  repoName: text("repo_name").notNull().default(""),
  defaultLabels: text("default_labels")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  defaultAssignees: text("default_assignees")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  status: text("status", { enum: ["connected", "disconnected"] })
    .notNull()
    .default("connected"),
  lastError: text("last_error"),
  connectedBy: text("connected_by"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const reportSyncJobs = pgTable(
  "report_sync_jobs",
  {
    reportId: uuid("report_id")
      .primaryKey()
      .references(() => reports.id, { onDelete: "cascade" }),
    state: text("state", { enum: ["pending", "syncing", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pendingIdx: index("report_sync_jobs_pending_idx")
      .on(table.nextAttemptAt)
      .where(sql`${table.state} = 'pending'`),
  }),
)

export type GithubIntegration = typeof githubIntegrations.$inferSelect
export type NewGithubIntegration = typeof githubIntegrations.$inferInsert
export type ReportSyncJob = typeof reportSyncJobs.$inferSelect
export type NewReportSyncJob = typeof reportSyncJobs.$inferInsert
```

Notes:
- `connectedBy` has no `.references()` chain because cross-schema FKs to better-auth's `user` table cause drizzle-kit friction (same pattern as F's `assignee_id`). The FK is added in the migration SQL manually.
- `repo_owner` and `repo_name` default to empty string so the install callback can create the row before the admin has picked a repo.

- [ ] **Step 2: Re-export from the schema barrel**

Edit `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/index.ts` — append:

```ts
export * from "./github-integrations"
```

Full file contents should become:

```ts
export * from "./auth-schema"
export * from "./projects"
export * from "./project-members"
export * from "./app-settings"
export * from "./reports"
export * from "./report-events"
export * from "./github-integrations"
```

- [ ] **Step 3: Verify tsc clean**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -5`
Expected: no NEW errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/db/schema/github-integrations.ts apps/dashboard/server/db/schema/index.ts
git commit -m "feat(db): add github_integrations and report_sync_jobs tables"
```

---

### Task 3: Generate + apply migration

**Files:**
- Create: `apps/dashboard/server/db/migrations/NNNN_github_sync.sql` (drizzle-kit picks the filename)

- [ ] **Step 1: Generate the migration**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run db:gen 2>&1 | tail -15
```

Expected: a new `.sql` file appears in `apps/dashboard/server/db/migrations/` with ALTER TABLE + CREATE TABLE statements, plus an updated `meta/_journal.json` and new snapshot JSON.

- [ ] **Step 2: Inspect + append manual FK constraint**

```bash
NEW_SQL=$(ls -t /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/migrations/*.sql | head -1)
echo "=== $NEW_SQL ==="
cat "$NEW_SQL"
```

Verify it contains:
- `ALTER TABLE "reports" ADD COLUMN "github_issue_number" ...` (+ node_id, url)
- `CREATE TABLE ... "github_integrations"` with all columns + default arrays
- `CREATE TABLE ... "report_sync_jobs"` with PK on report_id
- `CREATE INDEX "report_sync_jobs_pending_idx" ... WHERE state = 'pending'`
- Check constraints on `status` (connected/disconnected) and `state` (pending/syncing/failed)
- The `kind` check constraint on `report_events` was re-generated with `github_unlinked`

Append the cross-schema FK for `connected_by` → `user(id)`:

```bash
cat >> "$NEW_SQL" <<'EOF'
--> statement-breakpoint
ALTER TABLE "github_integrations" ADD CONSTRAINT "github_integrations_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "user"("id") ON DELETE SET NULL;
EOF
```

- [ ] **Step 3: Apply**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run db:push 2>&1 | tail -10
```

Expected: applied without error. Because `drizzle-kit push` regenerates from the schema diff (not the SQL file), the manually-appended FK constraint may not land automatically. Apply it directly:

```bash
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "ALTER TABLE github_integrations ADD CONSTRAINT github_integrations_connected_by_user_id_fk FOREIGN KEY (connected_by) REFERENCES \"user\"(id) ON DELETE SET NULL" 2>&1 || echo "(FK may already exist)"
```

- [ ] **Step 4: Verify in Postgres**

```bash
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "\d reports" | grep -E "github_issue"
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "\d github_integrations"
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "\d report_sync_jobs"
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "\di report_sync_jobs_pending_idx"
```

Expected:
- `reports` has `github_issue_number`, `github_issue_node_id`, `github_issue_url` columns
- `github_integrations` table with FK to `projects(id)` CASCADE and FK to `user(id)` SET NULL
- `report_sync_jobs` with PK on report_id + partial index `report_sync_jobs_pending_idx`

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/db/migrations/
git commit -m "feat(db): migration — github sync schema (integrations + sync jobs + reports.github_issue_*)"
```

---

## Phase 2 — Pure primitives (TDD)

### Task 4: `computeBackoff` helper

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/github-helpers.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/lib/github-helpers.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/dashboard/tests/lib/github-helpers.test.ts
import { describe, expect, test } from "bun:test"
import { computeBackoff } from "../../server/lib/github-helpers"

describe("computeBackoff", () => {
  test("attempt 1 → 10 seconds", () => {
    expect(computeBackoff(1)).toBe(10_000)
  })
  test("attempt 2 → 30 seconds", () => {
    expect(computeBackoff(2)).toBe(30_000)
  })
  test("attempt 3 → 2 minutes", () => {
    expect(computeBackoff(3)).toBe(120_000)
  })
  test("attempt 4 → 10 minutes", () => {
    expect(computeBackoff(4)).toBe(600_000)
  })
  test("attempt 5 → 1 hour", () => {
    expect(computeBackoff(5)).toBe(3_600_000)
  })
  test("attempts > 5 cap at 1 hour", () => {
    expect(computeBackoff(99)).toBe(3_600_000)
  })
  test("attempts < 1 treated as 1", () => {
    expect(computeBackoff(0)).toBe(10_000)
  })
})
```

- [ ] **Step 2: Confirm fail**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/github-helpers.test.ts 2>&1 | tail -5
```

Expected: module not found.

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/server/lib/github-helpers.ts
const BACKOFF_MS = [10_000, 30_000, 120_000, 600_000, 3_600_000] as const

export function computeBackoff(attempts: number): number {
  const idx = Math.max(0, Math.min(attempts - 1, BACKOFF_MS.length - 1))
  return BACKOFF_MS[idx]
}
```

- [ ] **Step 4: Confirm 7/7 PASS**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/github-helpers.test.ts 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/github-helpers.ts apps/dashboard/tests/lib/github-helpers.test.ts
git commit -m "feat(dashboard): add computeBackoff helper for sync job retries"
```

---

### Task 5: `labelsFor` helper

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/github-helpers.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/lib/github-helpers.test.ts`

- [ ] **Step 1: Add failing tests at the end of the test file**

Append to `tests/lib/github-helpers.test.ts`:

```ts
import { labelsFor } from "../../server/lib/github-helpers"

describe("labelsFor", () => {
  test("combines defaults + priority prefix + tags verbatim, sorted", () => {
    const result = labelsFor(
      { priority: "urgent", tags: ["mobile", "checkout"] },
      { defaultLabels: ["feedback", "needs-triage"] },
    )
    expect(result).toEqual(["checkout", "feedback", "mobile", "needs-triage", "priority:urgent"])
  })
  test("dedupes when a tag clashes with a default label", () => {
    expect(
      labelsFor(
        { priority: "normal", tags: ["feedback"] },
        { defaultLabels: ["feedback"] },
      ),
    ).toEqual(["feedback", "priority:normal"])
  })
  test("empty tags + empty defaults still includes priority", () => {
    expect(labelsFor({ priority: "low", tags: [] }, { defaultLabels: [] })).toEqual([
      "priority:low",
    ])
  })
})
```

Also adjust the top import to pull both functions:

```ts
import { computeBackoff, labelsFor } from "../../server/lib/github-helpers"
```

(Replace the prior single import.)

- [ ] **Step 2: Confirm fail**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/github-helpers.test.ts 2>&1 | tail -5
```

Expected: 7 pass, 3 fail (labelsFor missing).

- [ ] **Step 3: Implement**

Append to `server/lib/github-helpers.ts`:

```ts
export interface LabelsForReport {
  priority: "low" | "normal" | "high" | "urgent"
  tags: readonly string[]
}

export interface LabelsForIntegration {
  defaultLabels: readonly string[]
}

export function labelsFor(report: LabelsForReport, integration: LabelsForIntegration): string[] {
  const seen = new Set<string>()
  const add = (s: string) => {
    if (!seen.has(s)) seen.add(s)
  }
  for (const l of integration.defaultLabels) add(l)
  add(`priority:${report.priority}`)
  for (const t of report.tags) add(t)
  return [...seen].sort()
}
```

- [ ] **Step 4: Confirm 10/10 PASS**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/github-helpers.test.ts 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/github-helpers.ts apps/dashboard/tests/lib/github-helpers.test.ts
git commit -m "feat(dashboard): add labelsFor helper (defaults + priority + tags → sorted labels)"
```

---

### Task 6: `buildIssueBody` helper

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/github-helpers.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/lib/github-helpers.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/lib/github-helpers.test.ts`:

```ts
import { buildIssueBody } from "../../server/lib/github-helpers"

describe("buildIssueBody", () => {
  const minimal = {
    id: "rid1",
    title: "Checkout crash",
    description: "it crashed on pay",
    pageUrl: "https://app.example.com/checkout",
    reporterEmail: "reporter@example.com",
    createdAt: new Date("2026-04-18T10:42:00Z"),
    screenshotUrl: "https://dash.example.com/api/projects/p1/reports/rid1/attachment?kind=screenshot&token=abc&expires=1",
    dashboardUrl: "https://dash.example.com/projects/p1/reports/rid1",
  }

  test("full body contains reporter, page, description, screenshot, footer", () => {
    const body = buildIssueBody(minimal)
    expect(body).toContain("reporter@example.com")
    expect(body).toContain("https://app.example.com/checkout")
    expect(body).toContain("it crashed on pay")
    expect(body).toContain("![Screenshot]")
    expect(body).toContain(minimal.screenshotUrl)
    expect(body).toContain(minimal.dashboardUrl)
  })
  test("no reporter → 'anonymous'", () => {
    const body = buildIssueBody({ ...minimal, reporterEmail: null })
    expect(body).toContain("anonymous")
    expect(body).not.toContain("**anonymous**")
  })
  test("no screenshot → no img tag", () => {
    const body = buildIssueBody({ ...minimal, screenshotUrl: null })
    expect(body).not.toContain("![Screenshot]")
  })
  test("no pageUrl → page line omitted", () => {
    const body = buildIssueBody({ ...minimal, pageUrl: "" })
    expect(body).not.toContain("Page:")
  })
  test("description empty string renders empty description section header", () => {
    const body = buildIssueBody({ ...minimal, description: "" })
    expect(body).toContain("## Description")
  })
})
```

And add `buildIssueBody` to the top import:

```ts
import { buildIssueBody, computeBackoff, labelsFor } from "../../server/lib/github-helpers"
```

- [ ] **Step 2: Confirm fail**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/github-helpers.test.ts 2>&1 | tail -5
```

Expected: 10 pass, 5 fail.

- [ ] **Step 3: Implement**

Append to `server/lib/github-helpers.ts`:

```ts
export interface BuildIssueBodyInput {
  id: string
  title: string
  description: string
  pageUrl: string
  reporterEmail: string | null
  createdAt: Date
  screenshotUrl: string | null
  dashboardUrl: string
}

function fmtUtc(d: Date): string {
  const iso = d.toISOString()
  return iso.slice(0, 16).replace("T", " ") + " UTC"
}

export function buildIssueBody(input: BuildIssueBodyInput): string {
  const lines: string[] = []
  const reporter = input.reporterEmail ? `**${input.reporterEmail}**` : "anonymous"
  lines.push(`> Reported by ${reporter} via Feedback Tool`)
  if (input.pageUrl) lines.push(`> Page: ${input.pageUrl}`)
  lines.push(`> Captured: ${fmtUtc(input.createdAt)}`)
  lines.push("")
  lines.push("## Description")
  lines.push("")
  lines.push(input.description)
  if (input.screenshotUrl) {
    lines.push("")
    lines.push(`![Screenshot](${input.screenshotUrl})`)
  }
  lines.push("")
  lines.push("---")
  lines.push("")
  lines.push(
    `<sub>Full context (console, network, cookies, replay): ${input.dashboardUrl}</sub>`,
  )
  return lines.join("\n")
}
```

- [ ] **Step 4: Confirm 15/15 PASS**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/github-helpers.test.ts 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/github-helpers.ts apps/dashboard/tests/lib/github-helpers.test.ts
git commit -m "feat(dashboard): add buildIssueBody helper for GitHub issue markdown"
```

---

## Phase 3 — Signed attachment URL

### Task 7: `signed-attachment-url.ts` + tests

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/signed-attachment-url.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/lib/signed-attachment-url.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/dashboard/tests/lib/signed-attachment-url.test.ts
import { describe, expect, test } from "bun:test"
import { signAttachmentToken, verifyAttachmentToken } from "../../server/lib/signed-attachment-url"

const SECRET = "test-secret-0123456789abcdef"

describe("signed-attachment-url", () => {
  test("token round-trips with matching secret", () => {
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = signAttachmentToken({
      secret: SECRET,
      projectId: "p1",
      reportId: "r1",
      kind: "screenshot",
      expiresAt: expires,
    })
    expect(
      verifyAttachmentToken({
        secret: SECRET,
        projectId: "p1",
        reportId: "r1",
        kind: "screenshot",
        expiresAt: expires,
        token,
      }),
    ).toBe(true)
  })

  test("tampered token rejected", () => {
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = signAttachmentToken({
      secret: SECRET,
      projectId: "p1",
      reportId: "r1",
      kind: "screenshot",
      expiresAt: expires,
    })
    expect(
      verifyAttachmentToken({
        secret: SECRET,
        projectId: "p1",
        reportId: "r2",
        kind: "screenshot",
        expiresAt: expires,
        token,
      }),
    ).toBe(false)
  })

  test("wrong secret rejected", () => {
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = signAttachmentToken({
      secret: SECRET,
      projectId: "p1",
      reportId: "r1",
      kind: "screenshot",
      expiresAt: expires,
    })
    expect(
      verifyAttachmentToken({
        secret: "other-secret",
        projectId: "p1",
        reportId: "r1",
        kind: "screenshot",
        expiresAt: expires,
        token,
      }),
    ).toBe(false)
  })

  test("expired token rejected", () => {
    const expires = Math.floor(Date.now() / 1000) - 10
    const token = signAttachmentToken({
      secret: SECRET,
      projectId: "p1",
      reportId: "r1",
      kind: "screenshot",
      expiresAt: expires,
    })
    expect(
      verifyAttachmentToken({
        secret: SECRET,
        projectId: "p1",
        reportId: "r1",
        kind: "screenshot",
        expiresAt: expires,
        token,
      }),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Confirm fail**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/signed-attachment-url.test.ts 2>&1 | tail -5
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/server/lib/signed-attachment-url.ts
import { createHmac, timingSafeEqual } from "node:crypto"

interface TokenInput {
  secret: string
  projectId: string
  reportId: string
  kind: string
  expiresAt: number // UNIX seconds
}

interface VerifyInput extends TokenInput {
  token: string
}

function canonicalPayload(p: Omit<TokenInput, "secret">): string {
  return `${p.projectId}:${p.reportId}:${p.kind}:${p.expiresAt}`
}

export function signAttachmentToken(input: TokenInput): string {
  const hmac = createHmac("sha256", input.secret)
  hmac.update(canonicalPayload(input))
  return hmac.digest("hex")
}

export function verifyAttachmentToken(input: VerifyInput): boolean {
  if (input.expiresAt * 1000 < Date.now()) return false
  const expected = signAttachmentToken(input)
  // constant-time compare; reject if length differs
  if (expected.length !== input.token.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(input.token, "hex"))
  } catch {
    return false
  }
}

// Helper used by callers to build the full signed URL.
export function buildSignedAttachmentUrl(params: {
  baseUrl: string // e.g. https://dashboard.example.com
  projectId: string
  reportId: string
  kind: string
  secret: string
  ttlSeconds: number
}): string {
  const expiresAt = Math.floor(Date.now() / 1000) + params.ttlSeconds
  const token = signAttachmentToken({
    secret: params.secret,
    projectId: params.projectId,
    reportId: params.reportId,
    kind: params.kind,
    expiresAt,
  })
  const path = `/api/projects/${params.projectId}/reports/${params.reportId}/attachment`
  return `${params.baseUrl}${path}?kind=${encodeURIComponent(params.kind)}&token=${token}&expires=${expiresAt}`
}
```

- [ ] **Step 4: Confirm 4/4 PASS**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/lib/signed-attachment-url.test.ts 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/signed-attachment-url.ts apps/dashboard/tests/lib/signed-attachment-url.test.ts
git commit -m "feat(dashboard): add signed-attachment-url helper for GitHub-embed screenshots"
```

---

### Task 8: Extend `attachment.get.ts` to accept signed tokens

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/[reportId]/attachment.get.ts`

- [ ] **Step 1: Read the current file**

```bash
cat /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/[reportId]/attachment.get.ts
```

- [ ] **Step 2: Inject a signed-token short-circuit before the session auth check**

Modify the file so it looks like this at the top of the handler body (keep everything else as-is, but add the token short-circuit as an alternative to `requireProjectRole`):

```ts
import { createError, defineEventHandler, getQuery, getRouterParam, setHeader, setResponseStatus } from "h3"
import { and, eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { reportAttachments, reports } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"
import { getStorage } from "../../../../../lib/storage"
import { verifyAttachmentToken } from "../../../../../lib/signed-attachment-url"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }

  const q = getQuery(event)
  const kindRaw = q.kind
  const kind = typeof kindRaw === "string" ? kindRaw : "screenshot"

  // Signed-token fast path: used by GitHub-embedded screenshot URLs, no session.
  const tokenRaw = q.token
  const expiresRaw = q.expires
  if (typeof tokenRaw === "string" && typeof expiresRaw === "string") {
    const expiresAt = Number.parseInt(expiresRaw, 10)
    if (!Number.isFinite(expiresAt)) {
      throw createError({ statusCode: 401, statusMessage: "Invalid token" })
    }
    const secret = process.env.ATTACHMENT_URL_SECRET
    if (!secret) {
      throw createError({ statusCode: 500, statusMessage: "ATTACHMENT_URL_SECRET not set" })
    }
    const ok = verifyAttachmentToken({
      secret,
      projectId,
      reportId,
      kind,
      expiresAt,
      token: tokenRaw,
    })
    if (!ok) {
      throw createError({ statusCode: 401, statusMessage: "Invalid or expired token" })
    }
  } else {
    await requireProjectRole(event, projectId, "viewer")
  }

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
        eq(
          reportAttachments.kind,
          kind as "screenshot" | "annotated-screenshot" | "replay" | "logs",
        ),
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

- [ ] **Step 3: Verify tsc clean**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/projects/[id]/reports/[reportId]/attachment.get.ts
git commit -m "feat(api): attachment endpoint accepts signed token as session alternative"
```

---

## Phase 4 — Adapter package

### Task 9: Scaffold `packages/integrations/github/`

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/integrations/github/package.json`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/integrations/github/tsconfig.json`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/integrations/github/src/index.ts` (empty barrel placeholder)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@feedback-tool/integrations-github",
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
    "@octokit/auth-app": "^7.2.2",
    "@octokit/rest": "^22.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

If `tsconfig.base.json` doesn't exist at the repo root, use a standalone config:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create empty barrel**

```ts
// packages/integrations/github/src/index.ts
export {}
```

- [ ] **Step 4: Install deps via bun workspace**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun install
```

Expected: `@octokit/rest` and `@octokit/auth-app` get hoisted to `node_modules/.bun/` and the workspace package is linked.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/integrations/github/ bun.lock
git commit -m "feat(integrations): scaffold @feedback-tool/integrations-github package"
```

---

### Task 10: `verifyWebhookSignature` in adapter package

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/integrations/github/src/signature.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/integrations/github/src/signature.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/integrations/github/src/signature.test.ts
import { createHmac } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { verifyWebhookSignature } from "./signature"

const SECRET = "test-secret"

function sign(secret: string, payload: string): string {
  const h = createHmac("sha256", secret)
  h.update(payload)
  return `sha256=${h.digest("hex")}`
}

describe("verifyWebhookSignature", () => {
  test("valid signature returns true", () => {
    const payload = `{"a":1}`
    const signatureHeader = sign(SECRET, payload)
    expect(verifyWebhookSignature({ secret: SECRET, payload, signatureHeader })).toBe(true)
  })
  test("wrong secret returns false", () => {
    const payload = `{"a":1}`
    const signatureHeader = sign("other-secret", payload)
    expect(verifyWebhookSignature({ secret: SECRET, payload, signatureHeader })).toBe(false)
  })
  test("tampered payload returns false", () => {
    const payload = `{"a":1}`
    const signatureHeader = sign(SECRET, payload)
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        payload: `{"a":2}`,
        signatureHeader,
      }),
    ).toBe(false)
  })
  test("missing sha256 prefix returns false", () => {
    expect(
      verifyWebhookSignature({ secret: SECRET, payload: "x", signatureHeader: "abcd1234" }),
    ).toBe(false)
  })
  test("malformed hex returns false", () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        payload: "x",
        signatureHeader: "sha256=zzz",
      }),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Confirm fail**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/integrations/github && bun test src/signature.test.ts 2>&1 | tail -5
```

- [ ] **Step 3: Implement**

```ts
// packages/integrations/github/src/signature.ts
import { createHmac, timingSafeEqual } from "node:crypto"

export interface VerifyWebhookSignatureInput {
  secret: string
  payload: string
  signatureHeader: string
}

export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
  if (!input.signatureHeader.startsWith("sha256=")) return false
  const provided = input.signatureHeader.slice("sha256=".length)
  if (!/^[0-9a-f]+$/i.test(provided)) return false
  const hmac = createHmac("sha256", input.secret)
  hmac.update(input.payload)
  const expected = hmac.digest("hex")
  if (expected.length !== provided.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"))
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Confirm 5/5 PASS**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/integrations/github && bun test src/signature.test.ts 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/integrations/github/src/signature.ts packages/integrations/github/src/signature.test.ts
git commit -m "feat(integrations): add verifyWebhookSignature to github adapter"
```

---

### Task 11: Adapter types + `createInstallationClient`

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/integrations/github/src/types.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/integrations/github/src/client.ts`

No unit tests in this task — this file is a thin Octokit wrapper, tested via integration tests in Phase 6.

- [ ] **Step 1: Create types file**

```ts
// packages/integrations/github/src/types.ts
export interface InstallationClientOptions {
  appId: string
  privateKey: string
  installationId: number
}

export interface GitHubIssueRef {
  number: number
  nodeId: string
  url: string
}

export interface CreateIssueInput {
  owner: string
  repo: string
  title: string
  body: string
  labels?: readonly string[]
  assignees?: readonly string[]
}

export interface IssueStateInput {
  owner: string
  repo: string
  number: number
}

export interface CloseIssueInput extends IssueStateInput {
  reason?: "completed" | "not_planned"
}

export interface UpdateLabelsInput extends IssueStateInput {
  labels: readonly string[]
}

export interface InstallationRepository {
  id: number
  owner: string
  name: string
  fullName: string
}

export interface GitHubInstallationClient {
  createIssue(input: CreateIssueInput): Promise<GitHubIssueRef>
  getIssue(input: IssueStateInput): Promise<{ state: "open" | "closed"; labels: string[] }>
  closeIssue(input: CloseIssueInput): Promise<void>
  reopenIssue(input: IssueStateInput): Promise<void>
  updateIssueLabels(input: UpdateLabelsInput): Promise<void>
  listInstallationRepositories(): Promise<InstallationRepository[]>
}
```

- [ ] **Step 2: Create client file**

```ts
// packages/integrations/github/src/client.ts
import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/rest"
import type {
  CloseIssueInput,
  CreateIssueInput,
  GitHubInstallationClient,
  GitHubIssueRef,
  InstallationClientOptions,
  InstallationRepository,
  IssueStateInput,
  UpdateLabelsInput,
} from "./types"

export function createInstallationClient(
  opts: InstallationClientOptions,
): GitHubInstallationClient {
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: opts.appId,
      privateKey: opts.privateKey,
      installationId: opts.installationId,
    },
  })

  return {
    async createIssue(input: CreateIssueInput): Promise<GitHubIssueRef> {
      const res = await octokit.issues.create({
        owner: input.owner,
        repo: input.repo,
        title: input.title,
        body: input.body,
        labels: input.labels ? [...input.labels] : undefined,
        assignees: input.assignees ? [...input.assignees] : undefined,
      })
      return {
        number: res.data.number,
        nodeId: res.data.node_id,
        url: res.data.html_url,
      }
    },

    async getIssue(input: IssueStateInput) {
      const res = await octokit.issues.get({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
      })
      return {
        state: res.data.state === "closed" ? "closed" : "open",
        labels: res.data.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
      }
    },

    async closeIssue(input: CloseIssueInput): Promise<void> {
      await octokit.issues.update({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
        state: "closed",
        state_reason: input.reason ?? "completed",
      })
    },

    async reopenIssue(input: IssueStateInput): Promise<void> {
      await octokit.issues.update({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
        state: "open",
      })
    },

    async updateIssueLabels(input: UpdateLabelsInput): Promise<void> {
      await octokit.issues.setLabels({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
        labels: [...input.labels],
      })
    },

    async listInstallationRepositories(): Promise<InstallationRepository[]> {
      const res = await octokit.apps.listReposAccessibleToInstallation({ per_page: 100 })
      return res.data.repositories.map((r) => ({
        id: r.id,
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
      }))
    },
  }
}
```

- [ ] **Step 3: Verify tsc clean**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/integrations/github && bunx tsc --noEmit 2>&1 | head -10
```

Expected: zero errors. If Octokit's types disagree with the code, adjust the return types of `getIssue` to match Octokit's union shapes.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/integrations/github/src/client.ts packages/integrations/github/src/types.ts
git commit -m "feat(integrations): add createInstallationClient (Octokit wrapper)"
```

---

### Task 12: Barrel exports

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/integrations/github/src/index.ts`

- [ ] **Step 1: Replace the empty barrel**

```ts
// packages/integrations/github/src/index.ts
export * from "./signature"
export * from "./types"
export * from "./client"
```

- [ ] **Step 2: Verify tsc clean**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/integrations/github && bunx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/integrations/github/src/index.ts
git commit -m "feat(integrations): barrel-export github adapter"
```

---

## Phase 5 — Shared types + server shim + worker

### Task 13: Shared Zod DTOs

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/src/github.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/src/index.ts`

- [ ] **Step 1: Create the DTO file**

```ts
// packages/shared/src/github.ts
import { z } from "zod"

export const GithubConfigDTO = z.object({
  installed: z.boolean(),
  status: z.enum(["connected", "disconnected"]).nullable(),
  repoOwner: z.string(),
  repoName: z.string(),
  defaultLabels: z.array(z.string()),
  defaultAssignees: z.array(z.string()),
  lastSyncedAt: z.string().nullable(),
  failedJobs: z.array(
    z.object({
      reportId: z.string().uuid(),
      reportTitle: z.string(),
      attempts: z.number().int(),
      lastError: z.string().nullable(),
      updatedAt: z.string(),
    }),
  ),
})
export type GithubConfigDTO = z.infer<typeof GithubConfigDTO>

export const UpdateGithubConfigInput = z.object({
  repoOwner: z.string().min(1).max(100).optional(),
  repoName: z.string().min(1).max(100).optional(),
  defaultLabels: z.array(z.string().min(1).max(50)).max(20).optional(),
  defaultAssignees: z.array(z.string().min(1).max(50)).max(20).optional(),
})
export type UpdateGithubConfigInput = z.infer<typeof UpdateGithubConfigInput>

export const InstallRedirectResponse = z.object({ url: z.string().url() })
export type InstallRedirectResponse = z.infer<typeof InstallRedirectResponse>
```

- [ ] **Step 2: Re-export from shared barrel**

Edit `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/src/index.ts` — append:

```ts
export * from "./github"
```

- [ ] **Step 3: Verify tsc**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/shared && bunx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/shared/src/github.ts packages/shared/src/index.ts
git commit -m "feat(shared): add GitHub integration Zod DTOs"
```

---

### Task 14: `server/lib/github.ts` — env shim + client override

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/github.ts`

- [ ] **Step 1: Create**

```ts
// apps/dashboard/server/lib/github.ts
import { createInstallationClient } from "@feedback-tool/integrations-github"
import type { GitHubInstallationClient } from "@feedback-tool/integrations-github"

// Test-only override hook: allows integration tests to inject a mock client
// without reaching the Octokit network path. Production callers ignore it.
let overrideFactory: ((installationId: number) => GitHubInstallationClient) | null = null

export function __setClientOverride(
  factory: ((installationId: number) => GitHubInstallationClient) | null,
): void {
  overrideFactory = factory
}

export function getGithubClient(installationId: number): GitHubInstallationClient {
  if (overrideFactory) return overrideFactory(installationId)
  const appId = process.env.GITHUB_APP_ID
  const privateKey = (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n")
  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set")
  }
  return createInstallationClient({ appId, privateKey, installationId })
}

export function getWebhookSecret(): string {
  const s = process.env.GITHUB_APP_WEBHOOK_SECRET
  if (!s) throw new Error("GITHUB_APP_WEBHOOK_SECRET must be set")
  return s
}

export function getAttachmentUrlSecret(): string {
  const s = process.env.ATTACHMENT_URL_SECRET
  if (!s) throw new Error("ATTACHMENT_URL_SECRET must be set")
  return s
}

export function getDashboardBaseUrl(): string {
  return process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
}

export function getAppSlug(): string {
  return process.env.GITHUB_APP_SLUG ?? "feedback-tool"
}
```

- [ ] **Step 2: Verify tsc**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/github.ts
git commit -m "feat(dashboard): add server/lib/github.ts env shim + test override hook"
```

---

### Task 15: `reconcileReport` pure function

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/github-reconcile.ts`

- [ ] **Step 1: Create**

```ts
// apps/dashboard/server/lib/github-reconcile.ts
import { and, eq } from "drizzle-orm"
import { buildIssueBody, labelsFor } from "./github-helpers"
import { getAttachmentUrlSecret, getDashboardBaseUrl, getGithubClient } from "./github"
import { buildSignedAttachmentUrl } from "./signed-attachment-url"
import { db } from "../db"
import { githubIntegrations, reportAttachments, reports, reportSyncJobs } from "../db/schema"
import { user as userTable } from "../db/schema/auth-schema"

export class ReconcileSkipped extends Error {}

export async function reconcileReport(reportId: string): Promise<void> {
  const [row] = await db
    .select({
      r: reports,
      gi: githubIntegrations,
      reporterEmail: userTable.email,
    })
    .from(reports)
    .leftJoin(githubIntegrations, eq(githubIntegrations.projectId, reports.projectId))
    .leftJoin(userTable, eq(userTable.id, reports.assigneeId))
    .where(eq(reports.id, reportId))
    .limit(1)

  if (!row?.gi || row.gi.status !== "connected") {
    // Integration missing or disconnected — stale job. Delete and return.
    await db.delete(reportSyncJobs).where(eq(reportSyncJobs.reportId, reportId))
    throw new ReconcileSkipped("no connected integration")
  }
  if (!row.gi.repoOwner || !row.gi.repoName) {
    // Admin hasn't picked a repo yet — defer.
    throw new Error("Integration has no repo configured yet")
  }

  const report = row.r
  const gi = row.gi
  const client = getGithubClient(gi.installationId)

  const desiredLabels = labelsFor(
    { priority: report.priority, tags: report.tags },
    { defaultLabels: gi.defaultLabels },
  )

  // Build issue body inputs once — used either on create or (not) on update.
  const [screenshotRow] = await db
    .select({ id: reportAttachments.id })
    .from(reportAttachments)
    .where(
      and(
        eq(reportAttachments.reportId, report.id),
        eq(reportAttachments.kind, "screenshot"),
      ),
    )
    .limit(1)

  const screenshotUrl = screenshotRow
    ? buildSignedAttachmentUrl({
        baseUrl: getDashboardBaseUrl(),
        projectId: report.projectId,
        reportId: report.id,
        kind: "screenshot",
        secret: getAttachmentUrlSecret(),
        ttlSeconds: 60 * 60 * 24 * 7, // 7 days
      })
    : null

  // Pull the reporter email from the report context (not from the assignee join above — that was wrong; fix)
  const ctx = report.context as { reporter?: { email?: string }; pageUrl?: string }
  const bodyInput = {
    id: report.id,
    title: report.title,
    description: report.description ?? "",
    pageUrl: ctx.pageUrl ?? "",
    reporterEmail: ctx.reporter?.email ?? null,
    createdAt: report.createdAt,
    screenshotUrl,
    dashboardUrl: `${getDashboardBaseUrl()}/projects/${report.projectId}/reports/${report.id}`,
  }
  const body = buildIssueBody(bodyInput)

  if (report.githubIssueNumber == null) {
    // Create a new issue.
    const ref = await client.createIssue({
      owner: gi.repoOwner,
      repo: gi.repoName,
      title: report.title,
      body,
      labels: desiredLabels,
      assignees: gi.defaultAssignees,
    })
    await db
      .update(reports)
      .set({
        githubIssueNumber: ref.number,
        githubIssueNodeId: ref.nodeId,
        githubIssueUrl: ref.url,
      })
      .where(eq(reports.id, report.id))
    return
  }

  // Reconcile existing issue state + labels.
  const live = await client.getIssue({
    owner: gi.repoOwner,
    repo: gi.repoName,
    number: report.githubIssueNumber,
  })
  const desiredState: "open" | "closed" =
    report.status === "resolved" || report.status === "closed" ? "closed" : "open"

  if (live.state !== desiredState) {
    if (desiredState === "closed") {
      await client.closeIssue({
        owner: gi.repoOwner,
        repo: gi.repoName,
        number: report.githubIssueNumber,
        reason: report.status === "resolved" ? "completed" : "not_planned",
      })
    } else {
      await client.reopenIssue({
        owner: gi.repoOwner,
        repo: gi.repoName,
        number: report.githubIssueNumber,
      })
    }
  }

  const liveSorted = [...live.labels].sort()
  const desiredSorted = desiredLabels
  if (
    liveSorted.length !== desiredSorted.length ||
    liveSorted.some((l, i) => l !== desiredSorted[i])
  ) {
    await client.updateIssueLabels({
      owner: gi.repoOwner,
      repo: gi.repoName,
      number: report.githubIssueNumber,
      labels: desiredLabels,
    })
  }
}
```

- [ ] **Step 2: Verify tsc**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -15
```

Expected: no new errors in this file. If tsc complains about the unused leftJoin on `userTable`, remove that join (it was a leftover from initial drafting — we pull reporter email from context JSONB, not from the assignee's user row).

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/github-reconcile.ts
git commit -m "feat(dashboard): add reconcileReport — idempotent sync core"
```

---

### Task 16: Nitro scheduled task

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/tasks/github-sync.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/nuxt.config.ts` (register scheduled task)

- [ ] **Step 1: Create the task**

```ts
// apps/dashboard/server/tasks/github-sync.ts
import { and, eq, lte } from "drizzle-orm"
import { db } from "../db"
import { reportSyncJobs } from "../db/schema"
import { ReconcileSkipped, reconcileReport } from "../lib/github-reconcile"
import { computeBackoff } from "../lib/github-helpers"

export default defineTask({
  meta: {
    name: "github:sync",
    description: "Drain report_sync_jobs by reconciling reports against GitHub",
  },
  async run() {
    const batch = await db
      .select()
      .from(reportSyncJobs)
      .where(and(eq(reportSyncJobs.state, "pending"), lte(reportSyncJobs.nextAttemptAt, new Date())))
      .orderBy(reportSyncJobs.nextAttemptAt)
      .limit(10)

    for (const job of batch) {
      await db
        .update(reportSyncJobs)
        .set({ state: "syncing", updatedAt: new Date() })
        .where(eq(reportSyncJobs.reportId, job.reportId))
      try {
        await reconcileReport(job.reportId)
        await db.delete(reportSyncJobs).where(eq(reportSyncJobs.reportId, job.reportId))
      } catch (err) {
        if (err instanceof ReconcileSkipped) {
          // Row already deleted by reconcileReport.
          continue
        }
        const attempts = job.attempts + 1
        const backoffMs = computeBackoff(attempts)
        const state = attempts >= 5 ? "failed" : "pending"
        await db
          .update(reportSyncJobs)
          .set({
            state,
            attempts,
            lastError: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
            nextAttemptAt: new Date(Date.now() + backoffMs),
            updatedAt: new Date(),
          })
          .where(eq(reportSyncJobs.reportId, job.reportId))
      }
    }

    return { result: "ok", processed: batch.length }
  },
})
```

- [ ] **Step 2: Register the task's schedule in `nuxt.config.ts`**

Read `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/nuxt.config.ts`. Add or extend the `nitro` block:

```ts
nitro: {
  experimental: {
    tasks: true,
  },
  scheduledTasks: {
    "*/1 * * * *": ["github:sync"], // every minute in production
  },
  // ... keep other nitro options as-is
}
```

Note the cron is once per minute (Nitro's scheduledTasks uses standard cron which has 1-minute minimum granularity). The plan originally said every 10s but Nitro doesn't support sub-minute cron natively. Accept the 1-minute tick for v1; if faster polling is needed later we can swap to a manual setInterval inside a `nitro/plugins/` module.

- [ ] **Step 3: Verify tsc**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -10
```

If `defineTask` is not auto-imported, add an explicit import from `#imports` or `nitro/runtime` per Nitro's task API.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/tasks/github-sync.ts apps/dashboard/nuxt.config.ts
git commit -m "feat(dashboard): add Nitro scheduled task — github:sync (every minute)"
```

---

## Phase 6 — API endpoints

### Task 17: `GET /api/projects/:id/integrations/github`

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/integrations/github/index.get.ts`

- [ ] **Step 1: Create**

```ts
// apps/dashboard/server/api/projects/[id]/integrations/github/index.get.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, desc, eq } from "drizzle-orm"
import type { GithubConfigDTO } from "@feedback-tool/shared"
import { db } from "../../../../../db"
import { githubIntegrations, reports, reportSyncJobs } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event): Promise<GithubConfigDTO> => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "viewer")

  const [gi] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)

  if (!gi) {
    return {
      installed: false,
      status: null,
      repoOwner: "",
      repoName: "",
      defaultLabels: [],
      defaultAssignees: [],
      lastSyncedAt: null,
      failedJobs: [],
    }
  }

  const failedJobs = await db
    .select({
      reportId: reportSyncJobs.reportId,
      reportTitle: reports.title,
      attempts: reportSyncJobs.attempts,
      lastError: reportSyncJobs.lastError,
      updatedAt: reportSyncJobs.updatedAt,
    })
    .from(reportSyncJobs)
    .innerJoin(reports, eq(reports.id, reportSyncJobs.reportId))
    .where(and(eq(reports.projectId, projectId), eq(reportSyncJobs.state, "failed")))
    .orderBy(desc(reportSyncJobs.updatedAt))
    .limit(50)

  return {
    installed: true,
    status: gi.status,
    repoOwner: gi.repoOwner,
    repoName: gi.repoName,
    defaultLabels: gi.defaultLabels,
    defaultAssignees: gi.defaultAssignees,
    lastSyncedAt: gi.updatedAt.toISOString(),
    failedJobs: failedJobs.map((j) => ({
      reportId: j.reportId,
      reportTitle: j.reportTitle,
      attempts: j.attempts,
      lastError: j.lastError,
      updatedAt: j.updatedAt.toISOString(),
    })),
  }
})
```

- [ ] **Step 2: Verify tsc**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/projects/[id]/integrations/github/index.get.ts
git commit -m "feat(api): add GET /projects/:id/integrations/github for config + failed jobs"
```

---

### Task 18: `POST /install-redirect` + `GET /install-callback`

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/integrations/github/install-redirect.post.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/integrations/github/install-callback.get.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/github.ts` — add state helpers

- [ ] **Step 1: Add state signer helpers to `lib/github.ts`**

Append to `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/github.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto"

interface InstallStateClaims {
  projectId: string
  userId: string
  exp: number // UNIX seconds
}

export function signInstallState(claims: InstallStateClaims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url")
  const secret = getWebhookSecret() // reuse webhook secret for state HMAC
  const hmac = createHmac("sha256", secret).update(body).digest("base64url")
  return `${body}.${hmac}`
}

export function verifyInstallState(state: string): InstallStateClaims | null {
  const [body, sig] = state.split(".")
  if (!body || !sig) return null
  const secret = getWebhookSecret()
  const expected = createHmac("sha256", secret).update(body).digest("base64url")
  if (expected.length !== sig.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null
  } catch {
    return null
  }
  const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as InstallStateClaims
  if (claims.exp * 1000 < Date.now()) return null
  return claims
}
```

- [ ] **Step 2: Create install-redirect endpoint**

```ts
// apps/dashboard/server/api/projects/[id]/integrations/github/install-redirect.post.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { getAppSlug, signInstallState } from "../../../../../lib/github"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  const { session } = await requireProjectRole(event, projectId, "owner")
  const exp = Math.floor(Date.now() / 1000) + 10 * 60 // 10 minutes
  const state = signInstallState({ projectId, userId: session.userId, exp })
  const slug = getAppSlug()
  return {
    url: `https://github.com/apps/${slug}/installations/new?state=${state}`,
  }
})
```

- [ ] **Step 3: Create install-callback endpoint**

```ts
// apps/dashboard/server/api/integrations/github/install-callback.get.ts
import { createError, defineEventHandler, getQuery, sendRedirect } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { githubIntegrations } from "../../../db/schema"
import { getDashboardBaseUrl, verifyInstallState } from "../../../lib/github"

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const installationIdRaw = q.installation_id
  const stateRaw = q.state
  if (typeof installationIdRaw !== "string" || typeof stateRaw !== "string") {
    throw createError({ statusCode: 400, statusMessage: "missing installation_id or state" })
  }
  const claims = verifyInstallState(stateRaw)
  if (!claims) {
    throw createError({ statusCode: 401, statusMessage: "invalid or expired state" })
  }
  const installationId = Number.parseInt(installationIdRaw, 10)
  if (!Number.isFinite(installationId)) {
    throw createError({ statusCode: 400, statusMessage: "invalid installation_id" })
  }

  // UPSERT: if project already has an integration row, update it.
  const [existing] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, claims.projectId))
    .limit(1)

  if (existing) {
    await db
      .update(githubIntegrations)
      .set({
        installationId,
        status: "connected",
        lastError: null,
        connectedBy: claims.userId,
        connectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(githubIntegrations.projectId, claims.projectId))
  } else {
    await db.insert(githubIntegrations).values({
      projectId: claims.projectId,
      installationId,
      repoOwner: "",
      repoName: "",
      connectedBy: claims.userId,
      status: "connected",
    })
  }

  return sendRedirect(
    event,
    `${getDashboardBaseUrl()}/projects/${claims.projectId}/settings?tab=github&installed=1`,
    302,
  )
})
```

- [ ] **Step 4: Verify tsc**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/github.ts \
        apps/dashboard/server/api/projects/[id]/integrations/github/install-redirect.post.ts \
        apps/dashboard/server/api/integrations/github/install-callback.get.ts
git commit -m "feat(api): add install-redirect + install-callback for GitHub App flow"
```

---

### Task 19: `PATCH /integrations/github` + `POST /disconnect`

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/integrations/github/index.patch.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/integrations/github/disconnect.post.ts`

- [ ] **Step 1: Create PATCH endpoint**

```ts
// apps/dashboard/server/api/projects/[id]/integrations/github/index.patch.ts
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { eq } from "drizzle-orm"
import { UpdateGithubConfigInput } from "@feedback-tool/shared"
import { db } from "../../../../../db"
import { githubIntegrations } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "owner")
  const body = await readValidatedBody(event, (b) => UpdateGithubConfigInput.parse(b))

  const [existing] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "GitHub integration not installed" })
  }

  await db
    .update(githubIntegrations)
    .set({
      ...(body.repoOwner !== undefined ? { repoOwner: body.repoOwner } : {}),
      ...(body.repoName !== undefined ? { repoName: body.repoName } : {}),
      ...(body.defaultLabels !== undefined ? { defaultLabels: body.defaultLabels } : {}),
      ...(body.defaultAssignees !== undefined ? { defaultAssignees: body.defaultAssignees } : {}),
      updatedAt: new Date(),
    })
    .where(eq(githubIntegrations.projectId, projectId))

  return { ok: true }
})
```

- [ ] **Step 2: Create disconnect endpoint**

```ts
// apps/dashboard/server/api/projects/[id]/integrations/github/disconnect.post.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { githubIntegrations } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "owner")
  await db
    .update(githubIntegrations)
    .set({ status: "disconnected", updatedAt: new Date() })
    .where(eq(githubIntegrations.projectId, projectId))
  return { ok: true }
})
```

- [ ] **Step 3: Verify tsc**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/projects/[id]/integrations/github/index.patch.ts \
        apps/dashboard/server/api/projects/[id]/integrations/github/disconnect.post.ts
git commit -m "feat(api): add PATCH + disconnect for GitHub integration settings"
```

---

### Task 20: `POST /retry-failed`

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/integrations/github/retry-failed.post.ts`

- [ ] **Step 1: Create**

```ts
// apps/dashboard/server/api/projects/[id]/integrations/github/retry-failed.post.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "../../../../../db"
import { reports, reportSyncJobs } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "developer")

  const failedIds = await db
    .select({ reportId: reportSyncJobs.reportId })
    .from(reportSyncJobs)
    .innerJoin(reports, eq(reports.id, reportSyncJobs.reportId))
    .where(and(eq(reports.projectId, projectId), eq(reportSyncJobs.state, "failed")))

  if (failedIds.length === 0) return { retried: 0 }

  const ids = failedIds.map((r) => r.reportId)
  await db
    .update(reportSyncJobs)
    .set({ state: "pending", nextAttemptAt: new Date(), updatedAt: new Date() })
    .where(inArray(reportSyncJobs.reportId, ids))

  return { retried: ids.length }
})
```

- [ ] **Step 2: Verify tsc**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/projects/[id]/integrations/github/retry-failed.post.ts
git commit -m "feat(api): add retry-failed endpoint for bulk sync job retries"
```

---

### Task 21: Webhook receiver

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/integrations/github/webhook.post.ts`

- [ ] **Step 1: Create**

```ts
// apps/dashboard/server/api/integrations/github/webhook.post.ts
import { createError, defineEventHandler, getHeader, readRawBody, setResponseStatus } from "h3"
import { and, eq } from "drizzle-orm"
import { verifyWebhookSignature } from "@feedback-tool/integrations-github"
import { db } from "../../../db"
import { githubIntegrations, reportEvents, reports } from "../../../db/schema"
import { getWebhookSecret } from "../../../lib/github"

interface IssuesPayload {
  action: "opened" | "closed" | "reopened" | "edited" | "deleted" | string
  issue: { number: number; state: "open" | "closed"; state_reason?: "completed" | "not_planned" | null }
  repository: { name: string; owner: { login: string } }
}

interface InstallationPayload {
  action: "created" | "deleted" | "suspend" | "unsuspend" | string
  installation: { id: number }
}

interface InstallationReposPayload {
  action: "added" | "removed"
  installation: { id: number }
  repositories_removed?: Array<{ name: string; full_name: string }>
}

export default defineEventHandler(async (event) => {
  const raw = await readRawBody(event)
  if (!raw || typeof raw !== "string") {
    throw createError({ statusCode: 400, statusMessage: "invalid body" })
  }
  const sig = getHeader(event, "x-hub-signature-256")
  if (!sig || !verifyWebhookSignature({ secret: getWebhookSecret(), payload: raw, signatureHeader: sig })) {
    throw createError({ statusCode: 401, statusMessage: "invalid signature" })
  }

  const kind = getHeader(event, "x-github-event")
  const payload = JSON.parse(raw) as Record<string, unknown>

  if (kind === "installation") {
    const p = payload as unknown as InstallationPayload
    if (p.action === "deleted" || p.action === "suspend") {
      await db
        .update(githubIntegrations)
        .set({ status: "disconnected", updatedAt: new Date() })
        .where(eq(githubIntegrations.installationId, p.installation.id))
    }
  } else if (kind === "installation_repositories") {
    const p = payload as unknown as InstallationReposPayload
    if (p.action === "removed" && p.repositories_removed?.length) {
      const removedNames = p.repositories_removed.map((r) => r.full_name)
      const rows = await db
        .select()
        .from(githubIntegrations)
        .where(eq(githubIntegrations.installationId, p.installation.id))
      for (const row of rows) {
        if (removedNames.includes(`${row.repoOwner}/${row.repoName}`)) {
          await db
            .update(githubIntegrations)
            .set({ status: "disconnected", updatedAt: new Date() })
            .where(eq(githubIntegrations.projectId, row.projectId))
        }
      }
    }
  } else if (kind === "issues") {
    const p = payload as unknown as IssuesPayload
    if (p.action === "closed" || p.action === "reopened") {
      const desired =
        p.action === "reopened"
          ? "open"
          : p.issue.state_reason === "not_planned"
            ? "closed"
            : "resolved"
      const [linked] = await db
        .select({ r: reports, gi: githubIntegrations })
        .from(reports)
        .innerJoin(githubIntegrations, eq(githubIntegrations.projectId, reports.projectId))
        .where(
          and(
            eq(reports.githubIssueNumber, p.issue.number),
            eq(githubIntegrations.repoOwner, p.repository.owner.login),
            eq(githubIntegrations.repoName, p.repository.name),
          ),
        )
        .limit(1)
      if (linked && linked.r.status !== desired) {
        await db.transaction(async (tx) => {
          await tx
            .update(reports)
            .set({ status: desired, updatedAt: new Date() })
            .where(eq(reports.id, linked.r.id))
          await tx.insert(reportEvents).values({
            reportId: linked.r.id,
            actorId: null,
            kind: "status_changed",
            payload: { from: linked.r.status, to: desired, source: "github" },
          })
        })
      }
    }
  }

  setResponseStatus(event, 202)
  return { ok: true }
})
```

- [ ] **Step 2: Verify tsc**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/integrations/github/webhook.post.ts
git commit -m "feat(api): add github webhook receiver (installation + issues events)"
```

---

### Task 22: Manual `github-sync` + `github-unlink` endpoints + enqueue hooks

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-sync.post.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-unlink.post.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/enqueue-sync.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/intake/reports.ts` — enqueue after insert
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts` — enqueue if linked
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts` — enqueue if linked

- [ ] **Step 1: Create the enqueue helper**

```ts
// apps/dashboard/server/lib/enqueue-sync.ts
import { and, eq } from "drizzle-orm"
import type { PgDatabase } from "drizzle-orm/pg-core"
import { db as defaultDb } from "../db"
import { githubIntegrations, reportSyncJobs } from "../db/schema"

/** UPSERT a pending sync job. Idempotent. */
export async function enqueueSync(
  reportId: string,
  projectId: string,
  tx?: PgDatabase<never> | typeof defaultDb,
): Promise<void> {
  const dbx = tx ?? defaultDb
  // Bail early if the project has no connected integration — no point queuing.
  const [gi] = await dbx
    .select({ status: githubIntegrations.status })
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)
  if (!gi || gi.status !== "connected") return
  await dbx
    .insert(reportSyncJobs)
    .values({ reportId, state: "pending", nextAttemptAt: new Date() })
    .onConflictDoUpdate({
      target: reportSyncJobs.reportId,
      set: { state: "pending", nextAttemptAt: new Date(), updatedAt: new Date() },
    })
}
```

- [ ] **Step 2: Wire enqueue into intake**

Modify `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/intake/reports.ts` — after the `db.insert(reports).values(...)` block that returns the new report, AND before the final response, add:

```ts
import { enqueueSync } from "../../lib/enqueue-sync"

// ... after successful report insert + optional attachment persistence:
await enqueueSync(report.id, project.id).catch((err) => {
  console.error("[github] enqueueSync failed on intake", err)
})
```

(Use catch-log, not throw — intake must not fail if enqueue fails.)

- [ ] **Step 3: Wire enqueue into PATCH and bulk-update**

In `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts` — after the transaction's successful event insert:

```ts
import { enqueueSync } from "../../../../../lib/enqueue-sync"

// inside the transaction, at the end, ONLY if current.githubIssueNumber is set
// OR if any sync-triggering field changed (status/priority/tags):
if (events.length > 0 && current.githubIssueNumber != null) {
  await enqueueSync(reportId, id, tx)
}
```

In `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts` — similar: at the end of the loop, for each updated report that has a `githubIssueNumber`, enqueue a sync job.

- [ ] **Step 4: Create `github-sync.post.ts`**

```ts
// apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-sync.post.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { enqueueSync } from "../../../../../lib/enqueue-sync"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  await requireProjectRole(event, projectId, "developer")
  await enqueueSync(reportId, projectId)
  return { ok: true }
})
```

- [ ] **Step 5: Create `github-unlink.post.ts`**

```ts
// apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-unlink.post.ts
import { createError, defineEventHandler, getRouterParam } from "h3"
import { and, eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { reportEvents, reports, reportSyncJobs } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) {
    throw createError({ statusCode: 400, statusMessage: "missing params" })
  }
  const { session } = await requireProjectRole(event, projectId, "developer")

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.id, reportId), eq(reports.projectId, projectId)))
      .limit(1)
    if (!current) throw createError({ statusCode: 404, statusMessage: "report not found" })
    if (current.githubIssueNumber == null) {
      return { ok: true, unlinked: false }
    }

    await tx
      .update(reports)
      .set({
        githubIssueNumber: null,
        githubIssueNodeId: null,
        githubIssueUrl: null,
        updatedAt: new Date(),
      })
      .where(eq(reports.id, reportId))

    await tx.delete(reportSyncJobs).where(eq(reportSyncJobs.reportId, reportId))

    await tx.insert(reportEvents).values({
      reportId,
      actorId: session.userId,
      kind: "github_unlinked",
      payload: {
        number: current.githubIssueNumber,
        url: current.githubIssueUrl,
      },
    })

    return { ok: true, unlinked: true }
  })
})
```

- [ ] **Step 6: Verify tsc**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx tsc --noEmit 2>&1 | head -15
```

- [ ] **Step 7: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/enqueue-sync.ts \
        apps/dashboard/server/api/intake/reports.ts \
        apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts \
        apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts \
        apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-sync.post.ts \
        apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-unlink.post.ts
git commit -m "feat(api): add enqueue-sync helper + manual sync/unlink + wire into intake/PATCH/bulk"
```

---

## Phase 7 — Integration tests

### Task 23: Test scaffold + install/config/disconnect tests (~6 tests)

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/api/github-sync.test.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/helpers.ts` — add `truncateGithub()` helper

- [ ] **Step 1: Add helper to `tests/helpers.ts`**

Append to `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/helpers.ts`:

```ts
export async function truncateGithub() {
  await db.execute(sql`TRUNCATE report_sync_jobs, github_integrations RESTART IDENTITY CASCADE`)
}
```

- [ ] **Step 2: Create the test file with mock + install/disconnect cases**

```ts
// apps/dashboard/tests/api/github-sync.test.ts
import { setup } from "@nuxt/test-utils/e2e"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(30000)
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import type { GitHubInstallationClient } from "@feedback-tool/integrations-github"
import { __setClientOverride, signInstallState } from "../../server/lib/github"
import {
  apiFetch,
  createUser,
  seedProject,
  signIn,
  truncateDomain,
  truncateGithub,
  truncateReports,
} from "../helpers"
import { db } from "../../server/db"
import { githubIntegrations, reports, reportEvents, reportSyncJobs } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })

const PK = "ft_pk_GHUB1234567890abcdef1234"
const ORIGIN = "http://localhost:4000"

interface MockCalls {
  createIssue: Array<Record<string, unknown>>
  closeIssue: Array<Record<string, unknown>>
  reopenIssue: Array<Record<string, unknown>>
  updateIssueLabels: Array<Record<string, unknown>>
  getIssue: Array<Record<string, unknown>>
}

function makeMock(
  overrides: Partial<GitHubInstallationClient> = {},
): { client: GitHubInstallationClient; calls: MockCalls } {
  const calls: MockCalls = {
    createIssue: [],
    closeIssue: [],
    reopenIssue: [],
    updateIssueLabels: [],
    getIssue: [],
  }
  const defaults: GitHubInstallationClient = {
    createIssue: async (input) => {
      calls.createIssue.push(input as unknown as Record<string, unknown>)
      return { number: 42, nodeId: "NODE_42", url: "https://github.com/acme/frontend/issues/42" }
    },
    getIssue: async (input) => {
      calls.getIssue.push(input as unknown as Record<string, unknown>)
      return { state: "open", labels: [] }
    },
    closeIssue: async (input) => {
      calls.closeIssue.push(input as unknown as Record<string, unknown>)
    },
    reopenIssue: async (input) => {
      calls.reopenIssue.push(input as unknown as Record<string, unknown>)
    },
    updateIssueLabels: async (input) => {
      calls.updateIssueLabels.push(input as unknown as Record<string, unknown>)
    },
    listInstallationRepositories: async () => [
      { id: 1, owner: "acme", name: "frontend", fullName: "acme/frontend" },
    ],
  }
  return { client: { ...defaults, ...overrides }, calls }
}

beforeAll(() => {
  // Point env vars to test values so the real env-reading shim doesn't crash
  // when tests exercise the webhook path.
  process.env.GITHUB_APP_ID = process.env.GITHUB_APP_ID ?? "123"
  process.env.GITHUB_APP_PRIVATE_KEY =
    process.env.GITHUB_APP_PRIVATE_KEY ?? "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----"
  process.env.GITHUB_APP_WEBHOOK_SECRET = process.env.GITHUB_APP_WEBHOOK_SECRET ?? "test-webhook-secret"
  process.env.ATTACHMENT_URL_SECRET = process.env.ATTACHMENT_URL_SECRET ?? "test-attachment-secret"
})

describe("github integration — install + config", () => {
  afterEach(async () => {
    __setClientOverride(null)
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("install-callback with valid state upserts github_integrations row", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const state = signInstallState({
      projectId: pid,
      userId: owner,
      exp: Math.floor(Date.now() / 1000) + 600,
    })
    const res = await fetch(
      `http://localhost:3000/api/integrations/github/install-callback?installation_id=99&state=${state}`,
      { redirect: "manual" },
    )
    expect(res.status).toBe(302)
    const [row] = await db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, pid))
    expect(row?.installationId).toBe(99)
    expect(row?.status).toBe("connected")
  })

  test("install-callback rejects invalid state", async () => {
    const res = await fetch(
      "http://localhost:3000/api/integrations/github/install-callback?installation_id=1&state=bogus.bogus",
      { redirect: "manual" },
    )
    expect(res.status).toBe(401)
  })

  test("PATCH updates repo + defaults", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await db
      .insert(githubIntegrations)
      .values({ projectId: pid, installationId: 10, repoOwner: "", repoName: "" })
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/integrations/github`, {
      method: "PATCH",
      headers: { cookie },
      body: {
        repoOwner: "acme",
        repoName: "frontend",
        defaultLabels: ["feedback"],
        defaultAssignees: ["@priya"],
      },
    })
    expect(status).toBe(200)
    const [row] = await db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, pid))
    expect(row?.repoOwner).toBe("acme")
    expect(row?.defaultLabels).toEqual(["feedback"])
  })

  test("disconnect flips status", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await db
      .insert(githubIntegrations)
      .values({ projectId: pid, installationId: 10, repoOwner: "acme", repoName: "frontend" })
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/integrations/github/disconnect`, {
      method: "POST",
      headers: { cookie },
    })
    expect(status).toBe(200)
    const [row] = await db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, pid))
    expect(row?.status).toBe("disconnected")
  })

  test("GET config returns the shape with no integration", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    const cookie = await signIn("owner@example.com")
    const { body } = await apiFetch<{ installed: boolean }>(
      `/api/projects/${pid}/integrations/github`,
      { headers: { cookie } },
    )
    expect(body.installed).toBe(false)
  })

  test("viewer cannot PATCH or disconnect", async () => {
    const owner = await createUser("owner@example.com", "admin")
    const viewer = await createUser("viewer@example.com", "member")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: owner,
    })
    await db.insert(githubIntegrations).values({
      projectId: pid,
      installationId: 10,
      repoOwner: "acme",
      repoName: "frontend",
    })
    await db.insert(/* projectMembers */ require("../../server/db/schema").projectMembers).values({
      projectId: pid,
      userId: viewer,
      role: "viewer",
    })
    const cookie = await signIn("viewer@example.com")
    const r1 = await apiFetch(`/api/projects/${pid}/integrations/github`, {
      method: "PATCH",
      headers: { cookie },
      body: { defaultLabels: ["x"] },
    })
    expect(r1.status).toBe(403)
    const r2 = await apiFetch(`/api/projects/${pid}/integrations/github/disconnect`, {
      method: "POST",
      headers: { cookie },
    })
    expect(r2.status).toBe(403)
  })
})
```

- [ ] **Step 3: Run + expect 6/6 PASS**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_sync_jobs, github_integrations, report_events, report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE" >/dev/null 2>&1 || true
cd apps/dashboard && bun test tests/api/github-sync.test.ts 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/tests/api/github-sync.test.ts apps/dashboard/tests/helpers.ts
git commit -m "test(api): add install/config/disconnect integration tests"
```

---

### Task 24: Worker reconcile + webhook tests (~9 tests)

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/api/github-sync.test.ts` — append more describe blocks

- [ ] **Step 1: Append worker + webhook describes**

Add to the end of `tests/api/github-sync.test.ts`:

```ts
import { createHmac } from "node:crypto"
import { reconcileReport } from "../../server/lib/github-reconcile"

function sign(secret: string, payload: string): string {
  const h = createHmac("sha256", secret)
  h.update(payload)
  return `sha256=${h.digest("hex")}`
}

describe("worker reconcile", () => {
  afterEach(async () => {
    __setClientOverride(null)
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  async function seedConnectedProject() {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    await db.insert(githubIntegrations).values({
      projectId: pid,
      installationId: 10,
      repoOwner: "acme",
      repoName: "frontend",
      defaultLabels: ["feedback"],
    })
    const [r] = await db
      .insert(reports)
      .values({
        projectId: pid,
        title: "Crash",
        description: "it crashed",
        context: {
          pageUrl: "https://app.example.com",
          userAgent: "UA",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
          reporter: { email: "r@e.com" },
        },
      })
      .returning({ id: reports.id })
    return { pid, reportId: r!.id }
  }

  test("first reconcile creates issue + writes github columns", async () => {
    const { reportId } = await seedConnectedProject()
    const { client, calls } = makeMock()
    __setClientOverride(() => client)
    await reconcileReport(reportId)
    expect(calls.createIssue.length).toBe(1)
    const [row] = await db.select().from(reports).where(eq(reports.id, reportId))
    expect(row?.githubIssueNumber).toBe(42)
  })

  test("reconcile closes issue when status=resolved", async () => {
    const { reportId } = await seedConnectedProject()
    await db
      .update(reports)
      .set({
        status: "resolved",
        githubIssueNumber: 42,
        githubIssueNodeId: "NODE_42",
        githubIssueUrl: "https://github.com/acme/frontend/issues/42",
      })
      .where(eq(reports.id, reportId))
    const { client, calls } = makeMock()
    __setClientOverride(() => client)
    await reconcileReport(reportId)
    expect(calls.closeIssue.length).toBe(1)
    expect(calls.closeIssue[0]?.reason).toBe("completed")
  })

  test("reconcile updates labels when priority changes", async () => {
    const { reportId } = await seedConnectedProject()
    await db
      .update(reports)
      .set({
        priority: "urgent",
        githubIssueNumber: 42,
        githubIssueNodeId: "NODE_42",
        githubIssueUrl: "https://github.com/acme/frontend/issues/42",
      })
      .where(eq(reports.id, reportId))
    const { client, calls } = makeMock({
      getIssue: async () => ({ state: "open", labels: ["priority:normal"] }),
    })
    __setClientOverride(() => client)
    await reconcileReport(reportId)
    expect(calls.updateIssueLabels.length).toBe(1)
    const newLabels = calls.updateIssueLabels[0]?.labels as string[]
    expect(newLabels).toContain("priority:urgent")
    expect(newLabels).not.toContain("priority:normal")
  })

  test("reconcile echo-suppresses when remote already matches", async () => {
    const { reportId } = await seedConnectedProject()
    await db
      .update(reports)
      .set({
        priority: "normal",
        status: "open",
        githubIssueNumber: 42,
        githubIssueNodeId: "NODE_42",
        githubIssueUrl: "https://github.com/acme/frontend/issues/42",
      })
      .where(eq(reports.id, reportId))
    const { client, calls } = makeMock({
      getIssue: async () => ({ state: "open", labels: ["feedback", "priority:normal"] }),
    })
    __setClientOverride(() => client)
    await reconcileReport(reportId)
    expect(calls.closeIssue.length).toBe(0)
    expect(calls.reopenIssue.length).toBe(0)
    expect(calls.updateIssueLabels.length).toBe(0)
  })
})

describe("webhook", () => {
  afterEach(async () => {
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("invalid signature → 401", async () => {
    const body = JSON.stringify({ action: "closed" })
    const res = await fetch("http://localhost:3000/api/integrations/github/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=bad" },
      body,
    })
    expect(res.status).toBe(401)
  })

  test("issues.closed updates dashboard + inserts event", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    await db.insert(githubIntegrations).values({
      projectId: pid,
      installationId: 10,
      repoOwner: "acme",
      repoName: "frontend",
    })
    const [r] = await db
      .insert(reports)
      .values({
        projectId: pid,
        title: "Crash",
        description: "x",
        context: {
          pageUrl: "x",
          userAgent: "x",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
        githubIssueNumber: 42,
        githubIssueNodeId: "NODE_42",
        githubIssueUrl: "https://github.com/acme/frontend/issues/42",
      })
      .returning({ id: reports.id })
    const body = JSON.stringify({
      action: "closed",
      issue: { number: 42, state: "closed", state_reason: "completed" },
      repository: { name: "frontend", owner: { login: "acme" } },
    })
    const res = await fetch("http://localhost:3000/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "issues",
        "x-hub-signature-256": sign(
          process.env.GITHUB_APP_WEBHOOK_SECRET ?? "test-webhook-secret",
          body,
        ),
      },
      body,
    })
    expect(res.status).toBe(202)
    const [updated] = await db.select().from(reports).where(eq(reports.id, r!.id))
    expect(updated?.status).toBe("resolved")
    const evs = await db.select().from(reportEvents).where(eq(reportEvents.reportId, r!.id))
    expect(evs.length).toBe(1)
    expect(evs[0]?.kind).toBe("status_changed")
    expect(evs[0]?.actorId).toBeNull()
  })

  test("installation.deleted flips all matching integrations", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    await db
      .insert(githubIntegrations)
      .values({ projectId: pid, installationId: 555, repoOwner: "acme", repoName: "frontend" })
    const body = JSON.stringify({ action: "deleted", installation: { id: 555 } })
    const res = await fetch("http://localhost:3000/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "installation",
        "x-hub-signature-256": sign(
          process.env.GITHUB_APP_WEBHOOK_SECRET ?? "test-webhook-secret",
          body,
        ),
      },
      body,
    })
    expect(res.status).toBe(202)
    const [row] = await db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.projectId, pid))
    expect(row?.status).toBe("disconnected")
  })
})
```

- [ ] **Step 2: Run**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_sync_jobs, github_integrations, report_events, report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE" >/dev/null 2>&1 || true
cd apps/dashboard && bun test tests/api/github-sync.test.ts 2>&1 | tail -15
```

Expected: 13 pass (6 from Task 23 + 7 new).

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/tests/api/github-sync.test.ts
git commit -m "test(api): add worker reconcile + webhook integration tests"
```

---

### Task 25: Manual create/unlink + enqueue + permissions tests (~5 tests)

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/api/github-sync.test.ts` — append final describe

- [ ] **Step 1: Append**

```ts
describe("manual sync + unlink + enqueue hooks", () => {
  afterEach(async () => {
    await truncateGithub()
    await truncateReports()
    await truncateDomain()
  })

  test("POST /github-sync enqueues a job", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    await db
      .insert(githubIntegrations)
      .values({ projectId: pid, installationId: 10, repoOwner: "acme", repoName: "frontend" })
    const [r] = await db
      .insert(reports)
      .values({
        projectId: pid,
        title: "x",
        description: "x",
        context: {
          pageUrl: "x",
          userAgent: "x",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
      })
      .returning({ id: reports.id })
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${r!.id}/github-sync`, {
      method: "POST",
      headers: { cookie },
    })
    expect(status).toBe(200)
    const jobs = await db
      .select()
      .from(reportSyncJobs)
      .where(eq(reportSyncJobs.reportId, r!.id))
    expect(jobs.length).toBe(1)
    expect(jobs[0]?.state).toBe("pending")
  })

  test("POST /github-sync is idempotent (second call doesn't duplicate)", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    await db
      .insert(githubIntegrations)
      .values({ projectId: pid, installationId: 10, repoOwner: "acme", repoName: "frontend" })
    const [r] = await db
      .insert(reports)
      .values({
        projectId: pid,
        title: "x",
        description: "x",
        context: {
          pageUrl: "x",
          userAgent: "x",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
      })
      .returning({ id: reports.id })
    const cookie = await signIn("owner@example.com")
    await apiFetch(`/api/projects/${pid}/reports/${r!.id}/github-sync`, {
      method: "POST",
      headers: { cookie },
    })
    await apiFetch(`/api/projects/${pid}/reports/${r!.id}/github-sync`, {
      method: "POST",
      headers: { cookie },
    })
    const jobs = await db
      .select()
      .from(reportSyncJobs)
      .where(eq(reportSyncJobs.reportId, r!.id))
    expect(jobs.length).toBe(1)
  })

  test("POST /github-unlink clears columns + deletes pending job + inserts event", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    const [r] = await db
      .insert(reports)
      .values({
        projectId: pid,
        title: "x",
        description: "x",
        context: {
          pageUrl: "x",
          userAgent: "x",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
        githubIssueNumber: 7,
        githubIssueNodeId: "NODE_7",
        githubIssueUrl: "https://github.com/acme/frontend/issues/7",
      })
      .returning({ id: reports.id })
    await db.insert(reportSyncJobs).values({ reportId: r!.id })
    const cookie = await signIn("owner@example.com")
    const { status } = await apiFetch(`/api/projects/${pid}/reports/${r!.id}/github-unlink`, {
      method: "POST",
      headers: { cookie },
    })
    expect(status).toBe(200)
    const [row] = await db.select().from(reports).where(eq(reports.id, r!.id))
    expect(row?.githubIssueNumber).toBeNull()
    const jobs = await db
      .select()
      .from(reportSyncJobs)
      .where(eq(reportSyncJobs.reportId, r!.id))
    expect(jobs.length).toBe(0)
    const evs = await db
      .select()
      .from(reportEvents)
      .where(eq(reportEvents.reportId, r!.id))
    expect(evs.find((e) => e.kind === "github_unlinked")).toBeDefined()
  })

  test("intake with connected integration enqueues a sync job", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    await db
      .insert(githubIntegrations)
      .values({ projectId: pid, installationId: 10, repoOwner: "acme", repoName: "frontend" })
    const fd = new FormData()
    fd.set(
      "report",
      new Blob(
        [
          JSON.stringify({
            projectKey: PK,
            title: "from intake",
            description: "x",
            context: {
              pageUrl: "http://localhost:4000/p",
              userAgent: "UA",
              viewport: { w: 1, h: 1 },
              timestamp: new Date().toISOString(),
            },
          }),
        ],
        { type: "application/json" },
      ),
    )
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: fd,
    })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    const jobs = await db
      .select()
      .from(reportSyncJobs)
      .where(eq(reportSyncJobs.reportId, id))
    expect(jobs.length).toBe(1)
  })

  test("viewer forbidden on github-sync, github-unlink, retry-failed", async () => {
    const ownerId = await createUser("owner@example.com", "admin")
    const viewer = await createUser("viewer@example.com", "member")
    const pid = await seedProject({
      name: "g",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: ownerId,
    })
    const { projectMembers } = await import("../../server/db/schema")
    await db.insert(projectMembers).values({ projectId: pid, userId: viewer, role: "viewer" })
    const [r] = await db
      .insert(reports)
      .values({
        projectId: pid,
        title: "x",
        description: "x",
        context: {
          pageUrl: "x",
          userAgent: "x",
          viewport: { w: 1, h: 1 },
          timestamp: new Date().toISOString(),
        },
      })
      .returning({ id: reports.id })
    const cookie = await signIn("viewer@example.com")
    const r1 = await apiFetch(`/api/projects/${pid}/reports/${r!.id}/github-sync`, {
      method: "POST",
      headers: { cookie },
    })
    expect(r1.status).toBe(403)
    const r2 = await apiFetch(`/api/projects/${pid}/reports/${r!.id}/github-unlink`, {
      method: "POST",
      headers: { cookie },
    })
    expect(r2.status).toBe(403)
    const r3 = await apiFetch(`/api/projects/${pid}/integrations/github/retry-failed`, {
      method: "POST",
      headers: { cookie },
    })
    expect(r3.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run all GH tests**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_sync_jobs, github_integrations, report_events, report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE" >/dev/null 2>&1 || true
cd apps/dashboard && bun test tests/api/github-sync.test.ts 2>&1 | tail -15
```

Expected: 18 pass total.

- [ ] **Step 3: Run regression**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/ 2>&1 | tail -10
```

Expected: inbox (12), intake (4), logs-intake (4), members + users + projects tests all still pass. The regression-critical bit is that existing intake still returns 201 even when enqueue fails (we catch-log, don't throw).

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/tests/api/github-sync.test.ts
git commit -m "test(api): add manual sync/unlink/enqueue/permissions tests"
```

---

## Phase 8 — UI

### Task 26: Settings panel + repo-picker

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/integrations/github/github-panel.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/integrations/github/repo-picker.vue`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/projects/[id]/settings.vue` — add GitHub tab

- [ ] **Step 1: Create `repo-picker.vue`**

```vue
<!-- apps/dashboard/app/components/integrations/github/repo-picker.vue -->
<script setup lang="ts">
interface Repo {
  id: number
  owner: string
  name: string
  fullName: string
}
interface Props {
  repos: Repo[]
  modelValue: { owner: string; name: string }
}
defineProps<Props>()
const emit = defineEmits<{ "update:modelValue": [{ owner: string; name: string }] }>()
</script>

<template>
  <select
    :value="modelValue.owner && modelValue.name ? `${modelValue.owner}/${modelValue.name}` : ''"
    class="border rounded px-2 py-1 text-sm w-full"
    @change="
      (e) => {
        const v = (e.target as HTMLSelectElement).value
        const [owner, name] = v.split('/')
        emit('update:modelValue', { owner: owner ?? '', name: name ?? '' })
      }
    "
  >
    <option value="" disabled>Select a repository…</option>
    <option v-for="r in repos" :key="r.id" :value="r.fullName">{{ r.fullName }}</option>
  </select>
</template>
```

- [ ] **Step 2: Create `github-panel.vue`**

```vue
<!-- apps/dashboard/app/components/integrations/github/github-panel.vue -->
<script setup lang="ts">
import type { GithubConfigDTO } from "@feedback-tool/shared"
import RepoPicker from "./repo-picker.vue"
import SyncStatus from "./sync-status.vue"

interface Props {
  projectId: string
}
const props = defineProps<Props>()

const { data, refresh } = useApi<GithubConfigDTO>(
  `/api/projects/${props.projectId}/integrations/github`,
)

const repos = ref<Array<{ id: number; owner: string; name: string; fullName: string }>>([])
const selectedRepo = ref({ owner: "", name: "" })
const labelsText = ref("")
const assigneesText = ref("")
const saving = ref(false)

watch(
  data,
  (v) => {
    if (!v) return
    selectedRepo.value = { owner: v.repoOwner, name: v.repoName }
    labelsText.value = v.defaultLabels.join(", ")
    assigneesText.value = v.defaultAssignees.join(", ")
  },
  { immediate: true },
)

async function install() {
  const { url } = await $fetch<{ url: string }>(
    `/api/projects/${props.projectId}/integrations/github/install-redirect`,
    { method: "POST", credentials: "include" },
  )
  window.location.href = url
}

async function save() {
  saving.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/integrations/github`, {
      method: "PATCH",
      credentials: "include",
      body: {
        repoOwner: selectedRepo.value.owner,
        repoName: selectedRepo.value.name,
        defaultLabels: labelsText.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        defaultAssignees: assigneesText.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    })
    await refresh()
  } finally {
    saving.value = false
  }
}

async function disconnect() {
  if (!confirm("Disconnect GitHub integration? Pending sync jobs will stop.")) return
  await $fetch(`/api/projects/${props.projectId}/integrations/github/disconnect`, {
    method: "POST",
    credentials: "include",
  })
  await refresh()
}
</script>

<template>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">GitHub integration</h2>

    <!-- Not installed -->
    <div v-if="!data?.installed" class="border rounded p-4 bg-white">
      <p class="text-sm text-neutral-600 mb-3">
        Auto-create GitHub issues for every new report and keep status synchronized.
      </p>
      <button type="button" class="border rounded px-3 py-1.5 text-sm" @click="install">
        🐙 Install on GitHub
      </button>
    </div>

    <!-- Connected -->
    <div v-else-if="data.status === 'connected'" class="border rounded p-4 bg-white space-y-3">
      <div class="flex items-center gap-2">
        <span class="inline-block w-2 h-2 rounded-full bg-green-500"></span>
        <span class="text-sm font-medium">connected</span>
      </div>
      <div v-if="data.repoOwner && data.repoName" class="text-sm">
        Repo: <strong>{{ data.repoOwner }}/{{ data.repoName }}</strong>
      </div>
      <div v-else class="text-sm text-orange-700">
        Pick a repo to start syncing:
        <RepoPicker v-model="selectedRepo" :repos="repos" class="mt-2" />
      </div>

      <label class="block text-sm">
        Default labels
        <input v-model="labelsText" class="border rounded px-2 py-1 w-full text-sm" />
      </label>

      <label class="block text-sm">
        Default assignees (GitHub usernames, comma-separated)
        <input v-model="assigneesText" class="border rounded px-2 py-1 w-full text-sm" />
      </label>

      <div class="flex gap-2">
        <button
          type="button"
          class="border rounded px-3 py-1.5 text-sm"
          :disabled="saving"
          @click="save"
        >
          {{ saving ? "Saving…" : "Save" }}
        </button>
        <button
          type="button"
          class="border rounded px-3 py-1.5 text-sm text-red-700"
          @click="disconnect"
        >
          Disconnect
        </button>
      </div>

      <SyncStatus :project-id="projectId" @retried="refresh()" />
    </div>

    <!-- Disconnected -->
    <div v-else class="border border-red-300 bg-red-50 rounded p-4 text-sm">
      ⚠ GitHub integration disconnected. The App was uninstalled or access was revoked.
      <button
        type="button"
        class="mt-3 border border-red-400 rounded px-3 py-1.5 bg-white"
        @click="install"
      >
        🐙 Reconnect
      </button>
    </div>
  </section>
</template>
```

- [ ] **Step 3: Add the "GitHub" tab to settings.vue**

Read `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/projects/[id]/settings.vue` first, then add a new tab that renders `<GithubPanel :project-id="(route.params.id as string)" />`. Depending on how existing tabs are structured, this may be a new top-level section or a tab in an existing tab list.

- [ ] **Step 4: Verify build**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/integrations/github/github-panel.vue \
        apps/dashboard/app/components/integrations/github/repo-picker.vue \
        apps/dashboard/app/pages/projects/[id]/settings.vue
git commit -m "feat(dashboard): add GitHub settings panel + repo picker"
```

---

### Task 27: Sync status component

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/integrations/github/sync-status.vue`

- [ ] **Step 1: Create**

```vue
<!-- apps/dashboard/app/components/integrations/github/sync-status.vue -->
<script setup lang="ts">
import type { GithubConfigDTO } from "@feedback-tool/shared"

interface Props {
  projectId: string
}
const props = defineProps<Props>()
const emit = defineEmits<{ retried: [] }>()

const { data, refresh } = useApi<GithubConfigDTO>(
  `/api/projects/${props.projectId}/integrations/github`,
)

async function retryAll() {
  await $fetch(`/api/projects/${props.projectId}/integrations/github/retry-failed`, {
    method: "POST",
    credentials: "include",
  })
  await refresh()
  emit("retried")
}

async function retryOne(reportId: string) {
  await $fetch(`/api/projects/${props.projectId}/reports/${reportId}/github-sync`, {
    method: "POST",
    credentials: "include",
  })
  await refresh()
  emit("retried")
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
</script>

<template>
  <div class="border-t pt-3 space-y-2">
    <div class="flex items-baseline justify-between">
      <h3 class="text-sm font-medium">Sync status</h3>
      <button
        v-if="(data?.failedJobs.length ?? 0) > 0"
        type="button"
        class="text-xs border rounded px-2 py-0.5"
        @click="retryAll"
      >
        Retry all
      </button>
    </div>
    <div v-if="data?.lastSyncedAt" class="text-xs text-neutral-500">
      Last synced: {{ relTime(data.lastSyncedAt) }}
    </div>
    <div v-if="!data?.failedJobs.length" class="text-xs text-neutral-400">No failed jobs.</div>
    <ul v-else class="text-xs space-y-1">
      <li
        v-for="j in data.failedJobs"
        :key="j.reportId"
        class="flex items-start gap-2 bg-red-50 rounded p-2"
      >
        <div class="flex-1">
          <div class="font-medium">{{ j.reportTitle }}</div>
          <div class="text-neutral-600">{{ j.lastError ?? "Unknown error" }}</div>
          <div class="text-neutral-400">
            {{ j.attempts }} attempts · {{ relTime(j.updatedAt) }}
          </div>
        </div>
        <button
          type="button"
          class="border border-red-300 rounded px-2 py-0.5 self-center"
          @click="retryOne(j.reportId)"
        >
          Retry
        </button>
      </li>
    </ul>
  </div>
</template>
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/integrations/github/sync-status.vue
git commit -m "feat(dashboard): add sync-status component with failed-jobs + retry"
```

---

### Task 28: Drawer triage panel GitHub row + unlink dialog

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/report-drawer/triage-panel.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/integrations/github/unlink-dialog.vue`

- [ ] **Step 1: Create the unlink dialog**

```vue
<!-- apps/dashboard/app/components/integrations/github/unlink-dialog.vue -->
<script setup lang="ts">
interface Props {
  issueNumber: number
  repoFullName: string
  open: boolean
}
defineProps<Props>()
const emit = defineEmits<{ cancel: []; confirm: [] }>()
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
    @click="emit('cancel')"
  >
    <div class="bg-white rounded-lg p-4 max-w-md text-sm" @click.stop>
      <h3 class="font-semibold mb-2">Unlink this report from issue #{{ issueNumber }}?</h3>
      <p class="text-neutral-600 mb-3">
        The GitHub issue will stay open in <code>{{ repoFullName }}</code> but won't sync with the
        dashboard anymore. You can create a new issue afterward.
      </p>
      <div class="flex gap-2 justify-end">
        <button type="button" class="border rounded px-3 py-1.5" @click="emit('cancel')">
          Cancel
        </button>
        <button
          type="button"
          class="border rounded px-3 py-1.5 text-red-700"
          @click="emit('confirm')"
        >
          Unlink
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Add a GitHub row to `triage-panel.vue`**

Add these to the existing `triage-panel.vue` (inside `<script setup>` block and `<template>` block):

In `<script setup>`, near the existing props/emits:

```ts
import UnlinkDialog from "~/components/integrations/github/unlink-dialog.vue"

const unlinkOpen = ref(false)
const ghSubmitting = ref(false)

async function createIssue() {
  ghSubmitting.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/reports/${props.report.id}/github-sync`, {
      method: "POST",
      credentials: "include",
    })
    emit("patched")
  } finally {
    ghSubmitting.value = false
  }
}

async function unlink() {
  await $fetch(`/api/projects/${props.projectId}/reports/${props.report.id}/github-unlink`, {
    method: "POST",
    credentials: "include",
  })
  unlinkOpen.value = false
  emit("patched")
}
```

In the `<template>`, add below the existing tags row (inside the wrapper div):

```vue
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="text-xs uppercase text-neutral-500">GitHub</span>
      <template v-if="report.githubIssueNumber && report.githubIssueUrl">
        <a
          :href="report.githubIssueUrl"
          target="_blank"
          rel="noopener"
          class="underline text-neutral-700"
          >#{{ report.githubIssueNumber }}</a
        >
        <button
          v-if="canEdit"
          type="button"
          class="text-neutral-400 hover:text-neutral-900 text-xs"
          @click="unlinkOpen = true"
        >
          Unlink
        </button>
      </template>
      <button
        v-else-if="canEdit"
        type="button"
        class="border rounded px-2 py-0.5 text-xs"
        :disabled="ghSubmitting"
        @click="createIssue"
      >
        {{ ghSubmitting ? "Creating…" : "Create GitHub issue" }}
      </button>
      <span v-else class="text-neutral-400 text-xs">—</span>
    </div>
    <UnlinkDialog
      v-if="report.githubIssueNumber && report.githubIssueUrl"
      :issue-number="report.githubIssueNumber"
      :repo-full-name="report.githubIssueUrl.replace('https://github.com/', '').split('/issues/')[0]"
      :open="unlinkOpen"
      @cancel="unlinkOpen = false"
      @confirm="unlink"
    />
```

Update `ReportSummaryDTO` type usage — F's schema didn't expose `githubIssueNumber` / `githubIssueUrl` on the DTO. We need to extend `packages/shared/src/reports.ts` — add these fields to `ReportSummaryDTO`:

```ts
  githubIssueNumber: z.number().int().nullable(),
  githubIssueUrl: z.string().nullable(),
```

And update the list endpoint (`apps/dashboard/server/api/projects/[id]/reports/index.get.ts`) to SELECT + return these fields in each row.

- [ ] **Step 3: Verify build**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/shared/src/reports.ts \
        apps/dashboard/server/api/projects/[id]/reports/index.get.ts \
        apps/dashboard/app/components/report-drawer/triage-panel.vue \
        apps/dashboard/app/components/integrations/github/unlink-dialog.vue
git commit -m "feat(dashboard): drawer GitHub row — linked/unlinked/unlink dialog + DTO extension"
```

---

### Task 29: Inbox GitHub badge

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/inbox/report-row.vue`

- [ ] **Step 1: Add GitHub badge to each row**

In `report-row.vue`, add a new `<td>` between the title cell and the assignee cell:

```vue
    <td class="p-2 text-xs">
      <a
        v-if="report.githubIssueNumber && report.githubIssueUrl"
        :href="report.githubIssueUrl"
        target="_blank"
        rel="noopener"
        class="text-neutral-500 hover:text-neutral-900"
        :title="`GitHub issue #${report.githubIssueNumber}`"
        @click.stop
      >
        🐙#{{ report.githubIssueNumber }}
      </a>
      <span v-else class="text-neutral-300">—</span>
    </td>
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bunx nuxt prepare 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/inbox/report-row.vue
git commit -m "feat(dashboard): add GitHub badge column to inbox list"
```

---

## Phase 9 — Gate + tag

### Task 30: Threat model + full gate + manual smoke + tag v0.6.0-github-sync

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/docs/superpowers/security/threat-model.md`

- [ ] **Step 1: Append §G section**

Append to `docs/superpowers/security/threat-model.md`:

```markdown

## Sub-project G — GitHub Issues sync

- **App private key** lives only in `GITHUB_APP_PRIVATE_KEY` env. Never logged; never persisted in DB. Missing → install attempts return "GitHub not configured".
- **Webhook HMAC verification** via `crypto.timingSafeEqual` on raw request bytes. Rejected 401 before any DB access.
- **Install callback `state`** is HMAC-signed `{projectId, userId, exp}` with 10-minute TTL. Prevents install-redirect hijacking.
- **Signed attachment URLs** use HMAC-SHA256 over `{projectId, reportId, kind, expiresAt}` with 7-day expiry. Separate `ATTACHMENT_URL_SECRET` env var, rotatable independently of the App private key.
- **Installation token lifecycle** — requested via App JWT, cached in-process, refreshed lazily; never persisted.
- **Mass-enqueue DoS** — bounded by intake's existing rate limits from B. Worker ceiling ~10 jobs/minute well below GitHub's 5000/hr per-installation.
- **Stale sync jobs for deleted rows** — FK CASCADEs on `report_id` and `project_id`.
- **GitHub-side label pollution** — `updateIssueLabels` is full-replacement; manual labels in GitHub get overwritten on next triage sync. Documented.
- **Orphan issues from unlink** — intentional: dashboard explicitly abandons ownership.
```

- [ ] **Step 2: Run full gate**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run check 2>&1 | tail -3
cd apps/dashboard && bun test tests/lib/github-helpers.test.ts tests/lib/signed-attachment-url.test.ts 2>&1 | tail -5
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_sync_jobs, github_integrations, report_events, report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE" >/dev/null 2>&1 || true
(cd apps/dashboard && bun test 2>&1 | tail -10)
```

Expected:
- `bun run check` → 0 errors.
- Unit tests all pass (19 + 4 = 23 lib tests).
- Full dashboard suite: ~100+ tests pass (includes F, D, G, intake, members, projects).

- [ ] **Step 3: Commit threat model**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add docs/superpowers/security/threat-model.md
git commit -m "docs(security): document sub-project G threat model additions"
```

- [ ] **Step 4: Manual smoke (DEFERRED to user — requires real GitHub App registration)**

Document the 9 smoke steps from §8.4 of the spec as PENDING USER VERIFICATION in the final summary. Do not run; no automation possible without a real App.

- [ ] **Step 5: Tag only if all gate checks passed**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git tag -a v0.6.0-github-sync -m "Sub-project G complete: GitHub Issues sync

- Schema: github_integrations + report_sync_jobs tables; github_issue_*
  columns on reports; github_unlinked added to report_events.kind enum.
- Adapter: new packages/integrations/github with Octokit-backed client +
  pure HMAC webhook verifier.
- Auto-create on intake + durable Postgres queue + Nitro scheduled task
  (once per minute) with exponential backoff (max 5 attempts).
- Two-way sync: status flows both directions; labels outbound only.
- Install flow via GitHub App (replaces OAuth App for sign-in too).
- Signed attachment URLs (7-day HMAC) for GitHub-embedded screenshots.
- Settings panel (install/connected/disconnected states), sync status
  with per-job + bulk retry, drawer triage row with unlink dialog.
- 18 integration tests + 19 + 4 unit tests. All green.
- Dashboard-only change; SDK bundle unchanged."

git tag | tail -6
```

---

## Self-review

### Spec coverage

| Spec section | Task(s) |
| --- | --- |
| §2 locked decisions (two-way sync, App auth, repo mapping, auto-create, queue, inbound status only, outbound status+labels, LWW, rich body w/ signed URL, default labels, sync panel, webhook App-level, unlink, no backfill) | all tasks |
| §5.1 reports.github_* columns | Task 1 |
| §5.2 github_integrations table | Task 2 |
| §5.3 report_sync_jobs table | Task 2 |
| §5.4 indexes | Task 2 |
| §5.5 github_unlinked event kind | Task 1 |
| §5.6 env vars | Task 14 |
| §6.1 all 10 endpoints | Tasks 17, 18, 19, 20, 21, 22 |
| §6.2 adapter interface | Tasks 10, 11, 12 |
| §6.3 worker reconcile | Tasks 15, 16 |
| §6.4 enqueue hooks | Task 22 |
| §6.5 issue body format | Task 6 (pure helper); Task 15 uses it |
| §6.6 webhook handler | Task 21 |
| §7.1 settings panel 4 states | Task 26 |
| §7.2 drawer triage row | Task 28 |
| §7.3 inbox badge | Task 29 |
| §7.4 permissions | enforced in each endpoint (owner/developer+/viewer) |
| §7.5 unlink confirm dialog | Task 28 |
| §8.1 unit tests | Tasks 4, 5, 6, 7, 10 |
| §8.2 integration tests | Tasks 23, 24, 25 |
| §8.3 regression | Task 25 step 3 |
| §8.4 manual smoke | Task 30 step 4 (deferred to user) |
| §9 threat model | Task 30 step 1 |
| §10 done criteria + tag | Task 30 |

### Placeholder scan

No "TBD" / "implement later" / silent "handle edge cases" steps. Every task has runnable code. The Nitro scheduled-task cadence shifted from 10s (spec) to 1m (plan) because Nitro's `scheduledTasks` uses cron with 1-minute granularity; documented inline in Task 16 with the upgrade path.

### Type consistency

- `GitHubInstallationClient` / `GitHubIssueRef` / `CreateIssueInput` defined in Task 11, consumed in Tasks 15, 23, 24, 25.
- `GithubConfigDTO` / `UpdateGithubConfigInput` defined in Task 13, consumed in Tasks 17, 19, 26.
- `labelsFor` / `buildIssueBody` / `computeBackoff` signatures consistent across the reconcile, worker, and test usages.
- `verifyWebhookSignature` signature consistent between adapter (Task 10) and dashboard consumer (Task 21).
- `signAttachmentToken` / `verifyAttachmentToken` pair consistent in Task 7 + attachment endpoint (Task 8) + reconcile (Task 15).

### Known deferrals (documented in spec + here)

- Nitro cron minimum 1 minute (spec said 10s; accepted).
- Manual smoke walk requires real GitHub App setup — deferred to user.
- `ReportSummaryDTO` DTO extension for the GitHub columns lands in Task 28 alongside the drawer change; Task 28 also updates the list endpoint select to include them.
