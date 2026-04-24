# Deeper GitHub Integration — Phase 0 (Backbone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every non-user-facing piece of the deeper GitHub integration — webhook authenticity hardening, all new DB tables + column additions, the user-identity linking system (`/settings/identities`), opportunistic identity backfill from `better-auth`, and the atomic `assignee_id → report_assignees` split — without changing what triagers see day-to-day.

**Architecture:** Four self-contained sections, ordered by dependency and risk (smallest first): (A) webhook hardening, (B) additive schema for future phases, (C) user identities + settings UI, (D) the assignee split + DTO shape change, (E) docs. Each section is independently shippable.

**Tech Stack:** Nuxt 4, Nitro, Drizzle ORM, PostgreSQL 17, Vue 3, Nuxt UI, better-auth, Zod, `bun:test`, oxlint/oxfmt, Octokit.

**Spec:** `docs/superpowers/specs/2026-04-24-deeper-github-integration-design.md`

**Scope kept OUT of Phase 0** (goes into Phase 1+): live pickers, multi-select assignees UX, push-on-edit reconciler changes, comments two-way, auto-create on intake.

---

## File structure

### New files
- `apps/dashboard/server/lib/github-webhook-auth.ts` — size cap, HMAC verify, replay dedupe, installation allowlist, composed in one helper.
- `apps/dashboard/server/lib/github-webhook-auth.test.ts` — unit tests for the composable helper.
- `apps/dashboard/server/lib/github-identities.ts` — `resolveGithubUser()` + `linkGithubIdentity()` + `unlinkGithubIdentity()`.
- `apps/dashboard/server/lib/github-identities.test.ts` — unit tests for resolver + upsert semantics.
- `apps/dashboard/server/lib/identity-oauth-state.ts` — signed state blob for the OAuth link flow (HMAC).
- `apps/dashboard/server/lib/identity-oauth-state.test.ts` — unit tests.
- `apps/dashboard/server/api/me/identities/index.get.ts`
- `apps/dashboard/server/api/me/identities/github/start.post.ts`
- `apps/dashboard/server/api/me/identities/github/callback.get.ts`
- `apps/dashboard/server/api/me/identities/github/index.delete.ts`
- `apps/dashboard/server/db/schema/user-identities.ts`
- `apps/dashboard/server/db/schema/report-assignees.ts`
- `apps/dashboard/server/db/schema/report-comments.ts`
- `apps/dashboard/server/db/schema/github-write-locks.ts`
- `apps/dashboard/server/db/schema/github-webhook-deliveries.ts`
- `apps/dashboard/app/pages/settings/identities.vue`
- `apps/dashboard/app/components/settings/identity-row.vue`
- `apps/dashboard/tests/api/webhook-auth.test.ts`
- `apps/dashboard/tests/api/identities.test.ts`
- `apps/dashboard/tests/api/assignees-multi.test.ts`
- `apps/dashboard/tests/lib/github-identities.test.ts` (if co-located fails; else beside source)

