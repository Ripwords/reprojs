# Admin Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new admin-only page at `/admin` that mirrors the per-project overview's visual language (four metric tiles, recent reports, activity feed) but aggregates across every project in the install, plus a per-project breakdown for hotspot scanning.

**Architecture:** One new Nuxt page (`apps/dashboard/app/pages/admin/index.vue`) gated by the existing `admin-only` route middleware. One new server handler (`apps/dashboard/server/api/admin/overview.get.ts`) gated by `requireInstallAdmin(event)`. One new shared DTO (`AdminOverviewDTO`). One new sidebar entry placed at the top of the Admin section. No new DB indexes — the existing `(project_id, created_at DESC)` composite on `report_events` and the per-project index on `reports(project_id)` cover every aggregation.

**Tech Stack:** TypeScript strict, Drizzle ORM (parallel queries via `Promise.all`; Postgres `FILTER` + `count()` aggregates), Nuxt 4 server handlers (h3), Vue 3 `<script setup>` + Nuxt UI, Tailwind v4.

**Spec reference:** `docs/superpowers/specs/2026-04-21-admin-overview-and-manager-role-design.md`

**Dependency:** None. This plan is independent of the manager-role plan — neither plan blocks the other — but lands second by spec decision (§Rollout) so the admin surface is most useful once manager members exist.

---

## Pre-flight

- [ ] **Confirm a clean working tree.** Run `git status` — should report clean.
- [ ] **Boot the dev DB.** From repo root: `cd apps/dashboard/docker && docker compose -f docker-compose.dev.yml up -d && cd ../..`.
- [ ] **Boot the dev server** in a separate terminal (required by Task 3 and Task 5 integration tests): `cd apps/dashboard && bun run dev`. Confirm with `curl -s http://localhost:3000/api/auth/get-session`.

---

### Task 1: Define `AdminOverviewDTO` in `@reprojs/shared`

**Goal:** Land the DTO before any producer or consumer depends on it, so both sides can import from a single source of truth.

**Files:**
- Create: `packages/shared/src/admin.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create the DTO module.**

Create `packages/shared/src/admin.ts`:

```ts
import { z } from "zod"
import { ReportEventKind, ReportPriority, ReportStatus } from "./reports"

// Minimal per-row shape for /admin's recent-reports list. Purpose-built
// (NOT an extension of ReportSummaryDTO) because the admin row only
// renders title + priority + project + timestamp — there's no need to
// ship context/pageUrl/tags/assignee for a 10-row glance list.
export const AdminRecentReportDTO = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  projectName: z.string(),
  title: z.string(),
  status: ReportStatus,
  priority: ReportPriority,
  receivedAt: z.string(),
})
export type AdminRecentReportDTO = z.infer<typeof AdminRecentReportDTO>

// Mirrors ProjectOverviewDTO.recentEvents but carries project context per row.
// Kind enum matches the per-project overview exactly.
export const AdminRecentEventDTO = z.object({
  id: z.uuid(),
  reportId: z.uuid(),
  reportTitle: z.string(),
  projectId: z.uuid(),
  projectName: z.string(),
  kind: ReportEventKind,
  payload: z.record(z.string(), z.unknown()),
  actor: z
    .object({
      id: z.string(),
      email: z.email(),
      name: z.string().nullable(),
    })
    .nullable(),
  createdAt: z.string(),
})
export type AdminRecentEventDTO = z.infer<typeof AdminRecentEventDTO>

export const AdminProjectBreakdownDTO = z.object({
  id: z.uuid(),
  name: z.string(),
  openCount: z.number().int(),
  newLast7Count: z.number().int(),
  totalCount: z.number().int(),
})
export type AdminProjectBreakdownDTO = z.infer<typeof AdminProjectBreakdownDTO>

