# Admin overview + manager role design

Status: draft — pending user review
Date: 2026-04-21
Owner: JJ

## Problem

Two related gaps in the admin workflow:

1. **No install-wide view.** An install admin who manages several projects
   has no landing page that shows health across all of them. The only
   cross-project surface today is `/` (a flat grid of project cards with
   a name and the admin's effective role — no counts, no activity, no
   hotspot signal). To answer "where should I look first?" the admin has
   to click into each project's overview individually.

2. **No role for non-technical triagers.** The `developer` role bundles two
   distinct responsibilities: handling reports (change status/priority,
   assign, link to GitHub) and operating the integration (retry failed
   syncs, pick repositories during setup). Teams with a dedicated QA /
   support person who should triage reports but shouldn't touch
   integration plumbing have to either over-grant `developer` or
   under-grant `viewer`. The missing middle role forces either
   over-privilege or under-privilege.

Both live in the same PR sequence because they share the admin mental
model — an admin uses the new dashboard; managers are the role an admin
typically invites for non-tech triage.

## Goals

- Install admins get a dashboard at `/admin` that mirrors the per-project
  overview's visual language (4 tiles + recent reports + activity) but
  aggregates across every project, and adds a per-project breakdown so
  admins can spot which project is on fire.
- A new `manager` project role exists between `viewer` and `developer`.
  Managers can triage reports end-to-end (including cross-posting to
  GitHub) but cannot configure integrations, rotate keys, or manage
  members.
- The `admin-only` middleware already used by `/settings/users` gates the
  new page; no new auth primitive is introduced.
- No change to the install-level role model (`admin` / `member`).
- No Postgres schema migration — `project_members.role` is a `text`
  column with a Drizzle-level enum annotation, so extending the enum is
  a TypeScript change.

## Non-goals

- No global inbox page. Tiles that would conceptually link to "all open
  reports" link to `/` for now.
- No per-project drill-down filtering, sorting beyond the default
  (open-count desc), or time-range picker on `/admin`. The 7-day window
  is hardcoded to match per-project overview.
- No capability-bit permission model. The rank stays linear
  (`viewer < manager < developer < owner`).
- No auto-migration of existing `developer` members to `manager`.
  Role downgrades are manual via the members page.
- No change to install-admin auto-ownership behavior in
  `requireProjectRole` — install admins keep getting effective `owner`
  on every project.

## Decisions

- **(Q1) Rank model:** Linear insert at position 2.
  `viewer(1) < manager(2) < developer(3) < owner(4)`.
  Alternative was capability bits per role; rejected because it forces
  every existing `requireProjectRole(event, id, "developer")` call to be
  rewritten to an explicit capability name with no functional gain for
  one new role.
- **(Q2) Permission boundary:** manager gets every per-report triage
  action including GitHub issue cross-posting. developer additionally
  retains integration-health operations. Full table in §Architecture.
- **(Q3) Default invite role:** switches from `developer` to `manager` on
  the project-members page's invite modal. Rationale: the user framed
  manager as the common case for new non-tech invitees; making it the
  default avoids a footgun where owners accidentally invite a QA hire
  as a developer. Explicit selectors still let them pick `developer` or
  any other role. (Reversible — one-line change if this turns out to be
  wrong.)
- **(Q4) Admin overview navigation:** new top-level route `/admin` with a
  sidebar entry visible only to install admins. Non-admins see the
  sidebar exactly as today. `/` continues to be the projects grid for
  everyone.
- **(Q5) 4th tile on `/admin`:** "Projects" count with a "X connected to
  GitHub" subtitle, linking to `/`. Replaces the per-project
  "GitHub Sync" tile with a metric that makes sense aggregated.
- **(Q6) Recent reports / activity on `/admin`:** 10 most recent across
  all projects, each row labeled with the project name (small chip for
  reports, inline in the sentence for events). Without the label the
  rows are ambiguous when two projects have similar-sounding reports.
- **(Q7) Per-project breakdown section:** added below the activity row.
  This is the piece that makes the global view actionable beyond summed
  counts — a scannable list of every project with open / new7d / total
  counts and a chevron linking to the project overview. Sorted by
  openCount desc.
- **(Q8) Combined spec, split plans:** both features live in this single
  design doc but ship as two atomic implementation plans so each lands
  as its own PR.

## Architecture

### Manager role — permission boundary