### Modified files
- `apps/dashboard/server/api/integrations/github/webhook.post.ts` — use the new composed auth helper; remove inline signature-verify-only path.
- `apps/dashboard/server/db/schema/reports.ts` — drop `assigneeId`, add `milestoneNumber`, `milestoneTitle`, `githubSyncedAt`, `githubCommentsSyncedAt`.
- `apps/dashboard/server/db/schema/github-integrations.ts` — add `autoCreateOnIntake`, `pushOnEdit`, `labelsLastSyncedAt`, `milestonesLastSyncedAt`, `membersLastSyncedAt`.
- `apps/dashboard/server/db/schema/report-events.ts` — extend `reportEventKinds` enum.
- `apps/dashboard/server/db/schema/index.ts` (if it exists — aggregator barrel) — re-export the new schema modules.
- `apps/dashboard/server/api/projects/[id]/reports/index.get.ts` — read assignees via `report_assignees` join.
- `apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.get.ts` — read assignees via `report_assignees` join.
- `apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts` — write assignees to `report_assignees` (transactional diff), emit `assignee_added`/`assignee_removed`.
- `apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts` — same refactor; preserve today's "Replace" behavior (multi-UX lands Phase 1).
- `apps/dashboard/server/lib/report-events.ts` — support new kinds; deprecate `assignee_changed` writer path in favor of `assignee_added`/`assignee_removed`.
- `packages/shared/src/reports.ts` — `ReportSummaryDTO.assignee` → `ReportSummaryDTO.assignees: ReportAssigneeDTO[]`; `TriagePatchInput.assigneeId` → `TriagePatchInput.assigneeIds?: string[] | null`.
- `apps/dashboard/app/components/report-drawer/triage-footer.vue` — read `assignees[0]`, write `assigneeIds: [id]` (keeps today's single-select UX intact).
- `apps/dashboard/app/components/inbox/facet-sidebar.vue` — bind to `assignees` array on each row.
- `apps/dashboard/app/pages/projects/[id]/reports/index.vue` — render first assignee in table rows; keep single-select bulk-assign dialog.
- `apps/dashboard/app/composables/use-inbox-query.ts` — no shape change (CSV still works), but comment update: "any assignee ∈ list".
- `apps/dashboard/tests/api/inbox.test.ts` — rewrite seed + assertions for `report_assignees`.
- `apps/dashboard/tests/api/manager-role.test.ts` — rewrite.
- `docs/self-hosting/integrations.md` — new H3: "Rotating the webhook secret"; mention new `push_on_edit` / `auto_create_on_intake` columns as reserved for future toggles (toggles themselves ship in later phases).

---

## Section A — Webhook authenticity hardening

Smallest, isolated, ships first. No dependencies on other sections.

### Task 1: Add size-cap + HMAC composable

**Files:**
- Create: `apps/dashboard/server/lib/github-webhook-auth.ts`
- Create: `apps/dashboard/server/lib/github-webhook-auth.test.ts`

- [ ] **Step 1: Write failing tests**

`apps/dashboard/server/lib/github-webhook-auth.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { checkBodySize, MAX_WEBHOOK_BODY_BYTES } from "./github-webhook-auth"

describe("checkBodySize", () => {
  test("accepts body at the limit", () => {
    const body = Buffer.alloc(MAX_WEBHOOK_BODY_BYTES)
    expect(checkBodySize(body.byteLength)).toBe(true)
  })

  test("rejects body over the limit", () => {
    expect(checkBodySize(MAX_WEBHOOK_BODY_BYTES + 1)).toBe(false)
  })

  test("accepts missing content-length", () => {
    expect(checkBodySize(undefined)).toBe(true)
  })

  test("rejects non-numeric content-length", () => {
    expect(checkBodySize(Number.NaN)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `bun test apps/dashboard/server/lib/github-webhook-auth.test.ts`
Expected: 4 failing tests (module does not exist).

- [ ] **Step 3: Implement the helper**

`apps/dashboard/server/lib/github-webhook-auth.ts`:

```ts
export const MAX_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024

export function checkBodySize(length: number | undefined): boolean {
  if (length === undefined) return true
  if (!Number.isFinite(length)) return false
  return length <= MAX_WEBHOOK_BODY_BYTES
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test apps/dashboard/server/lib/github-webhook-auth.test.ts`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/lib/github-webhook-auth.ts \
        apps/dashboard/server/lib/github-webhook-auth.test.ts
git commit -m "feat(webhook): add size cap helper for github webhooks"
```

### Task 2: Schema — `github_webhook_deliveries`

**Files:**
- Create: `apps/dashboard/server/db/schema/github-webhook-deliveries.ts`
- Modify: `apps/dashboard/server/db/schema/index.ts` (re-export if barrel exists)

- [ ] **Step 1: Write the schema**

`apps/dashboard/server/db/schema/github-webhook-deliveries.ts`:

```ts
import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core"

export const githubWebhookDeliveries = pgTable(
  "github_webhook_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("github_webhook_deliveries_received_at_idx").on(table.receivedAt)],
)
```

- [ ] **Step 2: Re-export from barrel (if present)**

If `apps/dashboard/server/db/schema/index.ts` exists, append:

```ts
export * from "./github-webhook-deliveries"
```

If no barrel exists, skip this step.

- [ ] **Step 3: Generate the migration**

Run: `bun run db:gen`
Expected: new migration file created under `apps/dashboard/server/db/migrations/`. Open it and verify it contains `CREATE TABLE "github_webhook_deliveries"` with `delivery_id text PRIMARY KEY` and the `received_at` index.

- [ ] **Step 4: Apply the migration**

Run: `bun run db:push`
Expected: migration applied cleanly; no data loss on existing tables.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/db/schema/github-webhook-deliveries.ts \
        apps/dashboard/server/db/schema/index.ts \
        apps/dashboard/server/db/migrations/
git commit -m "feat(db): add github_webhook_deliveries table for replay protection"
```

### Task 3: Replay-dedupe helper with real DB

**Files:**
- Modify: `apps/dashboard/server/lib/github-webhook-auth.ts`
- Modify: `apps/dashboard/server/lib/github-webhook-auth.test.ts`

- [ ] **Step 1: Add failing test**

Append to `apps/dashboard/server/lib/github-webhook-auth.test.ts`:

```ts
import { recordDelivery } from "./github-webhook-auth"
import { db } from "../db"
import { githubWebhookDeliveries } from "../db/schema/github-webhook-deliveries"
import { eq } from "drizzle-orm"

describe("recordDelivery", () => {
  test("returns 'new' for first-seen delivery id", async () => {
    const id = `test-${crypto.randomUUID()}`
    expect(await recordDelivery(id)).toBe("new")
    await db.delete(githubWebhookDeliveries).where(eq(githubWebhookDeliveries.deliveryId, id))
  })

  test("returns 'replay' for a previously-seen id", async () => {
    const id = `test-${crypto.randomUUID()}`
    expect(await recordDelivery(id)).toBe("new")
    expect(await recordDelivery(id)).toBe("replay")
    await db.delete(githubWebhookDeliveries).where(eq(githubWebhookDeliveries.deliveryId, id))
  })
})
```

- [ ] **Step 2: Run tests, verify the two new ones fail**

Run: `bun test apps/dashboard/server/lib/github-webhook-auth.test.ts`
Expected: 4 existing tests pass; 2 new tests fail (`recordDelivery` not exported).

- [ ] **Step 3: Implement `recordDelivery`**

Append to `apps/dashboard/server/lib/github-webhook-auth.ts`:

```ts
import { db } from "../db"
import { githubWebhookDeliveries } from "../db/schema/github-webhook-deliveries"

export type DeliveryStatus = "new" | "replay"

export async function recordDelivery(deliveryId: string): Promise<DeliveryStatus> {
  const [inserted] = await db
    .insert(githubWebhookDeliveries)
    .values({ deliveryId })
    .onConflictDoNothing()
    .returning({ deliveryId: githubWebhookDeliveries.deliveryId })
  return inserted ? "new" : "replay"
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test apps/dashboard/server/lib/github-webhook-auth.test.ts`
Expected: 6 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/lib/github-webhook-auth.ts \
        apps/dashboard/server/lib/github-webhook-auth.test.ts
git commit -m "feat(webhook): add delivery dedupe for replay protection"
```

### Task 4: Installation allowlist check

**Files:**
- Modify: `apps/dashboard/server/lib/github-webhook-auth.ts`
- Modify: `apps/dashboard/server/lib/github-webhook-auth.test.ts`

- [ ] **Step 1: Add failing test**

Append to `apps/dashboard/server/lib/github-webhook-auth.test.ts`:

```ts
import { isKnownInstallation } from "./github-webhook-auth"
import { githubIntegrations } from "../db/schema/github-integrations"
import { projects } from "../db/schema/projects"

describe("isKnownInstallation", () => {
  test("returns false when no row matches", async () => {
    expect(await isKnownInstallation(999_999_999)).toBe(false)
  })

  test("returns true when a github_integrations row has the installation id", async () => {
    const [project] = await db
      .insert(projects)
      .values({ name: "wh-auth-test", slug: `wh-auth-${crypto.randomUUID()}` })
      .returning()
    const installationId = 42_000_000 + Math.floor(Math.random() * 1_000_000)
    await db.insert(githubIntegrations).values({
      projectId: project.id,
      installationId,
      repoOwner: "",
      repoName: "",
      status: "connected",
    })
    expect(await isKnownInstallation(installationId)).toBe(true)
    await db.delete(githubIntegrations).where(eq(githubIntegrations.projectId, project.id))
    await db.delete(projects).where(eq(projects.id, project.id))
  })
})
```

- [ ] **Step 2: Run tests, verify the two new ones fail**

Run: `bun test apps/dashboard/server/lib/github-webhook-auth.test.ts`
Expected: 6 existing pass; 2 new fail (`isKnownInstallation` not exported).

- [ ] **Step 3: Implement**

Append to `apps/dashboard/server/lib/github-webhook-auth.ts`:

```ts
import { githubIntegrations } from "../db/schema/github-integrations"

export async function isKnownInstallation(installationId: number): Promise<boolean> {
  const [row] = await db
    .select({ projectId: githubIntegrations.projectId })
    .from(githubIntegrations)
    .where(eq(githubIntegrations.installationId, installationId))
    .limit(1)
  return !!row
}
```

Also add `import { eq } from "drizzle-orm"` at the top of the file if not already present.

- [ ] **Step 4: Run tests, verify they pass**

Run: `bun test apps/dashboard/server/lib/github-webhook-auth.test.ts`
Expected: 8 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/lib/github-webhook-auth.ts \
        apps/dashboard/server/lib/github-webhook-auth.test.ts
git commit -m "feat(webhook): check installation id against known integrations"
```

### Task 5: Wire the three checks into the webhook handler

**Files:**
- Modify: `apps/dashboard/server/api/integrations/github/webhook.post.ts`

- [ ] **Step 1: Read the current handler**

Read `apps/dashboard/server/api/integrations/github/webhook.post.ts` top-to-bottom. Locate: (a) the raw-body read, (b) the signature verification call, (c) the event-dispatch switch. Note the line numbers — the three new checks go between (a) and (b), and between (b) and (c).

- [ ] **Step 2: Add size-cap at the top of the handler**

Immediately after the `defineEventHandler` opening brace and the first `const req = event.node.req` (or equivalent), insert:

```ts
import { checkBodySize, MAX_WEBHOOK_BODY_BYTES, recordDelivery, isKnownInstallation } from "~/server/lib/github-webhook-auth"

// inside the handler, before reading the body:
const contentLength = Number(getRequestHeader(event, "content-length") ?? NaN)
if (!checkBodySize(contentLength)) {
  throw createError({ statusCode: 413, statusMessage: "Payload Too Large" })
}
```

- [ ] **Step 3: Add delivery dedupe + installation check after signature verify**

After the existing `verifyWebhookSignature(...)` call succeeds, but before the event-type `switch`, insert:

```ts
const deliveryId = getRequestHeader(event, "x-github-delivery")
if (!deliveryId) {
  throw createError({ statusCode: 400, statusMessage: "Missing X-GitHub-Delivery" })
}
if ((await recordDelivery(deliveryId)) === "replay") {
  setResponseStatus(event, 202)
  return { status: "replay" }
}

const installationId = payload?.installation?.id
if (typeof installationId === "number" && !(await isKnownInstallation(installationId))) {
  console.warn(`[github-webhook] unknown installation id: ${installationId}, delivery=${deliveryId}`)
  setResponseStatus(event, 202)
  return { status: "unknown-installation" }
}
```

Exact `payload` variable name: match the existing handler's JSON-parse result. If the handler currently names it `event_` or `body`, use that instead.

- [ ] **Step 4: Run existing webhook tests to confirm no regression**

Run: `bun test apps/dashboard/tests/api/github-sync.test.ts`
Expected: all tests still pass. If any fail, the test likely doesn't set `X-GitHub-Delivery` — update the test harness to include it (see Task 6).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/api/integrations/github/webhook.post.ts
git commit -m "feat(webhook): enforce size cap, replay dedupe, installation allowlist"
```

### Task 6: Integration tests for the hardened webhook

**Files:**
- Create: `apps/dashboard/tests/api/webhook-auth.test.ts`

- [ ] **Step 1: Write the test**

`apps/dashboard/tests/api/webhook-auth.test.ts`:

```ts
import { describe, test, expect, beforeAll } from "bun:test"
import { createHmac } from "node:crypto"
import { apiFetch, resetDb } from "./_helpers"
import { db } from "../../server/db"
import { githubWebhookDeliveries } from "../../server/db/schema/github-webhook-deliveries"
import { githubApp } from "../../server/db/schema/github-app"

const WEBHOOK_SECRET = "test-webhook-secret-abcdef"

function sign(body: string): string {
  const h = createHmac("sha256", WEBHOOK_SECRET)
  h.update(body)
  return `sha256=${h.digest("hex")}`
}

beforeAll(async () => {
  await resetDb()
  await db.insert(githubApp).values({
    id: 1,
    appId: "1",
    slug: "test",
    privateKey: "x",
    webhookSecret: WEBHOOK_SECRET,
    clientId: "x",
    clientSecret: "x",
    htmlUrl: "https://github.com/apps/test",
  })
})

describe("webhook auth", () => {
  test("413 on oversized body", async () => {
    const big = "x".repeat(5 * 1024 * 1024 + 100)
    const res = await apiFetch("/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(big.length),
        "x-hub-signature-256": sign(big),
        "x-github-event": "ping",
        "x-github-delivery": crypto.randomUUID(),
      },
      body: big,
    })
    expect(res.status).toBe(413)
  })

  test("401 on bad signature", async () => {
    const body = JSON.stringify({ zen: "test" })
    const res = await apiFetch("/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=deadbeef",
        "x-github-event": "ping",
        "x-github-delivery": crypto.randomUUID(),
      },
      body,
    })
    expect(res.status).toBe(401)
  })

  test("400 on missing X-GitHub-Delivery", async () => {
    const body = JSON.stringify({ zen: "test", installation: { id: 1 } })
    const res = await apiFetch("/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(body),
        "x-github-event": "ping",
      },
      body,
    })
    expect(res.status).toBe(400)
  })

  test("202 on replay", async () => {
    const body = JSON.stringify({ zen: "ping", installation: { id: 999_888_777 } })
    const deliveryId = crypto.randomUUID()
    const headers = {
      "content-type": "application/json",
      "x-hub-signature-256": sign(body),
      "x-github-event": "ping",
      "x-github-delivery": deliveryId,
    }
    const first = await apiFetch("/api/integrations/github/webhook", { method: "POST", headers, body })
    expect(first.status).toBe(202)
    const second = await apiFetch("/api/integrations/github/webhook", { method: "POST", headers, body })
    expect(second.status).toBe(202)
    const payload = await second.json()
    expect(payload.status).toBe("replay")
  })

  test("202 on unknown installation", async () => {
    const body = JSON.stringify({ zen: "ping", installation: { id: 111_222_333 } })
    const res = await apiFetch("/api/integrations/github/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sign(body),
        "x-github-event": "ping",
        "x-github-delivery": crypto.randomUUID(),
      },
      body,
    })
    expect(res.status).toBe(202)
    expect((await res.json()).status).toBe("unknown-installation")
  })
})
```

> If `apiFetch` / `resetDb` helpers don't exist under `apps/dashboard/tests/api/_helpers.ts`, inspect an existing integration test (`tests/api/github-sync.test.ts`) to copy the bootstrap pattern — typically spins up Nitro via `createFetch()` against the compiled `.output/server`. Reuse whatever that file does.

- [ ] **Step 2: Run tests, verify they pass**

Run: `bun test apps/dashboard/tests/api/webhook-auth.test.ts`
Expected: 5 passing tests.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/tests/api/webhook-auth.test.ts
git commit -m "test(webhook): integration tests for hardened auth stack"
```

---

## Section B — Additive schema (no wiring)

Small, non-disruptive. Adds every new table / column that later phases will consume.

### Task 7: `user_identities` table

**Files:**
- Create: `apps/dashboard/server/db/schema/user-identities.ts`

- [ ] **Step 1: Write the schema**

`apps/dashboard/server/db/schema/user-identities.ts`:

```ts
import { pgTable, uuid, text, timestamp, pgEnum, uniqueIndex } from "drizzle-orm/pg-core"
import { user } from "./auth-schema"

export const identityProviders = pgEnum("identity_provider", ["github"])

export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: identityProviders("provider").notNull(),
    externalId: text("external_id").notNull(),
    externalHandle: text("external_handle").notNull(),
    externalName: text("external_name"),
    externalEmail: text("external_email"),
    externalAvatarUrl: text("external_avatar_url"),
    linkedAt: timestamp("linked_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_identities_provider_external_id_unique").on(table.provider, table.externalId),
    uniqueIndex("user_identities_user_provider_unique").on(table.userId, table.provider),
  ],
)
```

> Confirm the `user` import path. If better-auth generates the table as `users` or the file lives elsewhere, adjust. Open `apps/dashboard/server/db/schema/auth-schema.ts` to check.

- [ ] **Step 2: Generate migration**

Run: `bun run db:gen`
Expected: new migration adding `user_identities` table + the `identity_provider` enum + two unique indexes.

- [ ] **Step 3: Apply**

Run: `bun run db:push`
Expected: clean apply.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/server/db/schema/user-identities.ts \
        apps/dashboard/server/db/migrations/
git commit -m "feat(db): add user_identities table (github provider)"
```

### Task 8: `github_write_locks` table

**Files:**
- Create: `apps/dashboard/server/db/schema/github-write-locks.ts`

- [ ] **Step 1: Write schema**

```ts
import { pgTable, uuid, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core"
import { reports } from "./reports"

export const githubWriteLockKinds = pgEnum("github_write_lock_kind", [
  "labels",
  "assignees",
  "milestone",
  "state",
  "title",
  "comment_upsert",
  "comment_delete",
])

export const githubWriteLocks = pgTable(
  "github_write_locks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    kind: githubWriteLockKinds("kind").notNull(),
    signature: text("signature").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [index("github_write_locks_lookup_idx").on(table.reportId, table.kind, table.expiresAt)],
)
```

- [ ] **Step 2: Generate + push**

Run: `bun run db:gen && bun run db:push`
Expected: clean apply; new table + enum.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/server/db/schema/github-write-locks.ts \
        apps/dashboard/server/db/migrations/
git commit -m "feat(db): add github_write_locks table for loop avoidance"
```

### Task 9: `report_comments` table

**Files:**
- Create: `apps/dashboard/server/db/schema/report-comments.ts`

- [ ] **Step 1: Write schema**

```ts
import { pgTable, uuid, text, timestamp, pgEnum, bigint, index } from "drizzle-orm/pg-core"
import { reports } from "./reports"
import { user } from "./auth-schema"

export const reportCommentSources = pgEnum("report_comment_source", ["dashboard", "github"])

export const reportComments = pgTable(
  "report_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    githubLogin: text("github_login"),
    body: text("body").notNull(),
    githubCommentId: bigint("github_comment_id", { mode: "number" }).unique(),
    source: reportCommentSources("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [index("report_comments_report_created_idx").on(table.reportId, table.createdAt)],
)
```

- [ ] **Step 2: Generate + push**

Run: `bun run db:gen && bun run db:push`

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/server/db/schema/report-comments.ts \
        apps/dashboard/server/db/migrations/
git commit -m "feat(db): add report_comments table (not yet wired)"
```

### Task 10: Extend `reports` + `github_integrations` columns

**Files:**
- Modify: `apps/dashboard/server/db/schema/reports.ts`
- Modify: `apps/dashboard/server/db/schema/github-integrations.ts`

- [ ] **Step 1: Add milestone + sync timestamp columns to `reports`**

In `apps/dashboard/server/db/schema/reports.ts`, inside the `pgTable("reports", { ... })` column block, add after the existing `githubIssueUrl`:

```ts
  milestoneNumber: integer("milestone_number"),
  milestoneTitle: text("milestone_title"),
  githubSyncedAt: timestamp("github_synced_at", { withTimezone: true, mode: "date" }),
  githubCommentsSyncedAt: timestamp("github_comments_synced_at", { withTimezone: true, mode: "date" }),
```

Add `integer` to the imports from `drizzle-orm/pg-core` if not already present.

- [ ] **Step 2: Add toggle + last-synced timestamps to `github_integrations`**

In `apps/dashboard/server/db/schema/github-integrations.ts`, append to the column block:

```ts
  autoCreateOnIntake: boolean("auto_create_on_intake").default(false).notNull(),
  pushOnEdit: boolean("push_on_edit").default(false).notNull(),
  labelsLastSyncedAt: timestamp("labels_last_synced_at", { withTimezone: true, mode: "date" }),
  milestonesLastSyncedAt: timestamp("milestones_last_synced_at", { withTimezone: true, mode: "date" }),
  membersLastSyncedAt: timestamp("members_last_synced_at", { withTimezone: true, mode: "date" }),
```

Add `boolean` to the imports from `drizzle-orm/pg-core` if not already present.

- [ ] **Step 3: Generate migration**

Run: `bun run db:gen`
Expected: migration with `ALTER TABLE reports ADD COLUMN ...` and `ALTER TABLE github_integrations ADD COLUMN ...`. Open the generated file; confirm defaults: `push_on_edit boolean DEFAULT false NOT NULL`, `auto_create_on_intake boolean DEFAULT false NOT NULL`.

- [ ] **Step 4: Apply**

Run: `bun run db:push`

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/db/schema/reports.ts \
        apps/dashboard/server/db/schema/github-integrations.ts \
        apps/dashboard/server/db/migrations/
git commit -m "feat(db): add milestone, sync timestamps, and toggle columns"
```

### Task 11: Extend `report_events.kind` enum

**Files:**
- Modify: `apps/dashboard/server/db/schema/report-events.ts`

- [ ] **Step 1: Add the new kinds**

In `apps/dashboard/server/db/schema/report-events.ts`, locate the `reportEventKinds` pgEnum definition. Extend its string array to include (add to the end, preserve existing order):

```ts
"assignee_added",
"assignee_removed",
"milestone_changed",
"comment_added",
"comment_edited",
"comment_deleted",
"github_labels_updated",
```

- [ ] **Step 2: Generate migration**

Run: `bun run db:gen`
Expected: a migration that runs `ALTER TYPE "public"."report_event_kind" ADD VALUE '...'` for each new enum literal.

- [ ] **Step 3: Apply**

Run: `bun run db:push`
Expected: clean apply. Note: if this fails with a transaction-error, split into a migration file that uses `ALTER TYPE ... ADD VALUE` outside a transaction — drizzle-kit usually handles this correctly but inspect the generated SQL first.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/server/db/schema/report-events.ts \
        apps/dashboard/server/db/migrations/
git commit -m "feat(db): extend report_event_kind enum for assignees/comments/milestone"
```

---

## Section C — User identities + settings UI

Depends on Section B's `user_identities` table.

### Task 12: `identity-oauth-state` signer

**Files:**
- Create: `apps/dashboard/server/lib/identity-oauth-state.ts`
- Create: `apps/dashboard/server/lib/identity-oauth-state.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, test, expect } from "bun:test"
import { signIdentityState, verifyIdentityState } from "./identity-oauth-state"

const SECRET = "test-secret-abcdef"

describe("identity oauth state", () => {
  test("round-trips a userId", () => {
    const state = signIdentityState({ userId: "u-123", secret: SECRET, ttlSeconds: 600 })
    expect(verifyIdentityState({ state, secret: SECRET })).toEqual({ userId: "u-123" })
  })

  test("rejects tampered state", () => {
    const state = signIdentityState({ userId: "u-123", secret: SECRET, ttlSeconds: 600 })
    const bad = state.replace(/.$/, (c) => (c === "a" ? "b" : "a"))
    expect(() => verifyIdentityState({ state: bad, secret: SECRET })).toThrow()
  })

  test("rejects expired state", () => {
    const state = signIdentityState({
      userId: "u-123",
      secret: SECRET,
      ttlSeconds: -1,
    })
    expect(() => verifyIdentityState({ state, secret: SECRET })).toThrow(/expired/i)
  })

  test("rejects state signed with a different secret", () => {
    const state = signIdentityState({ userId: "u-123", secret: SECRET, ttlSeconds: 600 })
    expect(() => verifyIdentityState({ state, secret: "other-secret" })).toThrow()
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `bun test apps/dashboard/server/lib/identity-oauth-state.test.ts`
Expected: 4 failures (module missing).

- [ ] **Step 3: Implement**

```ts
import { createHmac, timingSafeEqual } from "node:crypto"

type SignInput = { userId: string; secret: string; ttlSeconds: number }

export function signIdentityState({ userId, secret, ttlSeconds }: SignInput): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
  const nonce = crypto.randomUUID()
  const payload = `${userId}.${expiresAt}.${nonce}`
  const sig = createHmac("sha256", secret).update(payload).digest("hex")
  return Buffer.from(`${payload}.${sig}`).toString("base64url")
}

export function verifyIdentityState({ state, secret }: { state: string; secret: string }): { userId: string } {
  const decoded = Buffer.from(state, "base64url").toString("utf8")
  const parts = decoded.split(".")
  if (parts.length !== 4) throw new Error("malformed state")
  const [userId, expiresAtStr, nonce, sig] = parts
  const expected = createHmac("sha256", secret).update(`${userId}.${expiresAtStr}.${nonce}`).digest("hex")
  const a = Buffer.from(sig, "hex")
  const b = Buffer.from(expected, "hex")
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("bad signature")
  const expiresAt = Number(expiresAtStr)
  if (!Number.isFinite(expiresAt)) throw new Error("malformed state")
  if (expiresAt < Math.floor(Date.now() / 1000)) throw new Error("state expired")
  return { userId }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `bun test apps/dashboard/server/lib/identity-oauth-state.test.ts`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/lib/identity-oauth-state.ts \
        apps/dashboard/server/lib/identity-oauth-state.test.ts
git commit -m "feat(identities): signed oauth state helper for link flow"
```

### Task 13: `github-identities` resolver + upsert

**Files:**
- Create: `apps/dashboard/server/lib/github-identities.ts`
- Create: `apps/dashboard/server/lib/github-identities.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
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
```

- [ ] **Step 2: Run, verify fail**

Run: `bun test apps/dashboard/server/lib/github-identities.test.ts`
Expected: 5 failures (module missing).

- [ ] **Step 3: Implement**

```ts
import { and, eq } from "drizzle-orm"
import { db } from "../db"
import { userIdentities } from "../db/schema/user-identities"

export type ResolvedIdentity =
  | {
      kind: "dashboard-user"
      userId: string
      githubLogin: string
      avatarUrl: string | null
    }
  | {
      kind: "github-only"
      githubUserId: string
      githubLogin: string
      avatarUrl: string | null
    }

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
  if (row) {
    return {
      kind: "dashboard-user",
      userId: row.userId,
      githubLogin,
      avatarUrl,
    }
  }
  return { kind: "github-only", githubUserId, githubLogin, avatarUrl }
}

export type GithubIdentityFields = {
  externalId: string
  externalHandle: string
  externalAvatarUrl: string | null
  externalName: string | null
  externalEmail: string | null
}

export async function upsertGithubIdentity(userId: string, fields: GithubIdentityFields): Promise<void> {
  const [existing] = await db
    .select()
    .from(userIdentities)
    .where(and(eq(userIdentities.provider, "github"), eq(userIdentities.externalId, fields.externalId)))
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
```

- [ ] **Step 4: Run, verify pass**

Run: `bun test apps/dashboard/server/lib/github-identities.test.ts`
Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/lib/github-identities.ts \
        apps/dashboard/server/lib/github-identities.test.ts
git commit -m "feat(identities): resolver + upsert + unlink helpers"
```

### Task 14: `GET /api/me/identities`

**Files:**
- Create: `apps/dashboard/server/api/me/identities/index.get.ts`

- [ ] **Step 1: Implement**

```ts
import { db } from "~/server/db"
import { userIdentities } from "~/server/db/schema/user-identities"
import { eq } from "drizzle-orm"
import { requireUserSession } from "~/server/lib/auth"

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const rows = await db
    .select({
      provider: userIdentities.provider,
      externalHandle: userIdentities.externalHandle,
      externalAvatarUrl: userIdentities.externalAvatarUrl,
      externalName: userIdentities.externalName,
      linkedAt: userIdentities.linkedAt,
    })
    .from(userIdentities)
    .where(eq(userIdentities.userId, user.id))
  return { items: rows }
})
```

> If `requireUserSession` is imported from a different path in this codebase (check an existing authenticated route under `server/api/me/` or `server/api/projects/`), match that import.

- [ ] **Step 2: Write test**

`apps/dashboard/tests/api/identities.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "bun:test"
import { apiFetch, resetDb, signIn } from "./_helpers"
import { db } from "../../server/db"
import { userIdentities } from "../../server/db/schema/user-identities"

describe("GET /api/me/identities", () => {
  beforeEach(async () => {
    await resetDb()
  })

  test("401 when not signed in", async () => {
    const res = await apiFetch("/api/me/identities")
    expect(res.status).toBe(401)
  })

  test("returns empty list for signed-in user with no identities", async () => {
    const cookie = await signIn("nolinks@example.com")
    const res = await apiFetch("/api/me/identities", { headers: { cookie } })
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })

  test("returns the user's github identity when present", async () => {
    const cookie = await signIn("withlink@example.com")
    const { user } = await (await apiFetch("/api/me", { headers: { cookie } })).json()
    await db.insert(userIdentities).values({
      userId: user.id,
      provider: "github",
      externalId: "ext-1",
      externalHandle: "foo",
      externalAvatarUrl: "https://a.png",
    })
    const res = await apiFetch("/api/me/identities", { headers: { cookie } })
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].externalHandle).toBe("foo")
  })
})
```

- [ ] **Step 3: Run, verify pass**

Run: `bun test apps/dashboard/tests/api/identities.test.ts -t "GET /api/me/identities"`
Expected: 3 passing tests.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/server/api/me/identities/index.get.ts \
        apps/dashboard/tests/api/identities.test.ts
git commit -m "feat(identities): GET /api/me/identities"
```

### Task 15: `POST /api/me/identities/github/start`

**Files:**
- Create: `apps/dashboard/server/api/me/identities/github/start.post.ts`

- [ ] **Step 1: Implement**

```ts
import { requireUserSession } from "~/server/lib/auth"
import { signIdentityState } from "~/server/lib/identity-oauth-state"
import { getGithubAppCredentials } from "~/server/lib/github-app-credentials"

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const creds = await getGithubAppCredentials()
  if (!creds?.clientId) {
    throw createError({ statusCode: 400, statusMessage: "GitHub App is not configured" })
  }

  const runtime = useRuntimeConfig()
  const authSecret = runtime.betterAuthSecret as string
  if (!authSecret) {
    throw createError({ statusCode: 500, statusMessage: "Missing auth secret" })
  }

  const state = signIdentityState({
    userId: user.id,
    secret: authSecret,
    ttlSeconds: 10 * 60,
  })

  const baseUrl = runtime.public.appUrl as string
  const redirectUri = `${baseUrl.replace(/\/$/, "")}/api/me/identities/github/callback`
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize")
  authorizeUrl.searchParams.set("client_id", creds.clientId)
  authorizeUrl.searchParams.set("state", state)
  authorizeUrl.searchParams.set("scope", "read:user")
  authorizeUrl.searchParams.set("redirect_uri", redirectUri)

  return { redirectUrl: authorizeUrl.toString() }
})
```

> If `useRuntimeConfig().public.appUrl` doesn't exist in `nuxt.config.ts`, substitute whatever config key holds the public base URL (often `BETTER_AUTH_URL` env). Verify against an existing route that builds absolute URLs.

- [ ] **Step 2: Add test**

Append to `apps/dashboard/tests/api/identities.test.ts`:

```ts
describe("POST /api/me/identities/github/start", () => {
  test("returns a redirect URL to github.com", async () => {
    const cookie = await signIn("linker@example.com")
    const res = await apiFetch("/api/me/identities/github/start", {
      method: "POST",
      headers: { cookie },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.redirectUrl).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/)
    expect(body.redirectUrl).toContain("scope=read%3Auser")
    expect(body.redirectUrl).toMatch(/state=[^&]+/)
  })

  test("401 when signed out", async () => {
    const res = await apiFetch("/api/me/identities/github/start", { method: "POST" })
    expect(res.status).toBe(401)
  })
})
```

Before this test block runs, the test bootstrap must have seeded a `github_app` row (see `webhook-auth.test.ts`'s `beforeAll`). Add the same seeding to `resetDb` or a `beforeAll` in this file if not already done.

- [ ] **Step 3: Run, verify pass**

Run: `bun test apps/dashboard/tests/api/identities.test.ts -t "POST /api/me/identities/github/start"`
Expected: 2 passing tests.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/server/api/me/identities/github/start.post.ts \
        apps/dashboard/tests/api/identities.test.ts
git commit -m "feat(identities): POST start endpoint generates signed oauth url"
```