export const AdminOverviewDTO = z.object({
  counts: z.object({
    total: z.number().int(),
    byStatus: z.record(ReportStatus, z.number().int()),
    byPriority: z.record(ReportPriority, z.number().int()),
    last7Days: z.number().int(),
  }),
  projects: z.object({
    total: z.number().int(),
    withGithub: z.number().int(),
  }),
  recentReports: z.array(AdminRecentReportDTO),
  recentEvents: z.array(AdminRecentEventDTO),
  perProject: z.array(AdminProjectBreakdownDTO),
})
export type AdminOverviewDTO = z.infer<typeof AdminOverviewDTO>
```

- [ ] **Step 2: Re-export from the shared package entry.**

Edit `packages/shared/src/index.ts` — append:

```ts
export * from "./admin"
```

The full file should now read:

```ts
export * from "./projects"
export * from "./project-invitations"
export * from "./users"
export * from "./settings"
export * from "./reports"
export * from "./github"
export * from "./admin"
```

- [ ] **Step 3: Typecheck the shared package.**

```bash
cd packages/shared && bun x tsc --noEmit
```

Expected: PASS. If `ReportSummaryDTO` isn't exported from `./reports`, check `packages/shared/src/reports.ts:184` — it should already be exported.

- [ ] **Step 4: Commit.**

```bash
git add packages/shared/src/admin.ts packages/shared/src/index.ts
git commit -m "feat(shared): add AdminOverviewDTO for admin overview dashboard"
```

---

### Task 2: Write the failing test for `GET /api/admin/overview`

**Goal:** Define the contract the endpoint must satisfy before writing it. Test happy path, 403 for non-admin, and aggregation correctness across multiple projects.

**Files:**
- Create: `apps/dashboard/tests/api/admin-overview.test.ts`

- [ ] **Step 1: Write the test file.**

Create `apps/dashboard/tests/api/admin-overview.test.ts`:

```ts
import { setup } from "@nuxt/test-utils/e2e"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { eq } from "drizzle-orm"
import type { AdminOverviewDTO } from "@reprojs/shared"
import { db } from "../../server/db"
import { githubIntegrations, projectMembers, reports } from "../../server/db/schema"
import {
  apiFetch,
  createUser,
  makePngBlob,
  seedProject,
  signIn,
  truncateDomain,
  truncateGithub,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(60000)

async function submitReport(publicKey: string, title: string, origin: string): Promise<string> {
  const fd = new FormData()
  fd.set(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey: publicKey,
          title,
          description: "d",
          context: {
            pageUrl: `${origin}/p`,
            userAgent: "UA",
            viewport: { w: 1000, h: 800 },
            timestamp: new Date().toISOString(),
            reporter: { email: "u@example.com" },
          },
          _dwellMs: 2000,
        }),
      ],
      { type: "application/json" },
    ),
  )
  fd.set("screenshot", makePngBlob(), "s.png")
  const res = await fetch("http://localhost:3000/api/intake/reports", {
    method: "POST",
    headers: { Origin: origin },
    body: fd,
  })
  if (res.status !== 201) throw new Error(`intake failed: ${res.status}`)
  return ((await res.json()) as { id: string }).id
}