| Endpoint | Before | After |
| --- | --- | --- |
| `PATCH /api/projects/:id/reports/:reportId` (status / priority / assignee / tags) | developer | **manager** |
| `POST /api/projects/:id/reports/bulk-update` | developer | **manager** |
| `POST /api/projects/:id/reports/:reportId/github-sync` (push report as GH issue) | developer | **manager** |
| `POST /api/projects/:id/reports/:reportId/github-unlink` | developer | **manager** |
| `POST /api/projects/:id/integrations/github/retry-failed` | developer | developer (unchanged — integration ops) |
| `GET /api/projects/:id/integrations/github/repositories` (pick repo during setup) | developer | developer (unchanged — setup-adjacent) |
| All `viewer` endpoints | viewer | unchanged |
| All `owner` endpoints (members, invitations, rotate-key, delete, integration config / disconnect, project rename) | owner | unchanged |

Net effect: a manager can triage a report from arrival to closure
including cross-posting to GitHub. A developer additionally can retry
queued syncs and browse the repo list during setup. An owner retains
everything config-related.

### Manager role — files touched

- `packages/shared/src/projects.ts` —
  `ProjectRole = z.enum(["viewer", "manager", "developer", "owner"])`.
- `apps/dashboard/server/db/schema/project-members.ts` — enum tuple
  gains `"manager"`. No SQL migration (column is `text`; new values
  require no Postgres-level change).
- `apps/dashboard/server/db/schema/project-invitations.ts` — same
  enum tuple update.
- `apps/dashboard/server/lib/permissions.ts` —
  ```ts
  export type ProjectRoleName = "viewer" | "manager" | "developer" | "owner"
  const ROLE_RANK: Record<ProjectRoleName, number> = {
    viewer: 1,
    manager: 2,
    developer: 3,
    owner: 4,
  }
  ```
- Four endpoint files flip their minimum from `"developer"` →
  `"manager"` (see table above).
- `apps/dashboard/app/pages/projects/[id]/members.vue`:
  - `roleOptions` gains `{ label: "Manager", value: "manager" }`.
  - `roleColor("manager") → "info"` (blue — distinct from
    developer's primary and viewer's neutral).
  - `inviteRole` ref default flips from `"developer"` → `"manager"`
    (Q3 above).
- `CLAUDE.md` §3.5 roles list updated to
  `owner / admin / developer / manager / viewer` for the project
  roles and a one-line description of what manager can do.

### Admin overview — route + page

New page `apps/dashboard/app/pages/admin/index.vue` with
`definePageMeta({ middleware: "admin-only" })`.

Layout (top to bottom):

1. **Header:** "Admin" eyebrow, page title, "Snapshot of incoming
   reports, health, and recent team activity across all projects."
   subtitle, "View all projects" button → `/`.
2. **Four tiles** — same visual treatment (size-8 icon chip + eyebrow
   label + big tabular-nums number) as
   `apps/dashboard/app/pages/projects/[id]/index.vue`:
   - Open reports (sum across projects)
   - New · last 7 days (sum)
   - Total reports (sum)
   - Projects (count); subtitle "N connected to GitHub"; links to `/`