### Task 16: `GET /api/me/identities/github/callback`

**Files:**
- Create: `apps/dashboard/server/api/me/identities/github/callback.get.ts`

- [ ] **Step 1: Implement**

```ts
import { requireUserSession } from "~/server/lib/auth"
import { verifyIdentityState } from "~/server/lib/identity-oauth-state"
import { upsertGithubIdentity } from "~/server/lib/github-identities"
import { getGithubAppCredentials } from "~/server/lib/github-app-credentials"

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const query = getQuery(event)
  const code = typeof query.code === "string" ? query.code : null
  const state = typeof query.state === "string" ? query.state : null
  if (!code || !state) {
    throw createError({ statusCode: 400, statusMessage: "Missing code/state" })
  }

  const runtime = useRuntimeConfig()
  const authSecret = runtime.betterAuthSecret as string
  let stateClaim: { userId: string }
  try {
    stateClaim = verifyIdentityState({ state, secret: authSecret })
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid or expired state" })
  }
  if (stateClaim.userId !== user.id) {
    throw createError({ statusCode: 403, statusMessage: "State does not match session" })
  }

  const creds = await getGithubAppCredentials()
  if (!creds?.clientId || !creds.clientSecret) {
    throw createError({ statusCode: 400, statusMessage: "GitHub App is not configured" })
  }

  const tokenRes = await $fetch<{ access_token?: string; error?: string }>(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: {
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code,
      },
    },
  )
  if (!tokenRes.access_token) {
    throw createError({ statusCode: 400, statusMessage: "Failed to exchange code" })
  }

  const ghUser = await $fetch<{
    id: number
    login: string
    name: string | null
    email: string | null
    avatar_url: string | null
  }>("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "Repro-Dashboard",
      authorization: `Bearer ${tokenRes.access_token}`,
    },
  })

  try {
    await upsertGithubIdentity(user.id, {
      externalId: String(ghUser.id),
      externalHandle: ghUser.login,
      externalAvatarUrl: ghUser.avatar_url,
      externalName: ghUser.name,
      externalEmail: ghUser.email,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Link failed"
    return sendRedirect(event, `/settings/identities?error=${encodeURIComponent(message)}`)
  }

  return sendRedirect(event, "/settings/identities?linked=github")
})
```