describe("GET /api/admin/overview", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateGithub()
    await truncateDomain()
  })

  test("non-admin gets 403 even if they own projects", async () => {
    const memberId = await createUser("member@example.com", "member")
    const projectId = await seedProject({
      name: "Mine",
      publicKey: "rp_pk_OWNER000000000000000000",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: memberId,
    })
    await db.insert(projectMembers).values({ projectId, userId: memberId, role: "owner" })
    const cookie = await signIn("member@example.com")

    const { status } = await apiFetch("/api/admin/overview", { headers: { cookie } })
    expect(status).toBe(403)
  })

  test("admin gets aggregated counts across all projects", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const pA = await seedProject({
      name: "Alpha",
      publicKey: "rp_pk_ALPHA000000000000000000",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: adminId,
    })
    const pB = await seedProject({
      name: "Bravo",
      publicKey: "rp_pk_BRAVO000000000000000000",
      allowedOrigins: ["http://localhost:4001"],
      createdBy: adminId,
    })
    // Seed 2 reports in Alpha, 1 in Bravo — all default to status=open.
    await submitReport("rp_pk_ALPHA000000000000000000", "a1", "http://localhost:4000")
    await submitReport("rp_pk_ALPHA000000000000000000", "a2", "http://localhost:4000")
    await submitReport("rp_pk_BRAVO000000000000000000", "b1", "http://localhost:4001")

    // Attach a connected github integration to Alpha only.
    await db.insert(githubIntegrations).values({
      projectId: pA,
      installationId: 1,
      repoOwner: "acme",
      repoName: "alpha",
      status: "connected",
    })

    const cookie = await signIn("admin@example.com")
    const { status, body } = await apiFetch<AdminOverviewDTO>("/api/admin/overview", {
      headers: { cookie },
    })
    expect(status).toBe(200)
    expect(body.counts.total).toBe(3)
    expect(body.counts.byStatus.open).toBe(3)
    expect(body.counts.last7Days).toBe(3)
    expect(body.projects.total).toBe(2)
    expect(body.projects.withGithub).toBe(1)

    // recentReports: newest-first across projects
    expect(body.recentReports.length).toBe(3)
    expect(body.recentReports[0]?.title).toBe("b1")
    expect(body.recentReports[0]?.projectId).toBe(pB)
    expect(body.recentReports[0]?.projectName).toBe("Bravo")

    // perProject: sorted by openCount desc, then name asc. Alpha has 2 open, Bravo 1.
    expect(body.perProject.map((p) => p.name)).toEqual(["Alpha", "Bravo"])
    expect(body.perProject[0]).toMatchObject({
      id: pA,
      name: "Alpha",
      openCount: 2,
      totalCount: 2,
    })
    expect(body.perProject[1]).toMatchObject({
      id: pB,
      name: "Bravo",
      openCount: 1,
      totalCount: 1,
    })
  })

  test("admin gets empty shape on empty install", async () => {
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    const { status, body } = await apiFetch<AdminOverviewDTO>("/api/admin/overview", {
      headers: { cookie },
    })
    expect(status).toBe(200)
    expect(body.counts.total).toBe(0)
    expect(body.counts.last7Days).toBe(0)
    expect(body.projects.total).toBe(0)
    expect(body.projects.withGithub).toBe(0)
    expect(body.recentReports).toEqual([])
    expect(body.recentEvents).toEqual([])
    expect(body.perProject).toEqual([])
  })

  test("recentReports caps at 10", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const p = await seedProject({
      name: "Big",
      publicKey: "rp_pk_BIGGGG000000000000000000",
      allowedOrigins: ["http://localhost:4000"],
      createdBy: adminId,
    })
    for (let i = 0; i < 12; i++) {
      await submitReport("rp_pk_BIGGGG000000000000000000", `r${i}`, "http://localhost:4000")
    }
    void p // used implicitly via submitReport
    const cookie = await signIn("admin@example.com")
    const { body } = await apiFetch<AdminOverviewDTO>("/api/admin/overview", {
      headers: { cookie },
    })
    expect(body.recentReports.length).toBe(10)
    expect(body.counts.total).toBe(12)
  })

  // Appease unused-import linter without removing the helper for future tests.
  void eq
  void reports
})
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
cd apps/dashboard && bun test tests/api/admin-overview.test.ts
```

Expected: FAIL with 404 status codes (the route doesn't exist yet). All four tests should fail at the `expect(status).toBe(200)` or `toBe(403)` assertions.

- [ ] **Step 3: Commit the failing test.**

```bash
git add apps/dashboard/tests/api/admin-overview.test.ts
git commit -m "test(api): failing tests for GET /api/admin/overview"
```

---

### Task 3: Implement `GET /api/admin/overview`

**Goal:** Stand up the endpoint so the Task-2 tests pass.

**Files:**
- Create: `apps/dashboard/server/api/admin/overview.get.ts`

- [ ] **Step 1: Create the endpoint.**

Create `apps/dashboard/server/api/admin/overview.get.ts`:

```ts
// apps/dashboard/server/api/admin/overview.get.ts
import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm"
import { defineEventHandler } from "h3"
import type { AdminOverviewDTO } from "@reprojs/shared"
import { db } from "../../db"
import {
  githubIntegrations,
  projects,
  reportEvents,
  reports,
  user,
} from "../../db/schema"
import { requireInstallAdmin } from "../../lib/permissions"

