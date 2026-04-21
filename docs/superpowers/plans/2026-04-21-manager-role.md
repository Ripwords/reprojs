# Manager Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a new project-level role `manager` between `viewer` and `developer`. Managers can triage reports end-to-end (status / priority / assignee / tags / bulk-update / GitHub issue linking) but cannot configure integrations, rotate keys, or manage members.

**Architecture:** Extend the existing linear `ROLE_RANK` from 3 positions to 4 (`viewer: 1 < manager: 2 < developer: 3 < owner: 4`). The 4 endpoints that today require `developer` because they handle triage actions move down to `manager`. Everything else stays untouched, including install-admin auto-ownership and all `viewer` / `owner` endpoints.

**Tech Stack:** TypeScript strict, Drizzle ORM (Postgres `text` column with TS-level enum annotation — no SQL migration), Zod, Nuxt 4 server handlers (h3), Vue 3 `<script setup>` + Nuxt UI.

**Spec reference:** `docs/superpowers/specs/2026-04-21-admin-overview-and-manager-role-design.md`

---

## Pre-flight

- [ ] **Confirm a clean working tree.** Run `git status` — should report clean on `main`. If dirty, stash first.
- [ ] **Boot the dev DB.** From repo root: `cd apps/dashboard/docker && docker compose -f docker-compose.dev.yml up -d && cd ../..`. Verify with `docker ps | grep postgres`.
- [ ] **Boot the dev server** (required by the integration tests in Task 5, which hit a live server on :3000): `cd apps/dashboard && bun run dev`. Leave it running in a separate terminal. Hit `http://localhost:3000/` once to confirm it's up.

---

### Task 1: Extend `ProjectRole` enum across shared types and DB schema

**Goal:** Add `"manager"` as a valid value in the three places the role string literal lives. No SQL migration — the Postgres column is `text`; Drizzle's `{ enum: [...] }` is a TypeScript contract only.

**Files:**
- Modify: `packages/shared/src/projects.ts:4`
- Modify: `apps/dashboard/server/db/schema/project-members.ts:11`
- Modify: `apps/dashboard/server/db/schema/project-invitations.ts:12`

- [ ] **Step 1: Update the shared Zod enum.**

Edit `packages/shared/src/projects.ts:4`:

```ts
// Before:
export const ProjectRole = z.enum(["viewer", "developer", "owner"])
// After:
export const ProjectRole = z.enum(["viewer", "manager", "developer", "owner"])
```

Order matters only for documentation — rank order is enforced in `permissions.ts`, not by this enum.

- [ ] **Step 2: Update the `project_members` schema enum annotation.**

Edit `apps/dashboard/server/db/schema/project-members.ts:11`:

```ts
// Before:
role: text("role", { enum: ["owner", "developer", "viewer"] }).notNull(),
// After:
role: text("role", { enum: ["owner", "developer", "manager", "viewer"] }).notNull(),
```

- [ ] **Step 3: Update the `project_invitations` schema enum annotation.**

Edit `apps/dashboard/server/db/schema/project-invitations.ts:12`:

```ts
// Before:
role: text("role", { enum: ["owner", "developer", "viewer"] }).notNull(),
// After:
role: text("role", { enum: ["owner", "developer", "manager", "viewer"] }).notNull(),
```

- [ ] **Step 4: Regenerate the auth schema + run `db:push` to confirm no drift.**

```bash
cd apps/dashboard && bun run db:push
```

Expected: prints "No changes detected" for the `project_members` / `project_invitations` tables (because the column is already `text`). If it tries to generate an ALTER, something's wrong — stop and investigate.

- [ ] **Step 5: Typecheck to confirm no downstream breakage.**

```bash
cd apps/dashboard && bun x nuxt typecheck
```

Expected: PASS. If anything complains about `ProjectRole` being too narrow, the consumer is doing a comparison like `role === "developer"` and assuming a closed set — that's fine; adding a new variant doesn't break exhaustiveness checks unless the consumer uses `never` exhaustion.

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/projects.ts \
        apps/dashboard/server/db/schema/project-members.ts \
        apps/dashboard/server/db/schema/project-invitations.ts