- [ ] **Step 2: Add a minimal test with a mocked fetch**

The external `https://github.com/login/oauth/access_token` + `https://api.github.com/user` calls are out of test scope. Create a fetch override in test bootstrap or set an environment flag. Preferred: extract the two `$fetch` calls into a small helper that accepts an injected `fetcher` arg, so the test can stub it.

Refactor the handler above: move the two GitHub calls into `apps/dashboard/server/lib/github-oauth-link.ts`:

```ts
export type GithubOauthLinkDeps = {
  clientId: string
  clientSecret: string
  exchangeCode?: (code: string) => Promise<string>
  fetchUser?: (accessToken: string) => Promise<{
    id: number
    login: string
    name: string | null
    email: string | null
    avatar_url: string | null
  }>
}

export async function exchangeGithubCodeDefault(deps: GithubOauthLinkDeps, code: string): Promise<string> {
  const impl = deps.exchangeCode
  if (impl) return impl(code)
  const res = await $fetch<{ access_token?: string }>(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: { client_id: deps.clientId, client_secret: deps.clientSecret, code },
    },
  )
  if (!res.access_token) throw new Error("No access token")
  return res.access_token
}

export async function fetchGithubUserDefault(deps: GithubOauthLinkDeps, token: string) {
  const impl = deps.fetchUser
  if (impl) return impl(token)
  return await $fetch("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "Repro-Dashboard",
      authorization: `Bearer ${token}`,
    },
  })
}

let __testOverride: GithubOauthLinkDeps | null = null
export function __setOauthOverride(deps: GithubOauthLinkDeps | null) {
  __testOverride = deps
}
export function __getOauthOverride() {
  return __testOverride
}
```