const DAY_MS = 86_400_000
const VOLUME_DAYS = 7

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export default defineEventHandler(async (event): Promise<AdminOverviewDTO> => {
  await requireInstallAdmin(event)

  const now = new Date()
  const today = startOfUtcDay(now)
  const sevenDaysAgo = new Date(today.getTime() - (VOLUME_DAYS - 1) * DAY_MS)

  const [
    totalRows,
    statusCounts,
    priorityCounts,
    last7Rows,
    projectsTotalRows,
    projectsWithGithubRows,
    recentReportRows,
    recentEventRows,
    perProjectRows,
  ] = await Promise.all([
    // 1. Total reports across install (ignoring deleted projects).
    db
      .select({ total: count() })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(isNull(projects.deletedAt)),

    // 2. Status breakdown.
    db
      .select({ key: reports.status, c: count() })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(isNull(projects.deletedAt))
      .groupBy(reports.status),

    // 3. Priority breakdown.
    db
      .select({ key: reports.priority, c: count() })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(isNull(projects.deletedAt))
      .groupBy(reports.priority),

    // 4. New in the last 7 days.
    db
      .select({ last7: count() })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(and(isNull(projects.deletedAt), gte(reports.createdAt, sevenDaysAgo))),

    // 5. Projects count (non-deleted).
    db.select({ total: count() }).from(projects).where(isNull(projects.deletedAt)),

    // 6. Projects with a connected GitHub integration.
    db
      .select({ withGithub: count() })
      .from(githubIntegrations)
      .innerJoin(projects, eq(projects.id, githubIntegrations.projectId))
      .where(and(isNull(projects.deletedAt), eq(githubIntegrations.status, "connected"))),

    // 7. 10 most recent reports, newest first, with project name. Purpose-
    //    built narrow projection for AdminRecentReportDTO (not the full
    //    ReportSummaryDTO — the admin row only renders title + priority +
    //    project + timestamp).
    db
      .select({
        id: reports.id,
        projectId: reports.projectId,
        projectName: projects.name,
        title: reports.title,
        status: reports.status,
        priority: reports.priority,
        receivedAt: reports.createdAt,
      })
      .from(reports)
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .where(isNull(projects.deletedAt))
      .orderBy(desc(reports.createdAt))
      .limit(10),

    // 8. 10 most recent events across all projects. Uses the composite
    //    (project_id, created_at DESC) index on report_events.
    db
      .select({
        id: reportEvents.id,
        reportId: reportEvents.reportId,
        reportTitle: reports.title,
        projectId: reports.projectId,
        projectName: projects.name,
        kind: reportEvents.kind,
        payload: reportEvents.payload,
        actorId: reportEvents.actorId,
        actorEmail: user.email,
        actorName: user.name,
        createdAt: reportEvents.createdAt,
      })
      .from(reportEvents)
      .innerJoin(reports, eq(reports.id, reportEvents.reportId))
      .innerJoin(projects, eq(projects.id, reports.projectId))
      .leftJoin(user, eq(user.id, reportEvents.actorId))
      .where(isNull(projects.deletedAt))
      .orderBy(desc(reportEvents.createdAt))
      .limit(10),

    // 9. Per-project breakdown — one row per project with open / new7d / total
    //    counts. LEFT JOIN ensures projects with zero reports still appear.
    db
      .select({
        id: projects.id,
        name: projects.name,
        totalCount: sql<number>`coalesce(count(${reports.id}), 0)::int`,
        openCount: sql<number>`coalesce(sum(case when ${reports.status} = 'open' then 1 else 0 end), 0)::int`,
        newLast7Count: sql<number>`coalesce(sum(case when ${reports.createdAt} >= ${sevenDaysAgo} then 1 else 0 end), 0)::int`,
      })
      .from(projects)
      .leftJoin(reports, eq(reports.projectId, projects.id))
      .where(isNull(projects.deletedAt))
      .groupBy(projects.id, projects.name)
      .orderBy(
        sql`coalesce(sum(case when ${reports.status} = 'open' then 1 else 0 end), 0) desc`,
        projects.name,
      ),
  ])

  const total = totalRows[0]?.total ?? 0
  const last7 = last7Rows[0]?.last7 ?? 0
  const projectsTotal = projectsTotalRows[0]?.total ?? 0
  const projectsWithGithub = projectsWithGithubRows[0]?.withGithub ?? 0

  const byStatus = { open: 0, in_progress: 0, resolved: 0, closed: 0 } as Record<string, number>
  for (const r of statusCounts) byStatus[r.key] = r.c

  const byPriority = { urgent: 0, high: 0, normal: 0, low: 0 } as Record<string, number>
  for (const r of priorityCounts) byPriority[r.key] = r.c

  return {
    counts: {
      total,
      byStatus: byStatus as AdminOverviewDTO["counts"]["byStatus"],
      byPriority: byPriority as AdminOverviewDTO["counts"]["byPriority"],
      last7Days: last7,
    },
    projects: {
      total: projectsTotal,
      withGithub: projectsWithGithub,
    },
    recentReports: recentReportRows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      title: r.title,
      status: r.status as AdminOverviewDTO["recentReports"][number]["status"],
      priority: r.priority as AdminOverviewDTO["recentReports"][number]["priority"],
      receivedAt: r.receivedAt.toISOString(),
    })),
    recentEvents: recentEventRows.map((e) => ({
      id: e.id,
      reportId: e.reportId,
      reportTitle: e.reportTitle,
      projectId: e.projectId,
      projectName: e.projectName,
      kind: e.kind as AdminOverviewDTO["recentEvents"][number]["kind"],
      payload: e.payload as Record<string, unknown>,
      actor: e.actorId
        ? { id: e.actorId, email: e.actorEmail ?? "", name: e.actorName ?? null }
        : null,
      createdAt: e.createdAt.toISOString(),
    })),
    perProject: perProjectRows.map((r) => ({
      id: r.id,
      name: r.name,
      openCount: r.openCount,
      newLast7Count: r.newLast7Count,
      totalCount: r.totalCount,
    })),
  }
})
```

- [ ] **Step 2: Run the test file — all tests should pass.**

```bash
cd apps/dashboard && bun test tests/api/admin-overview.test.ts
```

Expected: PASS — 4 tests pass.

- [ ] **Step 3: Typecheck.**

```bash
cd apps/dashboard && bun x nuxt typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/server/api/admin/overview.get.ts
git commit -m "feat(api): GET /api/admin/overview aggregates across all projects"
```

---

### Task 4: Build the `/admin` page

**Goal:** Render the four tiles + recent reports + activity + per-project breakdown using the same visual language as `apps/dashboard/app/pages/projects/[id]/index.vue`. Re-use `relativeTime` / `priorityColor` helpers.

**Files:**
- Create: `apps/dashboard/app/pages/admin/index.vue`

- [ ] **Step 1: Create the page.**

Create `apps/dashboard/app/pages/admin/index.vue`:

```vue
<script setup lang="ts">
import type { AdminOverviewDTO } from "@reprojs/shared"
import AppEmptyState from "~/components/common/app-empty-state.vue"
import { priorityColor, relativeTime } from "~/composables/use-report-format"