git commit -m "feat(shared): add 'manager' to ProjectRole enum"
```

---

### Task 2: Wire `manager` into the permission rank with TDD

**Goal:** Extend `ROLE_RANK` and `ProjectRoleName` so `compareRole` treats manager as strictly above viewer and strictly below developer. Write the test first.

**Files:**
- Modify: `apps/dashboard/server/lib/permissions.test.ts`
- Modify: `apps/dashboard/server/lib/permissions.ts:8-14`

- [ ] **Step 1: Write the failing test.**

Replace the entire contents of `apps/dashboard/server/lib/permissions.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { compareRole, type ProjectRoleName } from "./permissions"

describe("compareRole", () => {
  const roles: ProjectRoleName[] = ["viewer", "manager", "developer", "owner"]

  test("owner satisfies all minimums", () => {
    for (const min of roles) {
      expect(compareRole("owner", min)).toBe(true)
    }
  })

  test("developer satisfies developer, manager, and viewer, not owner", () => {
    expect(compareRole("developer", "viewer")).toBe(true)
    expect(compareRole("developer", "manager")).toBe(true)
    expect(compareRole("developer", "developer")).toBe(true)
    expect(compareRole("developer", "owner")).toBe(false)
  })

  test("manager satisfies manager and viewer, not developer or owner", () => {
    expect(compareRole("manager", "viewer")).toBe(true)
    expect(compareRole("manager", "manager")).toBe(true)
    expect(compareRole("manager", "developer")).toBe(false)
    expect(compareRole("manager", "owner")).toBe(false)
  })

  test("viewer satisfies only viewer", () => {
    expect(compareRole("viewer", "viewer")).toBe(true)
    expect(compareRole("viewer", "manager")).toBe(false)
    expect(compareRole("viewer", "developer")).toBe(false)
    expect(compareRole("viewer", "owner")).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
cd apps/dashboard && bun test server/lib/permissions.test.ts
```

Expected: FAIL. The test file references `"manager"` as a `ProjectRoleName` which doesn't exist yet, so you'll get a TypeScript compile error or a runtime test failure on the `manager` assertions.

- [ ] **Step 3: Add `manager` to the rank map and type.**

Edit `apps/dashboard/server/lib/permissions.ts:8-14`:

```ts
// Before:
export type ProjectRoleName = "viewer" | "developer" | "owner"

const ROLE_RANK: Record<ProjectRoleName, number> = {
  viewer: 1,
  developer: 2,
  owner: 3,
}

// After:
export type ProjectRoleName = "viewer" | "manager" | "developer" | "owner"

const ROLE_RANK: Record<ProjectRoleName, number> = {
  viewer: 1,
  manager: 2,
  developer: 3,
  owner: 4,
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
cd apps/dashboard && bun test server/lib/permissions.test.ts
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/server/lib/permissions.ts \
        apps/dashboard/server/lib/permissions.test.ts
git commit -m "feat(perms): slot manager between viewer and developer in rank"
```

---

### Task 3: Flip the four triage endpoints from `developer` to `manager`

**Goal:** Move the minimum required role for the four triage endpoints from `"developer"` down to `"manager"`. Also update the stale assignee error message in the two endpoints that guard assignees against being viewers (the `"viewer"` blacklist stays correct — managers are not viewers — but the user-facing error message currently says "developer or owner" which becomes misleading once managers can be assignees).

**Files:**
- Modify: `apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts:15` and assignee-guard error message at line 30
- Modify: `apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts:14` and assignee-guard error message (around line 30)
- Modify: `apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-sync.post.ts:15`
- Modify: `apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-unlink.post.ts:14`

- [ ] **Step 1: Flip `PATCH /reports/:reportId` gate and fix the assignee error message.**

Edit `apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts`:

```ts
// Line 15 — before:
const { session } = await requireProjectRole(event, id, "developer")
// After:
const { session } = await requireProjectRole(event, id, "manager")

// Line 30 — before:
statusMessage: "Assignee must be a developer or owner of this project",
// After:
statusMessage: "Assignee must be a manager, developer, or owner of this project",
```

- [ ] **Step 2: Flip `POST /reports/bulk-update` gate and fix the assignee error message.**

Edit `apps/dashboard/server/api/projects/[id]/reports/bulk-update.post.ts`:

```ts
// Line 14 — before:
const { session } = await requireProjectRole(event, id, "developer")
// After:
const { session } = await requireProjectRole(event, id, "manager")

// In the assignee-guard block (around line 30) — before:
statusMessage: "Assignee must be a developer or owner of this project",
// After:
statusMessage: "Assignee must be a manager, developer, or owner of this project",
```

If the exact string differs, grep for `"Assignee must be"` to locate it; the full message is in `createError({ statusCode: 400, statusMessage: "..." })` within the `body.assigneeId` guard.

- [ ] **Step 3: Flip `POST /reports/:reportId/github-sync` gate.**

Edit `apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-sync.post.ts:15`:

```ts
// Before:
await requireProjectRole(event, projectId, "developer")
// After:
await requireProjectRole(event, projectId, "manager")
```

- [ ] **Step 4: Flip `POST /reports/:reportId/github-unlink` gate.**

Edit `apps/dashboard/server/api/projects/[id]/reports/[reportId]/github-unlink.post.ts:14`:

```ts
// Before:
const { session } = await requireProjectRole(event, projectId, "developer")
// After:
const { session } = await requireProjectRole(event, projectId, "manager")
```

- [ ] **Step 5: Confirm no other triage endpoints were missed.**

```bash
# From repo root
grep -rn 'requireProjectRole(event,.*"developer")' apps/dashboard/server/api/
```

Expected: 2 remaining results — `integrations/github/retry-failed.post.ts` and `integrations/github/repositories.get.ts`. Both are **intentional** — integration-health ops stay at developer (see spec §Decisions). If any other file shows up, stop and reconcile with the spec.

- [ ] **Step 6: Typecheck.**

```bash
cd apps/dashboard && bun x nuxt typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/dashboard/server/api/projects/
git commit -m "feat(api): lower triage-endpoint minimum from developer to manager"
```

---

### Task 4: Add Manager to the project-members UI

**Goal:** Surface Manager in the role selector, pick a badge color distinct from developer's `primary` and viewer's `neutral`, and flip the invite-modal default from `"developer"` to `"manager"` per spec decision Q3.

**Files:**
- Modify: `apps/dashboard/app/pages/projects/[id]/members.vue`

- [ ] **Step 1: Add Manager to `roleOptions`.**

Edit `apps/dashboard/app/pages/projects/[id]/members.vue` around line 37-41:

```ts
// Before:
const roleOptions = [
  { label: "Owner", value: "owner" },
  { label: "Developer", value: "developer" },
  { label: "Viewer", value: "viewer" },
] as const
// After:
const roleOptions = [
  { label: "Owner", value: "owner" },
  { label: "Developer", value: "developer" },
  { label: "Manager", value: "manager" },
  { label: "Viewer", value: "viewer" },
] as const
```

- [ ] **Step 2: Add a color branch for manager in `roleColor`.**

Edit `apps/dashboard/app/pages/projects/[id]/members.vue` around line 166-171:

```ts
// Before:
function roleColor(role: string): "primary" | "neutral" | "warning" | "success" {
  if (role === "owner") return "warning"
  if (role === "developer") return "primary"
  if (role === "viewer") return "neutral"
  return "neutral"
}
// After:
function roleColor(role: string): "primary" | "neutral" | "warning" | "success" | "info" {
  if (role === "owner") return "warning"
  if (role === "developer") return "primary"
  if (role === "manager") return "info"
  if (role === "viewer") return "neutral"
  return "neutral"
}
```

- [ ] **Step 3: Change the invite-modal default role.**

Edit `apps/dashboard/app/pages/projects/[id]/members.vue` around line 45 and its reset site around line 59:

```ts
// Line ~45 — before:
const inviteRole = ref<ProjectRole>("developer")
// After:
const inviteRole = ref<ProjectRole>("manager")

// Line ~59 (the "reset after successful invite" branch) — before:
inviteRole.value = "developer"
// After:
inviteRole.value = "manager"
```

- [ ] **Step 4: Typecheck.**

```bash
cd apps/dashboard && bun x nuxt typecheck
```

Expected: PASS. If `"info"` isn't a valid `UBadge` color in your Nuxt UI version, substitute the closest blue variant (check `node_modules/@nuxt/ui/dist/runtime/types/badge.d.ts` for the union).

- [ ] **Step 5: Manual smoke test.**

- Open `http://localhost:3000/` in a signed-in-as-admin session.
- Click into any project → Members.
- Click "Invite member". The role dropdown should default to **Manager** and show all 4 options (Owner / Developer / Manager / Viewer).
- On an existing member row, the role dropdown should include Manager.
- Badge color for a manager row should be visually distinct from developer (blue vs primary).

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/app/pages/projects/\[id\]/members.vue
git commit -m "feat(ui): surface manager role in members page and invite default"
```

---

### Task 5: Integration tests for manager permission boundary

**Goal:** Prove (against a real Postgres + running dev server) that a manager can mutate a report but is blocked from integration config, member management, and key rotation. These tests replace manual QA and catch regressions if someone later forgets to flip a role back.

**Files:**
- Create: `apps/dashboard/tests/api/manager-role.test.ts`

- [ ] **Step 1: Write the failing test file.**

Create `apps/dashboard/tests/api/manager-role.test.ts`:

```ts
import { setup } from "@nuxt/test-utils/e2e"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import { projectMembers } from "../../server/db/schema"
import type { ProjectDTO } from "@reprojs/shared"
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

setDefaultTimeout(60000)

const PK = "rp_pk_MANAGER0000000000000000"
const ORIGIN = "http://localhost:4000"

async function submitReport(title: string): Promise<string> {
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
          _dwellMs: 2000,
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

/**
 * Seed a member-role user and add them to the given project at the specified
 * role. Returns the user id and their signed-in session cookie.
 */
async function seedMemberAtRole(
  email: string,
  projectId: string,
  role: "viewer" | "manager" | "developer" | "owner",
): Promise<{ userId: string; cookie: string }> {
  const userId = await createUser(email, "member")
  await db.insert(projectMembers).values({ projectId, userId, role })
  const cookie = await signIn(email)
  return { userId, cookie }
}

describe("manager role — allowed actions", () => {
  beforeAll(async () => {
    await truncateReports()
    await truncateDomain()
  })
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("manager can PATCH a report's status, priority, and tags", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await submitReport("to triage")
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(
      `/api/projects/${projectId}/reports/${reportId}`,
      {
        method: "PATCH",
        headers: { cookie },
        body: JSON.stringify({ status: "in_progress", priority: "high" }),
      },
    )
    expect(status).toBe(200)
  })

  test("manager can bulk-update reports", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const r1 = await submitReport("one")
    const r2 = await submitReport("two")
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(`/api/projects/${projectId}/reports/bulk-update`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ reportIds: [r1, r2], status: "closed" }),
    })
    expect(status).toBe(200)
  })

  test("manager can be assigned to a report (assignee guard allows non-viewers)", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await submitReport("assign me")
    const { userId: managerId, cookie } = await seedMemberAtRole(
      "manager@example.com",
      projectId,
      "manager",
    )

    const { status } = await apiFetch(`/api/projects/${projectId}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ assigneeId: managerId }),
    })
    expect(status).toBe(200)
  })
})

describe("manager role — forbidden actions", () => {
  beforeAll(async () => {
    await truncateReports()
    await truncateDomain()
  })
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("manager gets 403 on rotate-key (owner-only)", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(`/api/projects/${projectId}/rotate-key`, {
      method: "POST",
      headers: { cookie },
    })
    expect(status).toBe(403)
  })

  test("manager gets 403 on PATCH github integration (owner-only)", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(`/api/projects/${projectId}/integrations/github`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ repoOwner: "foo", repoName: "bar", defaultLabel: null }),
    })
    expect(status).toBe(403)
  })

  test("manager gets 403 on retry-failed (developer-only integration op)", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(
      `/api/projects/${projectId}/integrations/github/retry-failed`,
      { method: "POST", headers: { cookie } },
    )
    expect(status).toBe(403)
  })

  test("manager gets 403 on adding a member (owner-only)", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    await createUser("other@example.com", "member")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const { cookie } = await seedMemberAtRole("manager@example.com", projectId, "manager")

    const { status } = await apiFetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ email: "other@example.com", role: "viewer" }),
    })
    expect(status).toBe(403)
  })
})

describe("viewer role — regression guard after manager insertion", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("viewer still gets 403 on PATCH report (boundary held)", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: adminId,
    })
    const reportId = await submitReport("untouchable")
    const { cookie } = await seedMemberAtRole("viewer@example.com", projectId, "viewer")

    const { status } = await apiFetch(`/api/projects/${projectId}/reports/${reportId}`, {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ status: "in_progress" }),
    })
    expect(status).toBe(403)
  })
})

// Unused-import appeasement — `eq` is referenced in helpers but not this file
void eq
```

- [ ] **Step 2: Run the test to verify it passes (manager permissions) and catches regressions (viewer still 403).**

Confirm the dev server is running (`curl -s http://localhost:3000/api/auth/get-session` should return JSON, not connection refused).

```bash
cd apps/dashboard && bun test tests/api/manager-role.test.ts
```

Expected: PASS — 8 tests pass (3 allowed, 4 forbidden, 1 regression).

If the `seedMemberAtRole` helper errors because `projectMembers` unique-pk collides with the admin-as-implicit-owner behavior, note that `requireProjectRole` treats install admins as effective owners WITHOUT inserting a row. The admin-created project has no explicit `projectMembers` row for the admin, so inserting one for the manager/viewer user shouldn't collide.

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/tests/api/manager-role.test.ts
git commit -m "test(api): manager role permission boundary coverage"
```

---

### Task 6: Update CLAUDE.md roles description

**Goal:** Keep the project conventions doc in sync so future agents reading CLAUDE.md know the role list without grepping code.

**Files:**
- Modify: `CLAUDE.md` §3.5 (the "Dashboard — Admin / Developer UI" section's Auth bullet)

- [ ] **Step 1: Update the roles line.**

Open `CLAUDE.md` and locate the Auth bullet in §3.5 — it currently reads:

```md
- **Auth**: better-auth with magic-link + GitHub/Google OAuth. Email+password explicitly removed. Roles: `owner`, `admin`, `developer`, `viewer`.
```

Replace with:

```md
- **Auth**: better-auth with magic-link + GitHub/Google OAuth. Email+password explicitly removed. Install roles: `admin`, `member`. Project roles: `owner`, `developer`, `manager`, `viewer` (ranked; see `apps/dashboard/server/lib/permissions.ts`). `manager` is a non-tech triage role — can change status / priority / assignee / tags / bulk-update / link or unlink GitHub issues, but cannot configure integrations, rotate keys, or manage members.
```

- [ ] **Step 2: Commit.**

```bash
git add CLAUDE.md
git commit -m "docs: add manager to CLAUDE.md project-roles list"
```

---

## Self-review

Spec coverage check — every section mapped to a task:

| Spec requirement | Task |
| --- | --- |
| Rank insert at position 2 | Task 2 |
| `ProjectRole` Zod enum gains `"manager"` | Task 1 |
| DB schema enum annotations updated | Task 1 |
| No SQL migration generated | Task 1 step 4 |
| 4 endpoints flip `developer` → `manager` | Task 3 |
| `retry-failed` and `repositories.get` stay at developer | Task 3 step 5 grep check |
| Members UI: Manager option + color + default `manager` | Task 4 |
| Permission rank test coverage | Task 2 |
| API integration tests (allowed + forbidden + viewer regression) | Task 5 |
| CLAUDE.md docs update | Task 6 |

No placeholders. No "TBD". Every code block contains the literal change.

## Rollback

If something goes wrong mid-plan, each task commits atomically — `git reset --hard HEAD~N` rewinds cleanly. No database migration means nothing to revert in Postgres; `ALTER TABLE` was never issued.