3. **Two-column block:**
   - Left: Recent reports — 10 most recent across all projects. Each
     row is `<project chip> <priority badge> <title> <relative time>`.
   - Right: Activity — 10 most recent events across all projects. Each
     row's sentence is `{actor} {verb} on "{reportTitle}" in
     {projectName}`.
4. **Per-project breakdown** (new section, does not exist on
   per-project overview): compact card/list with one row per project
   showing `{name} · open {n} · new7d {n} · total {n} · →`. Rows link
   to `/projects/:id`. Sorted by openCount desc, then name asc.
5. **Empty state:** when project count is 0, reuse
   `AppEmptyState` with "Create your first project" matching what `/`
   already does.

### Admin overview — API

Single endpoint `GET /api/admin/overview`, gated by
`requireInstallAdmin(event)`.

Response shape (declared as `AdminOverviewDTO` in
`packages/shared/src/admin.ts`):

```ts
export interface AdminOverviewDTO {
  counts: {
    total: number
    byStatus: Record<"open" | "in_progress" | "resolved" | "closed", number>
    byPriority: Record<"urgent" | "high" | "normal" | "low", number>
    last7Days: number
  }
  projects: {
    total: number
    withGithub: number // projects with a connected github_integrations row
  }
  recentReports: Array<ReportSummaryDTO & {
    projectId: string
    projectName: string
  }> // 10 most recent across all projects
  recentEvents: Array<{
    id: string
    reportId: string
    reportTitle: string
    projectId: string
    projectName: string
    kind: ProjectOverviewDTO["recentEvents"][number]["kind"]
    payload: Record<string, unknown>
    actor: { id: string, email: string, name: string | null } | null
    createdAt: string
  }> // 10 most recent across all projects
  perProject: Array<{
    id: string
    name: string
    openCount: number
    newLast7Count: number
    totalCount: number
  }>
}
```

Implemented as ~6 parallel Drizzle queries in
`apps/dashboard/server/api/admin/overview.get.ts`:

1. Status breakdown: `SELECT status, count() FROM reports GROUP BY status`.
2. Priority breakdown: `GROUP BY priority`.
3. Total + last-7-days: two `count()` queries (or one with a filtered
   aggregate).
4. Recent reports: `reports innerJoin projects ORDER BY received_at DESC
   LIMIT 10`, projecting project name.
5. Recent events: `reportEvents innerJoin reports innerJoin projects
   leftJoin user ORDER BY report_events.created_at DESC LIMIT 10` (uses
   the existing `(project_id, created_at DESC)` index on
   `report_events`).
6. Per-project breakdown + `projects.withGithub`:
   `SELECT projects.id, projects.name, count(reports) ... LEFT JOIN
   github_integrations` with grouping. Two queries is acceptable if one
   grouped query becomes unwieldy.

No new indexes. The existing composite index on
`report_events(project_id, created_at DESC)` and the per-project index
on `reports(project_id)` cover the aggregations.

### Admin overview — sidebar integration

Add one item to the admin-only section of the sidebar composable (exact
file identified in the implementation plan):

```
Admin
  ├─ Overview        /admin        (new, admin-only)
  ├─ Users           /settings/users
  ├─ Access          /settings/access
  └─ GitHub install  /settings/github
```

Placement under an "Admin" heading groups all install-level surfaces
and makes the overview the natural entry point. Exact component changes
deferred to the plan.

## Testing

### Manager role

- `apps/dashboard/server/lib/permissions.test.ts` — extend the existing
  rank test to cover manager's position (`viewer < manager <
  developer < owner`; `compareRole("manager", "developer") === false`;
  `compareRole("developer", "manager") === true`).
- New integration tests (hitting a real Postgres via the existing test
  harness):
  - A `manager` can `PATCH` a report and mutate status/priority/tags.
  - A `manager` can call `github-sync` / `github-unlink`.
  - A `manager` gets 403 on `rotate-key`, `members` mutation, GitHub
    integration config PATCH, and `retry-failed`.
  - A `viewer` remains blocked from all the above (regression guard).
- `apps/dashboard/app/pages/projects/[id]/members.vue` — the invite
  role selector renders Manager; chosen role round-trips through the
  API.

### Admin overview

- `apps/dashboard/server/api/admin/overview.get.ts`:
  - Returns 403 for a non-admin session (even if they're project
    owners of several projects).
  - Returns 200 for an install admin.
  - Counts sum correctly across multiple projects seeded in the test DB.
  - Recent reports / events include project name and are ordered by
    `receivedAt` / `createdAt` desc.
  - `perProject` is sorted by `openCount` desc with name asc tiebreak.
  - Empty-install case: `projects.total === 0`, all arrays empty, no
    500s.
- Snapshot test for the Vue page is not required; component behavior is
  thin and the API contract carries the semantic risk.

## Rollout

Two atomic implementation plans shipped in order:

1. **Plan A — manager role.** Shared enum → DB schema annotations →
   permissions rank → four endpoint gate flips → UI selector + default
   change → tests → CLAUDE.md doc. Self-contained, ~10 files, no
   dependency on admin overview.

2. **Plan B — admin overview.** New shared DTO → new API endpoint →
   new Vue page → sidebar entry → tests. Depends on nothing from Plan A
   but lands second because the admin surface is most useful once
   manager members exist in the install.

No feature flag. Both are additive: manager introduces a new role
that nobody has until an owner assigns it; the admin dashboard
introduces a new URL that nobody reaches without the new sidebar
entry, which is admin-gated.

## Open questions

None. All §Decisions are user-confirmed.