definePageMeta({ middleware: "admin-only" })
useHead({ title: "Admin overview" })

const { data: overview } = await useApi<AdminOverviewDTO>("/api/admin/overview")

const metrics = computed(() => {
  const o = overview.value
  if (!o) return null
  return {
    open: o.counts.byStatus.open ?? 0,
    newThisWeek: o.counts.last7Days,
    total: o.counts.total,
    projects: o.projects.total,
    projectsWithGithub: o.projects.withGithub,
  }
})

const recentReports = computed(() => overview.value?.recentReports ?? [])
const recentActivity = computed(() => overview.value?.recentEvents ?? [])
const perProject = computed(() => overview.value?.perProject ?? [])
const projectCount = computed(() => overview.value?.projects.total ?? 0)

const EVENT_LABEL: Record<string, string> = {
  status_changed: "changed status",
  priority_changed: "changed priority",
  assignee_changed: "reassigned",
  tag_added: "added a tag",
  tag_removed: "removed a tag",
  github_unlinked: "unlinked GitHub issue",
}

function describeEvent(e: AdminOverviewDTO["recentEvents"][number]): string {
  const label = EVENT_LABEL[e.kind] ?? e.kind
  return `${label} on "${e.reportTitle}" in ${e.projectName}`
}
</script>

<template>
  <div class="space-y-8">
    <!-- Page header -->
    <header class="flex items-end justify-between gap-4">
      <div>
        <div class="text-xs font-medium uppercase tracking-[0.18em] text-muted">Admin</div>
        <h1 class="mt-1 text-3xl font-semibold text-default tracking-tight">Overview</h1>
        <p class="mt-1.5 text-sm text-muted">
          Snapshot of incoming reports, health, and recent team activity across all projects.
        </p>
      </div>
      <UButton
        to="/"
        label="View all projects"
        trailing-icon="i-heroicons-arrow-right"
        color="primary"
        size="md"
      />
    </header>

    <!-- Metric tiles -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="relative overflow-hidden rounded-xl border border-default bg-default p-5">
        <div
          class="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15"
        >
          <UIcon name="i-heroicons-inbox" class="size-4" />
        </div>
        <div class="mt-4 text-xs font-medium uppercase tracking-wider text-muted">Open reports</div>
        <div class="mt-1 text-3xl font-semibold text-default tracking-tight tabular-nums">
          {{ metrics?.open ?? 0 }}
        </div>
      </div>

      <div class="relative overflow-hidden rounded-xl border border-default bg-default p-5">
        <div class="flex items-center justify-center size-8 rounded-lg bg-muted text-muted">
          <UIcon name="i-heroicons-sparkles" class="size-4" />
        </div>
        <div class="mt-4 text-xs font-medium uppercase tracking-wider text-muted">
          New · last 7 days
        </div>
        <div class="mt-1 text-3xl font-semibold text-default tracking-tight tabular-nums">
          {{ metrics?.newThisWeek ?? 0 }}
        </div>
      </div>

      <div class="relative overflow-hidden rounded-xl border border-default bg-default p-5">
        <div class="flex items-center justify-center size-8 rounded-lg bg-muted text-muted">
          <UIcon name="i-heroicons-chart-bar" class="size-4" />
        </div>
        <div class="mt-4 text-xs font-medium uppercase tracking-wider text-muted">
          Total reports
        </div>
        <div class="mt-1 text-3xl font-semibold text-default tracking-tight tabular-nums">
          {{ metrics?.total ?? 0 }}
        </div>
      </div>

      <NuxtLink
        to="/"
        class="group relative overflow-hidden rounded-xl border border-default bg-default p-5 transition hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.14)]"
      >
        <div class="flex items-center justify-between">
          <div
            class="flex items-center justify-center size-8 rounded-lg bg-muted text-muted"
          >
            <UIcon name="i-heroicons-squares-2x2" class="size-4" />
          </div>
          <UIcon
            name="i-heroicons-arrow-up-right"
            class="size-3.5 text-muted opacity-0 group-hover:opacity-100 transition"
          />
        </div>
        <div class="mt-4 text-xs font-medium uppercase tracking-wider text-muted">Projects</div>
        <div class="mt-1 text-3xl font-semibold text-default tracking-tight tabular-nums">
          {{ metrics?.projects ?? 0 }}
        </div>
        <div class="mt-1 text-xs text-muted">
          {{ metrics?.projectsWithGithub ?? 0 }} connected to GitHub
        </div>
      </NuxtLink>
    </div>

    <!-- Two-column: recent reports + activity -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="rounded-xl border border-default bg-default">
        <div class="flex items-center justify-between px-5 py-4 border-b border-default">
          <h2 class="text-sm font-semibold text-default tracking-tight">Recent reports</h2>
        </div>
        <div
          v-if="!recentReports || recentReports.length === 0"
          class="text-sm text-muted py-10 text-center"
        >
          No reports yet.
        </div>
        <ul v-else class="divide-y divide-default">
          <li v-for="r in recentReports" :key="r.id">
            <NuxtLink
              :to="`/projects/${r.projectId}/reports/${r.id}`"
              class="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-elevated/50"
            >
              <span
                class="shrink-0 text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-elevated text-muted"
              >
                {{ r.projectName }}
              </span>
              <UBadge
                :label="r.priority"
                :color="priorityColor(r.priority)"
                variant="soft"
                size="sm"
                class="capitalize shrink-0"
              />
              <span class="flex-1 min-w-0 truncate text-default">{{ r.title }}</span>
              <span class="text-xs text-muted whitespace-nowrap tabular-nums">
                {{ relativeTime(r.receivedAt) }}
              </span>
            </NuxtLink>
          </li>
        </ul>
      </div>

      <div class="rounded-xl border border-default bg-default">
        <div class="px-5 py-4 border-b border-default">
          <h2 class="text-sm font-semibold text-default tracking-tight">Activity</h2>
        </div>
        <div
          v-if="!recentActivity || recentActivity.length === 0"
          class="text-sm text-muted py-10 text-center"
        >
          No activity yet.
        </div>
        <ul v-else class="px-5 py-4 space-y-3.5">
          <li v-for="e in recentActivity" :key="e.id" class="flex items-start gap-3 text-sm">
            <span
              class="shrink-0 mt-1.5 inline-block size-1.5 rounded-full bg-primary/60"
              aria-hidden="true"
            />
            <div class="flex-1 min-w-0">
              <span class="text-default font-medium">
                {{ e.actor?.name ?? e.actor?.email ?? "System" }}
              </span>
              <span class="text-muted"> {{ describeEvent(e) }}</span>
              <div class="mt-0.5 text-xs text-muted tabular-nums">
                {{ relativeTime(e.createdAt) }}
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Per-project breakdown -->
    <div v-if="perProject.length > 0" class="rounded-xl border border-default bg-default">
      <div class="px-5 py-4 border-b border-default">
        <h2 class="text-sm font-semibold text-default tracking-tight">Projects</h2>
      </div>
      <ul class="divide-y divide-default">
        <li v-for="p in perProject" :key="p.id">
          <NuxtLink
            :to="`/projects/${p.id}`"
            class="flex items-center gap-4 px-5 py-3 text-sm transition-colors hover:bg-elevated/50"
          >
            <span class="flex-1 min-w-0 truncate font-medium text-default">{{ p.name }}</span>
            <span class="text-xs text-muted tabular-nums shrink-0">
              <span class="font-semibold text-default">{{ p.openCount }}</span> open
            </span>
            <span class="text-xs text-muted tabular-nums shrink-0">
              {{ p.newLast7Count }} new · 7d
            </span>
            <span class="text-xs text-muted tabular-nums shrink-0">
              {{ p.totalCount }} total
            </span>
            <UIcon
              name="i-heroicons-chevron-right"
              class="size-4 text-muted shrink-0"
            />
          </NuxtLink>
        </li>
      </ul>
    </div>

    <!-- Empty state when the install has no projects at all -->
    <AppEmptyState
      v-if="projectCount === 0"
      variant="gradient"
      icon="i-heroicons-squares-plus"
      title="Create your first project"
      description="Once you spin up a project, it'll appear here with open-report counts and recent activity."
      action-label="New project"
      action-to="/"
    />
  </div>