Update the callback handler to call `exchangeGithubCodeDefault(__getOauthOverride() ?? { clientId: creds.clientId!, clientSecret: creds.clientSecret! }, code)` and similarly for `fetchGithubUserDefault`.

Then in the test:

```ts
describe("GET /api/me/identities/github/callback", () => {
  test("upserts identity on successful exchange", async () => {
    const cookie = await signIn("cb@example.com")
    const { user: me } = await (await apiFetch("/api/me", { headers: { cookie } })).json()

    const { __setOauthOverride } = await import("../../server/lib/github-oauth-link")
    __setOauthOverride({
      clientId: "x",
      clientSecret: "x",
      exchangeCode: async () => "fake-token",
      fetchUser: async () => ({
        id: 12345,
        login: "octocat",
        name: "The Octo",
        email: "o@x.com",
        avatar_url: "https://avatars/o.png",
      }),
    })

    try {
      const { signIdentityState } = await import("../../server/lib/identity-oauth-state")
      const state = signIdentityState({
        userId: me.id,
        secret: process.env.BETTER_AUTH_SECRET!,
        ttlSeconds: 600,
      })
      const res = await apiFetch(`/api/me/identities/github/callback?code=c&state=${encodeURIComponent(state)}`, {
        headers: { cookie },
        redirect: "manual",
      })
      expect([302, 303]).toContain(res.status)
      expect(res.headers.get("location")).toBe("/settings/identities?linked=github")

      const identities = await (await apiFetch("/api/me/identities", { headers: { cookie } })).json()
      expect(identities.items[0].externalHandle).toBe("octocat")
    } finally {
      __setOauthOverride(null)
    }
  })
})
```

- [ ] **Step 3: Run tests**

Run: `bun test apps/dashboard/tests/api/identities.test.ts -t "callback"`
Expected: 1 passing test.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/server/api/me/identities/github/callback.get.ts \
        apps/dashboard/server/lib/github-oauth-link.ts \
        apps/dashboard/tests/api/identities.test.ts
git commit -m "feat(identities): callback exchanges code and upserts identity"
```

### Task 17: `DELETE /api/me/identities/github`

**Files:**
- Create: `apps/dashboard/server/api/me/identities/github/index.delete.ts`

- [ ] **Step 1: Implement**

```ts
import { requireUserSession } from "~/server/lib/auth"
import { unlinkGithubIdentity } from "~/server/lib/github-identities"

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  await unlinkGithubIdentity(user.id)
  return { ok: true }
})
```

- [ ] **Step 2: Append test**

```ts
describe("DELETE /api/me/identities/github", () => {
  test("removes the link", async () => {
    const cookie = await signIn("unlink@example.com")
    const { user: me } = await (await apiFetch("/api/me", { headers: { cookie } })).json()
    await db.insert(userIdentities).values({
      userId: me.id,
      provider: "github",
      externalId: "ext-rm",
      externalHandle: "rm",
    })
    const res = await apiFetch("/api/me/identities/github", { method: "DELETE", headers: { cookie } })
    expect(res.status).toBe(200)
    const listed = await (await apiFetch("/api/me/identities", { headers: { cookie } })).json()
    expect(listed.items).toEqual([])
  })
})
```

- [ ] **Step 3: Run, verify pass**

Run: `bun test apps/dashboard/tests/api/identities.test.ts -t "DELETE"`

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/server/api/me/identities/github/index.delete.ts \
        apps/dashboard/tests/api/identities.test.ts
git commit -m "feat(identities): DELETE endpoint unlinks the identity"
```

### Task 18: Opportunistic backfill from `account`

**Files:**
- Create: `apps/dashboard/server/db/migrations/<next-number>_backfill_user_identities.sql` (hand-edited — drizzle-kit won't generate DML)

- [ ] **Step 1: Create the migration file**

Look at `apps/dashboard/server/db/migrations/` for the highest-numbered existing migration (e.g. `0012_something.sql`). Create a new file with the next number, named `00NN_backfill_user_identities_from_account.sql`:

```sql
-- Opportunistic backfill: users who signed in with GitHub via better-auth
-- get their user_identities row seeded automatically.

INSERT INTO user_identities
  (user_id, provider, external_id, external_handle, linked_at, last_verified_at)
SELECT
  a.user_id,
  'github'::identity_provider,
  a.account_id,                     -- better-auth stores GitHub user id here as text
  COALESCE(u.name, a.account_id),   -- best-effort handle; refreshed on first real API hit
  NOW(),
  NOW()
FROM account a
JOIN "user" u ON u.id = a.user_id
WHERE a.provider_id = 'github'
ON CONFLICT (provider, external_id) DO NOTHING;
```

> Column names: verify by opening `apps/dashboard/server/db/schema/auth-schema.ts` — better-auth's table name for users may be `user` (singular, quoted). If `account.providerId` is camelCase at the ORM layer but the column is `provider_id` in SQL, the SQL form is what matters here. Adjust the quoted identifier if the user table is `users`.

- [ ] **Step 2: Register the migration**

Drizzle's migration journal (`apps/dashboard/server/db/migrations/meta/_journal.json`) tracks every migration. Run `bun run db:gen` with no schema change so drizzle-kit regenerates the journal and notices the new file. Verify the journal entry appears.

If drizzle-kit doesn't pick up hand-written migrations automatically, append an entry to `_journal.json` manually matching the format of other entries (id, tag, when, breakpoints=true, hash).

- [ ] **Step 3: Apply**

Run: `bun run db:migrate`
Expected: clean apply. Run the SQL again manually to confirm `ON CONFLICT DO NOTHING` — it should succeed with zero rows inserted on the second run.

- [ ] **Step 4: Verify via integration test**

Append to `apps/dashboard/tests/api/identities.test.ts`:

```ts
import { account } from "../../server/db/schema/auth-schema"
// ...
describe("identity backfill", () => {
  test("pre-existing github-account rows get a user_identities row after re-run", async () => {
    const uid = `bf-${crypto.randomUUID()}`
    await db.insert(user).values({
      id: uid,
      email: `${uid}@x.com`,
      name: "BF User",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(account).values({
      id: crypto.randomUUID(),
      userId: uid,
      accountId: "ext-backfill-1",
      providerId: "github",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.execute(/* sql */ `
      INSERT INTO user_identities (user_id, provider, external_id, external_handle, linked_at, last_verified_at)
      SELECT a.user_id, 'github'::identity_provider, a.account_id, COALESCE(u.name, a.account_id), NOW(), NOW()
      FROM account a JOIN "user" u ON u.id = a.user_id
      WHERE a.provider_id = 'github' AND a.user_id = '${uid}'
      ON CONFLICT (provider, external_id) DO NOTHING;
    `)
    const [row] = await db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, uid))
    expect(row.externalId).toBe("ext-backfill-1")
  })
})
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/db/migrations/ \
        apps/dashboard/tests/api/identities.test.ts
git commit -m "feat(identities): backfill user_identities from better-auth account rows"
```

### Task 19: `/settings/identities` Vue page

**Files:**
- Create: `apps/dashboard/app/pages/settings/identities.vue`
- Create: `apps/dashboard/app/components/settings/identity-row.vue`

- [ ] **Step 1: Create the identity row component**

`apps/dashboard/app/components/settings/identity-row.vue`:

```vue
<script setup lang="ts">
type IdentityItem = {
  provider: "github"
  externalHandle: string
  externalAvatarUrl: string | null
  externalName: string | null
  linkedAt: string
}

const props = defineProps<{
  provider: "github"
  label: string
  icon: string
  item: IdentityItem | null
  connecting: boolean
}>()
const emit = defineEmits<{
  connect: []
  disconnect: []
}>()
</script>

<template>
  <div class="flex items-center justify-between border rounded-md px-4 py-3">
    <div class="flex items-center gap-3">
      <UIcon :name="icon" class="size-6" />
      <div>
        <div class="font-medium">{{ label }}</div>
        <div v-if="item" class="text-sm text-muted">
          Connected as <span class="font-mono">@{{ item.externalHandle }}</span>
        </div>
        <div v-else class="text-sm text-muted">Not connected</div>
      </div>
    </div>
    <div>
      <UButton v-if="!item" :loading="connecting" @click="emit('connect')">Connect</UButton>
      <UButton v-else variant="ghost" color="error" @click="emit('disconnect')">Disconnect</UButton>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create the settings page**

`apps/dashboard/app/pages/settings/identities.vue`:

```vue
<script setup lang="ts">
import IdentityRow from "~/components/settings/identity-row.vue"

definePageMeta({ middleware: "auth" })

const { data, refresh } = await useFetch<{ items: Array<{
  provider: "github"
  externalHandle: string
  externalAvatarUrl: string | null
  externalName: string | null
  linkedAt: string
}> }>("/api/me/identities", { default: () => ({ items: [] }) })

const github = computed(() => data.value?.items.find((i) => i.provider === "github") ?? null)

const route = useRoute()
const toast = useToast()

onMounted(() => {
  if (route.query.linked === "github") {
    toast.add({ title: "GitHub account linked", color: "success" })
  }
  if (typeof route.query.error === "string") {
    toast.add({ title: "Link failed", description: route.query.error, color: "error" })
  }
})

const connecting = ref(false)
async function connectGithub() {
  connecting.value = true
  try {
    const res = await $fetch<{ redirectUrl: string }>("/api/me/identities/github/start", { method: "POST" })
    window.location.href = res.redirectUrl
  } catch (e) {
    toast.add({ title: "Could not start link flow", color: "error" })
    connecting.value = false
  }
}

async function disconnectGithub() {
  await $fetch("/api/me/identities/github", { method: "DELETE" })
  await refresh()
  toast.add({ title: "GitHub account disconnected" })
}
</script>

<template>
  <div class="max-w-2xl mx-auto py-8">
    <h1 class="text-2xl font-semibold">Linked accounts</h1>
    <p class="text-muted mt-1">
      Connect your GitHub account so assignments, labels, and comments stay in sync both ways.
    </p>
    <div class="mt-6 space-y-3">
      <IdentityRow
        provider="github"
        label="GitHub"
        icon="i-simple-icons-github"
        :item="github"
        :connecting="connecting"
        @connect="connectGithub"
        @disconnect="disconnectGithub"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 3: Add the page to the settings sidebar (if one exists)**

Search for an existing settings sidebar file (e.g. `app/components/settings/sidebar.vue` or similar). If found, add an entry:

```ts
{ label: "Linked accounts", to: "/settings/identities", icon: "i-lucide-link" }
```

If no sidebar component exists yet, the route is accessible by URL. Don't invent new navigation infrastructure for this phase.

- [ ] **Step 4: Manual smoke test**

Run: `bun run dev:docker && bun run dev`
Open: `http://localhost:3000/settings/identities`
Verify: page renders, "Connect" button visible. Clicking it 302s to `github.com/login/oauth/authorize` (the full round-trip against real GitHub requires a configured App; the test from Task 16 covers the callback with a mocked exchange).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/pages/settings/identities.vue \
        apps/dashboard/app/components/settings/identity-row.vue
git commit -m "feat(identities): /settings/identities page with connect/disconnect"
```

---

## Section D — Assignee split

Largest and highest-risk block. Preserves every existing ticket's assignment.

### Task 20: Drizzle schema — `report_assignees` + remove `assigneeId`

**Files:**
- Create: `apps/dashboard/server/db/schema/report-assignees.ts`
- Modify: `apps/dashboard/server/db/schema/reports.ts`

- [ ] **Step 1: New schema**

`apps/dashboard/server/db/schema/report-assignees.ts`:

```ts
import { pgTable, uuid, text, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { reports } from "./reports"
import { user } from "./auth-schema"

export const reportAssignees = pgTable(
  "report_assignees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    githubLogin: text("github_login"),
    githubUserId: text("github_user_id"),
    githubAvatarUrl: text("github_avatar_url"),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    assignedBy: text("assigned_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    index("report_assignees_report_idx").on(table.reportId),
    index("report_assignees_user_idx").on(table.userId),
    uniqueIndex("report_assignees_report_user_unique")
      .on(table.reportId, table.userId)
      .where(sql`${table.userId} is not null`),
    uniqueIndex("report_assignees_report_github_unique")
      .on(table.reportId, table.githubLogin)
      .where(sql`${table.githubLogin} is not null`),
    check(
      "report_assignees_has_identity",
      sql`${table.userId} is not null or ${table.githubLogin} is not null`,
    ),
  ],
)
```

- [ ] **Step 2: Remove `assigneeId` from reports**

In `apps/dashboard/server/db/schema/reports.ts`, delete the line defining `assigneeId` (including the FK reference to `user`). Also remove the `(projectId, assigneeId)` index from the table-extras array.

- [ ] **Step 3: Generate migration**

Run: `bun run db:gen`
Expected: a migration with `CREATE TABLE "report_assignees"` + `DROP INDEX ...assignee_id_idx` + `ALTER TABLE "reports" DROP COLUMN "assignee_id"`.

- [ ] **Step 4: Insert backfill DML into the generated migration**

Open the generated migration file. After the `CREATE TABLE "report_assignees"` statement but BEFORE the `ALTER TABLE "reports" DROP COLUMN "assignee_id"` statement, insert:

```sql
-- Backfill existing single-assignee rows into report_assignees
INSERT INTO report_assignees (report_id, user_id, assigned_at)
SELECT id, assignee_id, COALESCE(updated_at, created_at)
FROM reports
WHERE assignee_id IS NOT NULL;
```

Save the file. Verify the ordering: CREATE TABLE → BACKFILL INSERT → DROP COLUMN. All three run inside drizzle's default migration transaction.

- [ ] **Step 5: Commit (do not apply yet — Task 21-26 update the code that references assigneeId; apply at Task 27 after the codebase compiles against the new shape)**

```bash
git add apps/dashboard/server/db/schema/report-assignees.ts \
        apps/dashboard/server/db/schema/reports.ts \
        apps/dashboard/server/db/migrations/
git commit -m "feat(db): report_assignees schema + backfill migration (unapplied)"
```

### Task 21: Update shared DTO

**Files:**
- Modify: `packages/shared/src/reports.ts`

- [ ] **Step 1: Change `ReportSummaryDTO`**

Find the `ReportSummaryDTO` Zod schema / type. Replace the single `assignee: ReportAssigneeDTO | null` field with:

```ts
assignees: z.array(ReportAssigneeDTO).default([]),
```

And extend `ReportAssigneeDTO` to allow the GitHub-only shape:

```ts
export const ReportAssigneeDTO = z.object({
  id: z.string().nullable(),          // dashboard user id (null for github-only)
  name: z.string().nullable(),
  email: z.string().nullable(),
  githubLogin: z.string().nullable(),
  githubAvatarUrl: z.string().nullable(),
})
```

- [ ] **Step 2: Change `TriagePatchInput`**

Replace:
```ts
assigneeId: z.string().nullable().optional(),
```
with:
```ts
assigneeIds: z.array(z.string()).optional(),
```

(GitHub-login assignee inputs land in Phase 2 along with push-on-edit. In Phase 0 the surface is dashboard-users only.)

Do the same for `BulkUpdateInput`.

- [ ] **Step 3: Run TypeScript compile**

Run: `bun run --cwd packages/shared build` (or whatever the shared package's build script is — check `packages/shared/package.json`).
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/reports.ts
git commit -m "feat(shared): ReportSummaryDTO.assignees (array); TriagePatchInput.assigneeIds"
```

### Task 22: Update reports list endpoint

**Files:**
- Modify: `apps/dashboard/server/api/projects/[id]/reports/index.get.ts`

- [ ] **Step 1: Read the file; find the assignee join + facet**

Locate every `assigneeId` reference. There will be: (a) a filter `where(eq(reports.assigneeId, ...))`, (b) a `leftJoin` with `user` on `assigneeId`, (c) a facet aggregation, (d) the item DTO mapping.

- [ ] **Step 2: Replace with `report_assignees` join**

Replace the `leftJoin(user, eq(user.id, reports.assigneeId))` with a subquery or separate query that loads all assignees per report. Simplest shape:

```ts
// Near the top of the handler, after the reports query:
const reportIds = items.map((r) => r.id)
const assigneeRows = reportIds.length
  ? await db
      .select({
        reportId: reportAssignees.reportId,
        userId: reportAssignees.userId,
        githubLogin: reportAssignees.githubLogin,
        githubAvatarUrl: reportAssignees.githubAvatarUrl,
        name: user.name,
        email: user.email,
      })
      .from(reportAssignees)
      .leftJoin(user, eq(user.id, reportAssignees.userId))
      .where(inArray(reportAssignees.reportId, reportIds))
  : []

const assigneesByReport = new Map<string, typeof assigneeRows>()
for (const a of assigneeRows) {
  const arr = assigneesByReport.get(a.reportId) ?? []
  arr.push(a)
  assigneesByReport.set(a.reportId, arr)
}
```

Then when building the DTO per report:

```ts
assignees: (assigneesByReport.get(r.id) ?? []).map((a) => ({
  id: a.userId,
  name: a.name,
  email: a.email,
  githubLogin: a.githubLogin,
  githubAvatarUrl: a.githubAvatarUrl,
})),
```

- [ ] **Step 3: Replace the assignee filter**

Previously:
```ts
if (query.assignee) conditions.push(eq(reports.assigneeId, query.assignee))
```

New (supports CSV of user ids, matches if any assignee is in the list):
```ts
if (query.assignee) {
  const ids = query.assignee.split(",").filter(Boolean)
  if (ids.length > 0) {
    conditions.push(
      sql`exists (
        select 1 from ${reportAssignees}
        where ${reportAssignees.reportId} = ${reports.id}
          and ${reportAssignees.userId} = any(${ids})
      )`,
    )
  }
}
```

- [ ] **Step 4: Replace the assignee facet**

The facet today counts reports per `assigneeId`. Update to count distinct reports per `reportAssignees.userId`:

```ts
const assigneeFacetRows = await db
  .select({
    userId: reportAssignees.userId,
    count: sql<number>`count(distinct ${reportAssignees.reportId})`,
  })
  .from(reportAssignees)
  .innerJoin(reports, eq(reports.id, reportAssignees.reportId))
  .where(eq(reports.projectId, projectId))   // reuse the same project-scope filter
  .groupBy(reportAssignees.userId)
```

- [ ] **Step 5: Run tests**

Run: `bun test apps/dashboard/tests/api/inbox.test.ts`
Expected: some failures — tests still seed `assigneeId`. Task 28 rewrites them.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/server/api/projects/[id]/reports/index.get.ts
git commit -m "refactor(reports): list endpoint reads assignees from report_assignees"
```

### Task 23: Update reports detail endpoint

**Files:**
- Modify: `apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.get.ts`

- [ ] **Step 1: Replace single-assignee join**

Remove the `leftJoin(user, eq(user.id, reports.assigneeId))`. After the main report select, load assignees:

```ts
const assignees = await db
  .select({
    userId: reportAssignees.userId,
    githubLogin: reportAssignees.githubLogin,
    githubAvatarUrl: reportAssignees.githubAvatarUrl,
    name: user.name,
    email: user.email,
  })
  .from(reportAssignees)
  .leftJoin(user, eq(user.id, reportAssignees.userId))
  .where(eq(reportAssignees.reportId, report.id))
```

And build the DTO `assignees: assignees.map(...)` mirroring Task 22.

- [ ] **Step 2: Run existing detail tests**

Run: `bun test apps/dashboard/tests/api/inbox.test.ts -t "detail"`
Expected: compile clean; tests may fail (fixed in Task 28).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.get.ts
git commit -m "refactor(reports): detail endpoint reads assignees from report_assignees"
```

### Task 24: Update triage PATCH endpoint

**Files:**
- Modify: `apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts`

- [ ] **Step 1: Read the handler**

Locate: (a) Zod input validation (uses `assigneeId`), (b) the assignee role check (`ensure the proposed assignee is role ≥ manager`), (c) the `db.update(reports).set({ assigneeId })` path, (d) the report-events `assignee_changed` emission.

- [ ] **Step 2: Validate against the new DTO**

Use `TriagePatchInput` from `@reprojs/shared`. Pull `assigneeIds` from the parsed input (array of string | undefined).

- [ ] **Step 3: Role check per-assignee**

```ts
if (input.assigneeIds) {
  if (input.assigneeIds.length > 10) {
    throw createError({ statusCode: 400, statusMessage: "At most 10 assignees" })
  }
  for (const uid of input.assigneeIds) {
    const role = await getProjectRole(db, projectId, uid)
    if (!role || rankProjectRole(role) < rankProjectRole("manager")) {
      throw createError({
        statusCode: 400,
        statusMessage: `User ${uid} is not a manager/developer/owner on this project`,
      })
    }
  }
}
```

Reuse `getProjectRole` / `rankProjectRole` from `server/lib/permissions.ts` (or whatever the existing helper is).

- [ ] **Step 4: Diff current vs. proposed; apply within transaction**

```ts
await db.transaction(async (tx) => {
  if (input.assigneeIds) {
    const current = await tx
      .select({ userId: reportAssignees.userId })
      .from(reportAssignees)
      .where(eq(reportAssignees.reportId, reportId))
    const currentIds = current.map((r) => r.userId).filter((x): x is string => !!x)
    const proposedIds = input.assigneeIds
    const toRemove = currentIds.filter((id) => !proposedIds.includes(id))
    const toAdd = proposedIds.filter((id) => !currentIds.includes(id))

    if (toRemove.length) {
      await tx
        .delete(reportAssignees)
        .where(
          and(
            eq(reportAssignees.reportId, reportId),
            inArray(reportAssignees.userId, toRemove),
          ),
        )
    }
    if (toAdd.length) {
      await tx.insert(reportAssignees).values(
        toAdd.map((uid) => ({
          reportId,
          userId: uid,
          assignedBy: actorUserId,
        })),
      )
    }
    for (const uid of toRemove) {
      await emitReportEvent(tx, {
        reportId,
        actorId: actorUserId,
        kind: "assignee_removed",
        payload: { userId: uid },
      })
    }
    for (const uid of toAdd) {
      await emitReportEvent(tx, {
        reportId,
        actorId: actorUserId,
        kind: "assignee_added",
        payload: { userId: uid },
      })
    }
  }

  // ... existing status / priority / tags handling stays unchanged ...
})
```

Update `emitReportEvent` to support the new kinds (Task 25).

- [ ] **Step 5: Remove any remaining `assigneeId` reference**

Grep the file for `assigneeId` / `assignee_id` — none should remain.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts
git commit -m "refactor(triage): write assignees to report_assignees with diff + events"
```

### Task 25: Update `report-events` writer

**Files:**
- Modify: `apps/dashboard/server/lib/report-events.ts`

- [ ] **Step 1: Extend the `BeforeAfter` type + `kind` union**

Find the `BeforeAfter` type and the switch that produces event payloads. Remove `assigneeId` from `BeforeAfter`. Keep `status`, `priority`, `tags`.

Extend the `emitReportEvent` / equivalent helper to accept new kinds: `"assignee_added"`, `"assignee_removed"`, `"milestone_changed"`, `"comment_added"`, `"comment_edited"`, `"comment_deleted"`, `"github_labels_updated"`. Each takes a minimal `payload` object specific to its kind.

Example:
```ts
export type ReportEventKind =
  | "status_changed"
  | "priority_changed"
  | "tag_added"
  | "tag_removed"
  | "github_unlinked"
  | "assignee_added"
  | "assignee_removed"
  | "milestone_changed"
  | "comment_added"
  | "comment_edited"
  | "comment_deleted"
  | "github_labels_updated"
  | "assignee_changed" // legacy; not emitted by new code
```

Remove any call-site that writes `assignee_changed` from the triage PATCH path (the new diff emits `assignee_added`/`removed` per-delta).

- [ ] **Step 2: Run tests**

Run: `bun test apps/dashboard/tests/lib`
Expected: clean (no tests against report-events shape unless they exist — if so, update them).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/server/lib/report-events.ts
git commit -m "refactor(events): add granular assignee/milestone/comment event kinds"
```

### Task 26: Update bulk-update endpoint

**Files:**
- Modify: `apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts`

- [ ] **Step 1: Update the Zod schema**

Swap `assigneeId` for `assigneeIds` per Task 21. Bulk-update today's UX is "overwrite the single assignee for all selected tickets" — preserve that by treating `assigneeIds` as the new complete set.

- [ ] **Step 2: Reuse the diff-and-apply logic from Task 24**

Extract the assignees diff block from the triage PATCH handler into a helper, or re-implement inline here. Loop over each selected `reportId` inside the same `db.transaction`.

- [ ] **Step 3: Keep the role check**

For each `uid` in `assigneeIds`, run the same role check as Task 24.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts
git commit -m "refactor(bulk-update): write assignees via diff into report_assignees"
```

### Task 27: Apply the assignee-split migration + smoke

**Files:** — migration from Task 20

- [ ] **Step 1: Apply**

Run: `bun run db:migrate`
Expected: migration runs in a transaction. CREATE TABLE, INSERT backfill, DROP COLUMN all succeed. No errors.

- [ ] **Step 2: Smoke query**

From a psql shell or `Bun.sql`:

```sql
SELECT count(*) FROM report_assignees;
-- should equal: SELECT count(*) FROM reports WHERE assignee_id was previously not null.
-- Since the column is gone post-migration, cross-check against git-pre-migration state:
-- in a fresh DB this is zero; in prod/staging it should match the pre-migration NOT NULL assignee count.
```

- [ ] **Step 3: Manual smoke via UI**

Run: `bun run dev`
Open an existing ticket that had an assignee pre-migration. Verify: the triage drawer still shows the assignee (via the Vue updates in Task 30). Change the assignee; verify the change persists.

- [ ] **Step 4: Commit nothing (no code change in this task) — just mark the checkbox done**

### Task 28: Update inbox + manager-role tests

**Files:**
- Modify: `apps/dashboard/tests/api/inbox.test.ts`
- Modify: `apps/dashboard/tests/api/manager-role.test.ts`

- [ ] **Step 1: Replace `assigneeId` seeds with `report_assignees` inserts**

In each test that creates a report with an assignee, replace:
```ts
await db.insert(reports).values({ ..., assigneeId: someUserId })
```
with:
```ts
const [r] = await db.insert(reports).values({ ... }).returning()
await db.insert(reportAssignees).values({ reportId: r.id, userId: someUserId })
```

- [ ] **Step 2: Update assertions on response shape**

`res.body.assignee?.id` → `res.body.assignees[0]?.id`.
`res.body.assignee?.email` → `res.body.assignees[0]?.email`.

- [ ] **Step 3: Update PATCH payloads**

`{ assigneeId: "..." }` → `{ assigneeIds: ["..."] }`.
`{ assigneeId: null }` → `{ assigneeIds: [] }`.

- [ ] **Step 4: Run**

Run: `bun test apps/dashboard/tests/api/inbox.test.ts apps/dashboard/tests/api/manager-role.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/tests/api/inbox.test.ts apps/dashboard/tests/api/manager-role.test.ts
git commit -m "test: rewrite assignee assertions for report_assignees shape"
```

### Task 29: Add multi-assignee coverage test

**Files:**
- Create: `apps/dashboard/tests/api/assignees-multi.test.ts`

- [ ] **Step 1: Write**

```ts
import { describe, test, expect, beforeEach } from "bun:test"
import { apiFetch, resetDb, signIn, seedProjectWithRole } from "./_helpers"
import { db } from "../../server/db"
import { reports } from "../../server/db/schema/reports"
import { reportAssignees } from "../../server/db/schema/report-assignees"
import { eq } from "drizzle-orm"

describe("multi-assignee (phase 0)", () => {
  beforeEach(async () => {
    await resetDb()
  })

  test("PATCH with assigneeIds=[a,b] persists both rows", async () => {
    const ownerCookie = await signIn("owner@x.com")
    const { projectId, memberIdA, memberIdB } = await seedProjectWithRole({
      ownerCookie,
      extras: [
        { email: "a@x.com", role: "developer" },
        { email: "b@x.com", role: "developer" },
      ],
    })
    const [r] = await db
      .insert(reports)
      .values({ projectId, title: "t", description: "d", status: "open", priority: "normal", tags: [] })
      .returning()

    const res = await apiFetch(`/api/projects/${projectId}/reports/${r.id}`, {
      method: "PATCH",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ assigneeIds: [memberIdA, memberIdB] }),
    })
    expect(res.status).toBe(200)

    const rows = await db.select().from(reportAssignees).where(eq(reportAssignees.reportId, r.id))
    expect(rows.map((x) => x.userId).sort()).toEqual([memberIdA, memberIdB].sort())
  })

  test("setting assigneeIds=[] clears all assignees", async () => {
    const ownerCookie = await signIn("owner2@x.com")
    const { projectId, memberIdA } = await seedProjectWithRole({
      ownerCookie,
      extras: [{ email: "a2@x.com", role: "developer" }],
    })
    const [r] = await db
      .insert(reports)
      .values({ projectId, title: "t", description: "d", status: "open", priority: "normal", tags: [] })
      .returning()
    await db.insert(reportAssignees).values({ reportId: r.id, userId: memberIdA })

    await apiFetch(`/api/projects/${projectId}/reports/${r.id}`, {
      method: "PATCH",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ assigneeIds: [] }),
    })

    const rows = await db.select().from(reportAssignees).where(eq(reportAssignees.reportId, r.id))
    expect(rows).toEqual([])
  })

  test("refuses assigning a viewer", async () => {
    const ownerCookie = await signIn("owner3@x.com")
    const { projectId, viewerId } = await seedProjectWithRole({
      ownerCookie,
      extras: [{ email: "v@x.com", role: "viewer", key: "viewerId" }],
    })
    const [r] = await db
      .insert(reports)
      .values({ projectId, title: "t", description: "d", status: "open", priority: "normal", tags: [] })
      .returning()

    const res = await apiFetch(`/api/projects/${projectId}/reports/${r.id}`, {
      method: "PATCH",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ assigneeIds: [viewerId] }),
    })
    expect(res.status).toBe(400)
  })

  test("more than 10 assignees is rejected", async () => {
    const ownerCookie = await signIn("owner4@x.com")
    const { projectId } = await seedProjectWithRole({ ownerCookie, extras: [] })
    const [r] = await db
      .insert(reports)
      .values({ projectId, title: "t", description: "d", status: "open", priority: "normal", tags: [] })
      .returning()
    const res = await apiFetch(`/api/projects/${projectId}/reports/${r.id}`, {
      method: "PATCH",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ assigneeIds: Array.from({ length: 11 }, (_, i) => `u-${i}`) }),
    })
    expect(res.status).toBe(400)
  })
})
```

> `seedProjectWithRole` is a test helper — if it doesn't exist with this signature, extend whichever helper in `_helpers.ts` seeds a project + members. Match that helper's surface; the goal is to create a project with the owner + 2 extra members at known roles.

- [ ] **Step 2: Run**

Run: `bun test apps/dashboard/tests/api/assignees-multi.test.ts`
Expected: 4 passing tests.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/tests/api/assignees-multi.test.ts
git commit -m "test(assignees): multi-assignee persistence, clearing, role guard, cap"
```