</template>
```

- [ ] **Step 2: Typecheck.**

```bash
cd apps/dashboard && bun x nuxt typecheck
```

Expected: PASS. If `priorityColor` / `relativeTime` aren't exported from `~/composables/use-report-format`, check the per-project page at `apps/dashboard/app/pages/projects/[id]/index.vue:4` — the import path is authoritative.

- [ ] **Step 3: Manual smoke test.**

With the dev server running and signed in as an admin user:

- Navigate to `http://localhost:3000/admin`. Expected: page renders with 4 tiles (all 0 if no reports) + two empty "No reports yet / No activity yet" cards + empty-state CTA if there are no projects.
- Seed a project + a few reports via the normal flow. Refresh `/admin`. Tiles should reflect the counts; recent reports should show the project-name chip before each title.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/app/pages/admin/index.vue
git commit -m "feat(ui): /admin overview page with tiles, activity, per-project list"
```

---

### Task 5: Add the sidebar entry

**Goal:** Surface `/admin` as the first item in the admin section of the sidebar so it's the natural landing page for admins.

**Files:**
- Modify: `apps/dashboard/app/components/shell/app-sidebar.vue:115-123`

- [ ] **Step 1: Prepend the Overview item to `adminItems`.**

Edit `apps/dashboard/app/components/shell/app-sidebar.vue:115-123`:

```ts
// Before:
const adminItems = computed<NavItem[]>(() => {
  if (!isAdmin.value) return []
  return [
    { label: "Users", icon: "i-heroicons-users", to: "/settings/users" },
    { label: "Access", icon: "i-heroicons-shield-check", to: "/settings/access" },
    { label: "Install", icon: "i-heroicons-code-bracket", to: "/settings/install" },
    { label: "GitHub", icon: "i-mdi-github", to: "/settings/github" },
  ]
})