### Task 30: Update Vue UI for the new assignee shape

**Files:**
- Modify: `apps/dashboard/app/components/report-drawer/triage-footer.vue`
- Modify: `apps/dashboard/app/components/inbox/facet-sidebar.vue`
- Modify: `apps/dashboard/app/pages/projects/[id]/reports/index.vue`

Phase 0 UX: keep today's single-select feel. Multi-select lands in Phase 1.

- [ ] **Step 1: `triage-footer.vue` — read `assignees[0]`, write `assigneeIds: [id]`**

Find the `assignee` computed (today reads `props.report.assignee?.id`, sets via PATCH `{ assigneeId }`). Rewrite:

```ts
const primaryAssignee = computed({
  get: () => props.report.assignees?.[0]?.id ?? null,
  set: (value: string | null) => {
    emit("patch", { assigneeIds: value ? [value] : [] })
  },
})
```

Update the `USelectMenu` `v-model` binding from `assignee` to `primaryAssignee`. Rendering of the current assignee's avatar/name should read `props.report.assignees?.[0]` — if absent, fall back to "Unassigned".

- [ ] **Step 2: `facet-sidebar.vue` — bind against `assignees` array**

If the facet counts assignees from `items[].assignee.id`, change to iterate `items[].assignees`:

```ts
const countsByAssignee = computed(() => {
  const m = new Map<string | null, number>()
  for (const r of items.value) {
    if (r.assignees.length === 0) {
      m.set(null, (m.get(null) ?? 0) + 1)
      continue
    }
    for (const a of r.assignees) {
      if (a.id) m.set(a.id, (m.get(a.id) ?? 0) + 1)
    }
  }
  return m
})
```