// After:
const adminItems = computed<NavItem[]>(() => {
  if (!isAdmin.value) return []
  return [
    { label: "Overview", icon: "i-heroicons-home", to: "/admin", exact: true },
    { label: "Users", icon: "i-heroicons-users", to: "/settings/users" },
    { label: "Access", icon: "i-heroicons-shield-check", to: "/settings/access" },
    { label: "Install", icon: "i-heroicons-code-bracket", to: "/settings/install" },
    { label: "GitHub", icon: "i-mdi-github", to: "/settings/github" },
  ]
})
```

The `exact: true` matches how the per-project "Overview" item is handled — without it, the naive prefix match would keep Overview marked active even on `/admin/anything-in-the-future`.

- [ ] **Step 2: Manual smoke test — admin.**

Hard-refresh the dashboard while signed in as an admin. The sidebar's Admin section should now show **Overview → Users → Access → Install → GitHub** in that order, with Overview linking to `/admin`.

- [ ] **Step 3: Manual smoke test — non-admin.**

Sign out and sign in as a regular member. The Admin section should not render at all (this is existing behavior guarded by `if (!isAdmin.value) return []`). Navigating directly to `/admin` should bounce to `/` via the `admin-only` middleware.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/app/components/shell/app-sidebar.vue
git commit -m "feat(ui): add Overview to admin sidebar section"
```

---

## Self-review

Spec coverage check — every section mapped to a task:

| Spec requirement | Task |
| --- | --- |
| `AdminOverviewDTO` in shared | Task 1 |
| `requireInstallAdmin` gate on new endpoint | Task 3 |
| `admin-only` middleware on new page | Task 4 |
| 4 metric tiles (Open / New7d / Total / Projects) | Task 4 |
| Projects tile shows "X connected to GitHub" | Task 4 |
| Recent reports 10 across all projects with project chip | Task 4 |
| Activity feed 10 events with project name in sentence | Task 4 |
| Per-project breakdown sorted by openCount desc | Task 3 query + Task 4 render |
| Empty state when zero projects | Task 4 |
| Sidebar entry under Admin section | Task 5 |
| API test 403 for non-admin | Task 2 |
| API test aggregation correctness | Task 2 |
| API test empty install | Task 2 |
| API test recentReports cap at 10 | Task 2 |
| No new DB indexes | verified by Task 3's query structure (all covered by existing indexes) |

No placeholders. No "TBD". Every code block contains the literal change.

## Rollback

Each task commits atomically. `git reset --hard HEAD~N` rewinds cleanly. No database schema change → nothing to revert in Postgres.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-admin-overview.md`.