Selected/unselected state for the filter chip stays keyed on user id — no URL shape change.

- [ ] **Step 3: `pages/projects/[id]/reports/index.vue` — render first assignee in the table**

Find the table cell that renders `row.assignee`. Replace with `row.assignees[0]`. Where the bulk-assign dialog calls `/bulk-update` with `{ assigneeId }`, change to `{ assigneeIds: selectedAssignee ? [selectedAssignee] : [] }`. Keep the existing single-select dropdown UI.

- [ ] **Step 4: Manual smoke**

Run: `bun run dev`
Open the inbox. Existing assignee shown on each row. Open a ticket, change assignee via the dropdown, close the drawer, reopen it — assignee persists.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/components/report-drawer/triage-footer.vue \
        apps/dashboard/app/components/inbox/facet-sidebar.vue \
        apps/dashboard/app/pages/projects/[id]/reports/index.vue
git commit -m "refactor(ui): bind assignee UI to assignees[0] (single-select preserved)"
```

---

## Section E — Documentation

### Task 31: Update `docs/self-hosting/integrations.md`

**Files:**
- Modify: `docs/self-hosting/integrations.md`

- [ ] **Step 1: Add the rotation H3**

Under `## GitHub Issues sync`, after the `### Troubleshooting` section (or at the end of the section if troubleshooting is at the end), insert:

```markdown
### Rotating the webhook secret

Rotate the webhook secret from the GitHub App's settings page. After GitHub issues the new secret:

1. **If you set it via env (`GITHUB_APP_WEBHOOK_SECRET`):** update the env var and restart the dashboard. Any webhooks that land during the restart fail signature verification; GitHub retries with exponential backoff — they succeed once the new secret is live. Write-locks' 30s TTL tolerates the gap cleanly.

2. **If you set it via the manifest wizard:** re-run the wizard from **Settings → Integrations → GitHub → Reconfigure**. The new secret is written to the encrypted `github_app` row atomically; no downtime window.

The webhook endpoint requires HTTPS — GitHub will refuse to deliver over plain HTTP. We intentionally do **not** enforce IP allowlisting: self-hosters behind reverse proxies / CDNs routinely see rewritten source IPs, and the enforcement breaks more deployments than it defends.

Defence in depth: every webhook request passes four checks in order — body size cap (5 MB), HMAC-SHA256 signature, `X-GitHub-Delivery` replay dedupe, and installation-id allowlist. Random traffic hitting `/api/integrations/github/webhook` gets 401 at step 2; replays get 202-noop at step 3; stolen-secret attacks against unknown installations get 202-noop at step 4.
```

- [ ] **Step 2: Add the "Reserved toggles" note**

At the end of `## GitHub Issues sync`, add:

```markdown
### Reserved columns (not yet user-visible)

The `github_integrations` table now carries `push_on_edit` and `auto_create_on_intake` boolean columns. These control features that ship in subsequent phases — dashboard changes auto-push to the linked issue, and new reports auto-create a GitHub issue on intake, respectively. Until those phases land, the columns exist but have no UI toggles; defaults are `false` for every project.
```

- [ ] **Step 3: Commit**

```bash
git add docs/self-hosting/integrations.md
git commit -m "docs: webhook rotation + reserved phase-N toggle columns"
```

---

## Final verification

### Task 32: Full test suite + lint

- [ ] **Step 1: Run the full suite**

Run: `bun test`
Expected: all tests pass. If any fail, fix root-cause — do not skip.

- [ ] **Step 2: Lint + format check**

Run: `bun run check`
Expected: clean. If oxlint flags something in a file you touched, fix it. Pre-existing warnings in files you didn't touch can stay.

- [ ] **Step 3: Confirm the migration journal is consistent**

Open `apps/dashboard/server/db/migrations/meta/_journal.json`. The entries should be in order; there should be no gaps or duplicate tags.

- [ ] **Step 4: Summary commit (if anything needs touching up)**

If any small fix-ups were needed during verification, commit them:

```bash
git add -p
git commit -m "chore: fixups from phase-0 verification"
```

Otherwise nothing to commit — end of plan.

---

## Self-review checklist (for the agent executing this plan)

Before marking this plan complete:

- [ ] Every new table from spec §5.1 exists in the DB (user_identities, report_assignees, report_comments, github_write_locks, github_webhook_deliveries).
- [ ] Every new column from spec §5.2 exists (reports.milestone_*, reports.github_synced_at, reports.github_comments_synced_at, github_integrations.auto_create_on_intake / push_on_edit / *_last_synced_at).
- [ ] `reports.assignee_id` is gone; no code references it; pre-migration assignments are preserved in `report_assignees`.
- [ ] `report_events.kind` enum carries the new literals (assignee_added, assignee_removed, milestone_changed, comment_added, comment_edited, comment_deleted, github_labels_updated).
- [ ] `/settings/identities` renders; Connect → GitHub round-trip works against a configured App; Disconnect removes the row.
- [ ] `/api/integrations/github/webhook` refuses oversized bodies (413), bad signatures (401), replays (202-noop), unknown installations (202-noop).
- [ ] Existing tickets: opening an old ticket that had an assignee pre-migration shows the same assignee in the drawer; changing it persists.
- [ ] `bun run check` passes; `bun test` passes.
- [ ] No files left with TODO / TBD / placeholder content from this plan.
