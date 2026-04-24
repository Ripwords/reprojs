# Deeper GitHub Integration — Phase 2 (Push-on-Edit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Turn one-way live pickers (Phase 1) into bidirectional live sync. Every dashboard PATCH that changes a synced field on a GitHub-linked ticket auto-pushes the change to the issue; every inbound GitHub webhook (assignees, milestones, title, labels, state) writes back to the dashboard. Write-locks prevent echo loops.

**Architecture:** Three concerns: (1) extend the `github-reconcile` module to diff and push title, assignees (add/remove), milestone in addition to today's label + state sync; (2) record short-lived write-lock signatures before each outbound call so webhooks recognise their own echoes; (3) expand the webhook handler with new event branches that check write-locks before writing to Postgres. A per-project `push_on_edit` toggle (already in the schema from Phase 0) gates the automatic enqueue.

**Tech Stack:** Nuxt 4, Nitro, Octokit, Drizzle ORM, `bun:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-24-deeper-github-integration-design.md` §8 (push-on-edit + loop avoidance) + §5 (write-locks table).

**Scope kept OUT of Phase 2** (Phase 3+):
- Comments sync (covered in Phase 3)
- Auto-create on intake (Phase 4)
- Title/body round-trip (explicitly out of scope per design — title pushes one-way only; body stays as auto-generated diagnostic block)

**Phase 0 + 1 dependencies:** assumes `report_assignees`, `github_write_locks`, `github_integrations.push_on_edit`, `report_events` enum extensions, and live pickers are all in place.

---

## File structure

### New files
- `apps/dashboard/server/lib/github-write-locks.ts` — insert/match/expire the signature-based markers.
- `apps/dashboard/server/lib/github-write-locks.test.ts` — unit tests.
- `apps/dashboard/server/lib/github-diff.ts` — pure functions that compute signatures and diffs for labels/assignees/milestone/state/title.
- `apps/dashboard/server/lib/github-diff.test.ts`
- `apps/dashboard/tests/api/github-push-on-edit.test.ts` — end-to-end tests covering PATCH → enqueue → reconcile → write-lock → webhook echo skipped.
- `apps/dashboard/tests/api/github-webhook-expanded.test.ts` — inbound event handling tests for each new event.

### Modified files
- `packages/integrations/github/src/issue-writes.ts` — **new file** with `updateIssueTitle`, `updateIssueMilestone`, `addAssignees`, `removeAssignees`, `updateIssueState`; existing `client.ts` re-exports.
- `packages/integrations/github/src/issue-writes.test.ts` — unit tests (fake Octokit).
- `apps/dashboard/server/lib/github-reconcile.ts` — extend reconciler: pull issue, compute full diff, execute in order with write-lock recording.
- `apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts` — enqueue sync job when `push_on_edit=true` and the ticket is linked AND a synced field changed.
- `apps/dashboard/server/api/integrations/github/webhook.post.ts` — new branches: `issues.assigned`, `issues.unassigned`, `issues.milestoned`, `issues.demilestoned`, `issues.edited` (title only), and label/state write-lock checks on the existing `labeled`/`unlabeled`/`closed`/`reopened` branches.
- `apps/dashboard/server/db/schema/github-integrations.ts` — flip `pushOnEdit` default to `true` **in the schema** (affects only newly-inserted rows via application-level default); keep the DB column's DDL default at `false` to preserve Phase 0's migration-time rule for pre-existing rows.
- `apps/dashboard/server/api/projects/[id]/integrations/github/install-callback.get.ts` (or wherever new integration rows are inserted) — explicit `pushOnEdit: true` on insert.
- `apps/dashboard/app/components/integrations/github/github-panel.vue` — add a USwitch for `pushOnEdit`.
- `packages/shared/src/github.ts` — extend `GithubConfigDTO` with `pushOnEdit: boolean`; `UpdateGithubConfigInput` accepts `pushOnEdit`.

---

## Section A — Adapter writes

### Task 1: Octokit write wrappers

**Files:** create `packages/integrations/github/src/issue-writes.ts` + `.test.ts`; append re-exports to `client.ts`.

- [ ] **Step 1: Write tests** (`issue-writes.test.ts`):

```ts
import { describe, test, expect, mock } from "bun:test"
import {
  updateIssueTitle,
  updateIssueMilestone,
  addAssignees,
  removeAssignees,
  updateIssueState,
} from "./issue-writes"

function fakeOctokit() {
  const calls: Array<{ method: string; args: unknown }> = []
  return {
    calls,
    rest: {
      issues: {
        update: mock(async (args: unknown) => {
          calls.push({ method: "update", args })
          return { data: {} }
        }),
        addAssignees: mock(async (args: unknown) => {
          calls.push({ method: "addAssignees", args })
          return { data: {} }
        }),
        removeAssignees: mock(async (args: unknown) => {
          calls.push({ method: "removeAssignees", args })
          return { data: {} }
        }),
      },
    },
  } as never
}

describe("updateIssueTitle", () => {
  test("calls issues.update with title", async () => {
    const c = fakeOctokit()
    await updateIssueTitle(c, "o", "r", 7, "new title")
    expect((c as unknown as { calls: Array<{ method: string; args: Record<string, unknown> }> }).calls[0])
      .toEqual({ method: "update", args: { owner: "o", repo: "r", issue_number: 7, title: "new title" } })
  })
})

describe("updateIssueMilestone", () => {
  test("sends number", async () => {
    const c = fakeOctokit()
    await updateIssueMilestone(c, "o", "r", 7, 3)
    expect((c as unknown as { calls: Array<{ args: Record<string, unknown> }> }).calls[0].args)
      .toMatchObject({ owner: "o", repo: "r", issue_number: 7, milestone: 3 })
  })

  test("sends null to clear", async () => {
    const c = fakeOctokit()
    await updateIssueMilestone(c, "o", "r", 7, null)
    expect((c as unknown as { calls: Array<{ args: Record<string, unknown> }> }).calls[0].args)
      .toMatchObject({ milestone: null })
  })
})

describe("addAssignees", () => {
  test("calls addAssignees with logins", async () => {
    const c = fakeOctokit()
    await addAssignees(c, "o", "r", 7, ["a", "b"])
    expect((c as unknown as { calls: Array<{ method: string; args: Record<string, unknown> }> }).calls[0])
      .toEqual({ method: "addAssignees", args: { owner: "o", repo: "r", issue_number: 7, assignees: ["a", "b"] } })
  })

  test("no-op on empty array", async () => {
    const c = fakeOctokit()
    await addAssignees(c, "o", "r", 7, [])
    expect((c as unknown as { calls: unknown[] }).calls).toEqual([])
  })
})

describe("removeAssignees", () => {
  test("calls removeAssignees with logins", async () => {
    const c = fakeOctokit()
    await removeAssignees(c, "o", "r", 7, ["a"])
    expect((c as unknown as { calls: Array<{ method: string }> }).calls[0].method).toBe("removeAssignees")
  })

  test("no-op on empty array", async () => {
    const c = fakeOctokit()
    await removeAssignees(c, "o", "r", 7, [])
    expect((c as unknown as { calls: unknown[] }).calls).toEqual([])
  })
})

describe("updateIssueState", () => {
  test("closed with state_reason", async () => {
    const c = fakeOctokit()
    await updateIssueState(c, "o", "r", 7, { state: "closed", stateReason: "completed" })
    expect((c as unknown as { calls: Array<{ args: Record<string, unknown> }> }).calls[0].args)
      .toMatchObject({ state: "closed", state_reason: "completed" })
  })

  test("reopen passes reopened state_reason", async () => {
    const c = fakeOctokit()
    await updateIssueState(c, "o", "r", 7, { state: "open", stateReason: "reopened" })
    expect((c as unknown as { calls: Array<{ args: Record<string, unknown> }> }).calls[0].args)
      .toMatchObject({ state: "open", state_reason: "reopened" })
  })
})
```

- [ ] **Step 2: Implement** (`issue-writes.ts`):

```ts
import type { Octokit } from "@octokit/rest"

export async function updateIssueTitle(
  client: Octokit, owner: string, repo: string, issueNumber: number, title: string,
): Promise<void> {
  await client.rest.issues.update({ owner, repo, issue_number: issueNumber, title })
}

export async function updateIssueMilestone(
  client: Octokit, owner: string, repo: string, issueNumber: number, milestoneNumber: number | null,
): Promise<void> {
  await client.rest.issues.update({
    owner, repo, issue_number: issueNumber, milestone: milestoneNumber,
  })
}

export async function addAssignees(
  client: Octokit, owner: string, repo: string, issueNumber: number, logins: string[],
): Promise<void> {
  if (logins.length === 0) return
  await client.rest.issues.addAssignees({
    owner, repo, issue_number: issueNumber, assignees: logins,
  })
}

export async function removeAssignees(
  client: Octokit, owner: string, repo: string, issueNumber: number, logins: string[],
): Promise<void> {
  if (logins.length === 0) return
  await client.rest.issues.removeAssignees({
    owner, repo, issue_number: issueNumber, assignees: logins,
  })
}

export type IssueStateUpdate =
  | { state: "open"; stateReason: "reopened" | null }
  | { state: "closed"; stateReason: "completed" | "not_planned" }

export async function updateIssueState(
  client: Octokit, owner: string, repo: string, issueNumber: number, update: IssueStateUpdate,
): Promise<void> {
  await client.rest.issues.update({
    owner, repo, issue_number: issueNumber,
    state: update.state,
    state_reason: update.stateReason ?? undefined,
  })
}
```

- [ ] **Step 3: Re-export from `client.ts`:**

```ts
export {
  updateIssueTitle,
  updateIssueMilestone,
  addAssignees,
  removeAssignees,
  updateIssueState,
} from "./issue-writes"
export type { IssueStateUpdate } from "./issue-writes"
```

- [ ] **Step 4:** `bun test packages/integrations/github/src/issue-writes.test.ts` — expect all passing.

- [ ] **Step 5: Commit:**

```bash
git add packages/integrations/github/src/issue-writes.ts \
        packages/integrations/github/src/issue-writes.test.ts \
        packages/integrations/github/src/client.ts
git commit -m "feat(github-adapter): issue-write helpers (title, milestone, assignees, state)"
```

---

## Section B — Write-locks + signatures

### Task 2: Signature helpers (pure)

**Files:** create `apps/dashboard/server/lib/github-diff.ts` + `.test.ts`.

- [ ] **Step 1: Tests:**

```ts
import { describe, test, expect } from "bun:test"
import {
  signLabels, signAssignees, signMilestone, signState, signTitle,
  diffAssignees,
} from "./github-diff"

describe("signLabels", () => {
  test("sorted input produces stable signature", () => {
    expect(signLabels(["bug", "feat"])).toBe(signLabels(["feat", "bug"]))
  })
  test("different sets differ", () => {
    expect(signLabels(["bug"])).not.toBe(signLabels(["feat"]))
  })
  test("empty set is well-defined", () => {
    expect(typeof signLabels([])).toBe("string")
  })
})

describe("signAssignees", () => {
  test("sorted github user ids → stable", () => {
    expect(signAssignees(["42", "7"])).toBe(signAssignees(["7", "42"]))
  })
})

describe("signMilestone", () => {
  test("null has its own signature", () => {
    expect(signMilestone(null)).not.toBe(signMilestone(0))
  })
  test("different numbers differ", () => {
    expect(signMilestone(1)).not.toBe(signMilestone(2))
  })
})

describe("signState", () => {
  test("includes state_reason", () => {
    expect(signState("closed", "completed")).not.toBe(signState("closed", "not_planned"))
  })
  test("open with null reason is stable", () => {
    expect(signState("open", null)).toBe(signState("open", null))
  })
})

describe("signTitle", () => {
  test("whitespace-exact match", () => {
    expect(signTitle("hello")).toBe(signTitle("hello"))
    expect(signTitle("hello")).not.toBe(signTitle("hello "))
  })
})

describe("diffAssignees", () => {
  test("returns added and removed arrays", () => {
    const r = diffAssignees(["a", "b"], ["b", "c"])
    expect(r.toAdd.sort()).toEqual(["c"])
    expect(r.toRemove.sort()).toEqual(["a"])
  })
  test("both empty = no diff", () => {
    expect(diffAssignees([], [])).toEqual({ toAdd: [], toRemove: [] })
  })
})
```

- [ ] **Step 2: Implementation:**

```ts
import { createHash } from "node:crypto"

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

export function signLabels(labels: string[]): string {
  return sha256([...labels].sort().join(","))
}

export function signAssignees(githubUserIds: string[]): string {
  return sha256([...githubUserIds].sort().join(","))
}

export function signMilestone(milestoneNumber: number | null): string {
  return sha256(milestoneNumber === null ? "null" : String(milestoneNumber))
}

export function signState(state: "open" | "closed", stateReason: string | null): string {
  return sha256(`${state}:${stateReason ?? "null"}`)
}

export function signTitle(title: string): string {
  return sha256(title)
}

export function diffAssignees(
  current: string[],
  next: string[],
): { toAdd: string[]; toRemove: string[] } {
  const currentSet = new Set(current)
  const nextSet = new Set(next)
  return {
    toAdd: next.filter((x) => !currentSet.has(x)),
    toRemove: current.filter((x) => !nextSet.has(x)),
  }
}
```

- [ ] **Step 3:** `bun test apps/dashboard/server/lib/github-diff.test.ts` — expect passing.

- [ ] **Step 4: Commit:**

```bash
git add apps/dashboard/server/lib/github-diff.ts apps/dashboard/server/lib/github-diff.test.ts
git commit -m "feat(github-diff): signature + assignee-diff helpers for write-locks"
```

### Task 3: Write-lock insert / match / cleanup

**Files:** create `apps/dashboard/server/lib/github-write-locks.ts` + `.test.ts`.

- [ ] **Step 1: Tests:**

```ts
import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { db } from "../db"
import { githubWriteLocks } from "../db/schema/github-write-locks"
import { reports } from "../db/schema/reports"
import { projects } from "../db/schema/projects"
import { truncateReports, truncateDomain, createUser } from "../../tests/helpers"
import {
  recordWriteLock,
  consumeWriteLock,
  cleanupExpiredLocks,
  WRITE_LOCK_TTL_MS,
} from "./github-write-locks"
import { eq } from "drizzle-orm"

let reportId: string

beforeEach(async () => {
  await truncateReports()
  await truncateDomain()
  const ownerId = await createUser("lock-owner@x.com", "member")
  const [p] = await db.insert(projects).values({ name: "lock-test", createdBy: ownerId }).returning()
  const [r] = await db.insert(reports).values({
    projectId: p.id, title: "t", description: "d", status: "open", priority: "normal", tags: [],
  }).returning()
  reportId = r.id
})

afterAll(async () => {
  await db.delete(githubWriteLocks)
})

describe("write-locks", () => {
  test("recordWriteLock inserts a row", async () => {
    await recordWriteLock(db, { reportId, kind: "labels", signature: "sig-a" })
    const rows = await db.select().from(githubWriteLocks).where(eq(githubWriteLocks.reportId, reportId))
    expect(rows).toHaveLength(1)
    expect(rows[0].signature).toBe("sig-a")
  })

  test("consumeWriteLock returns true and deletes matching row", async () => {
    await recordWriteLock(db, { reportId, kind: "assignees", signature: "sig-b" })
    const matched = await consumeWriteLock(db, { reportId, kind: "assignees", signature: "sig-b" })
    expect(matched).toBe(true)
    const rows = await db.select().from(githubWriteLocks).where(eq(githubWriteLocks.reportId, reportId))
    expect(rows).toHaveLength(0)
  })

  test("consumeWriteLock returns false when no match", async () => {
    const matched = await consumeWriteLock(db, { reportId, kind: "state", signature: "sig-x" })
    expect(matched).toBe(false)
  })

  test("consumeWriteLock ignores expired rows", async () => {
    // Manually insert an expired lock
    await db.insert(githubWriteLocks).values({
      reportId, kind: "milestone", signature: "sig-expired",
      expiresAt: new Date(Date.now() - 1000),
    })
    const matched = await consumeWriteLock(db, { reportId, kind: "milestone", signature: "sig-expired" })
    expect(matched).toBe(false)
  })

  test("cleanupExpiredLocks removes only expired rows", async () => {
    await db.insert(githubWriteLocks).values([
      { reportId, kind: "title", signature: "live", expiresAt: new Date(Date.now() + 60_000) },
      { reportId, kind: "title", signature: "expired", expiresAt: new Date(Date.now() - 60_000) },
    ])
    const removed = await cleanupExpiredLocks(db)
    expect(removed).toBeGreaterThanOrEqual(1)
    const rows = await db.select().from(githubWriteLocks).where(eq(githubWriteLocks.reportId, reportId))
    const sigs = rows.map((r) => r.signature)
    expect(sigs).toContain("live")
    expect(sigs).not.toContain("expired")
  })
})
```

- [ ] **Step 2: Implementation** (`github-write-locks.ts`):

```ts
import { and, eq, lt } from "drizzle-orm"
import { db as defaultDb } from "../db"
import { githubWriteLocks } from "../db/schema/github-write-locks"

export const WRITE_LOCK_TTL_MS = 30_000

type Db = typeof defaultDb
type Kind = "labels" | "assignees" | "milestone" | "state" | "title" | "comment_upsert" | "comment_delete"

export async function recordWriteLock(
  db: Db,
  args: { reportId: string; kind: Kind; signature: string },
): Promise<void> {
  await db.insert(githubWriteLocks).values({
    reportId: args.reportId,
    kind: args.kind,
    signature: args.signature,
    expiresAt: new Date(Date.now() + WRITE_LOCK_TTL_MS),
  })
}

export async function consumeWriteLock(
  db: Db,
  args: { reportId: string; kind: Kind; signature: string },
): Promise<boolean> {
  const now = new Date()
  // Delete any live row matching (reportId, kind, signature); if it deleted something, it's our echo.
  const res = await db
    .delete(githubWriteLocks)
    .where(
      and(
        eq(githubWriteLocks.reportId, args.reportId),
        eq(githubWriteLocks.kind, args.kind),
        eq(githubWriteLocks.signature, args.signature),
        // ensure expires_at > now
      ),
    )
    .returning({ id: githubWriteLocks.id, expiresAt: githubWriteLocks.expiresAt })
  // Filter out ones that were expired anyway (very rare; drizzle doesn't support WHERE+DELETE compounds perfectly across dialects)
  const live = res.filter((r) => r.expiresAt.getTime() > now.getTime())
  return live.length > 0
}

export async function cleanupExpiredLocks(db: Db): Promise<number> {
  const res = await db
    .delete(githubWriteLocks)
    .where(lt(githubWriteLocks.expiresAt, new Date()))
    .returning({ id: githubWriteLocks.id })
  return res.length
}
```

**Caveat on `consumeWriteLock`:** the implementation deletes all matching (reportId, kind, signature) rows and then counts live ones. A cleaner SQL form would be `DELETE ... WHERE ... AND expires_at > NOW()`. Drizzle's `delete(...).where(and(..., gt(..., sql\`NOW()\`)))` should work; verify the exact syntax — if straightforward, prefer that form. The two-step approach above is a safe fallback.

- [ ] **Step 3:** `bun test apps/dashboard/server/lib/github-write-locks.test.ts` → passing.

- [ ] **Step 4: Commit:**

```bash
git add apps/dashboard/server/lib/github-write-locks.ts \
        apps/dashboard/server/lib/github-write-locks.test.ts
git commit -m "feat(write-locks): record/consume/cleanup helpers"
```

### Task 4: Nitro scheduled task for lock cleanup

**Files:** create `apps/dashboard/server/tasks/github/cleanup-write-locks.ts`.

- [ ] **Step 1: Look at an existing Nitro scheduled task** (e.g. `apps/dashboard/server/tasks/github/sync.ts`) for the pattern — Nitro v3's task definition + registration in `nuxt.config.ts`.

- [ ] **Step 2: Create the task:**

```ts
import { cleanupExpiredLocks } from "~/server/lib/github-write-locks"
import { db } from "~/server/db"

export default defineTask({
  meta: {
    name: "github:cleanup-write-locks",
    description: "Delete expired github_write_locks rows",
  },
  async run() {
    const removed = await cleanupExpiredLocks(db)
    return { result: { removed } }
  },
})
```

- [ ] **Step 3: Register in `nuxt.config.ts`**

Find the `nitro.scheduledTasks` (or `scheduler`) block. If the existing `github:sync` task runs every 10 seconds, add a daily `github:cleanup-write-locks`:

```ts
scheduledTasks: {
  "0 3 * * *": ["github:cleanup-write-locks"],
  // preserve existing tasks
},
```

If Nitro is configured differently (e.g. tasks are self-describing with their own cron metadata), match that pattern. If there's no scheduled task system in use, just ensure the task is *callable* and note in the commit message that a cron trigger should be wired by the operator.

- [ ] **Step 4: Commit:**

```bash
git add apps/dashboard/server/tasks/github/cleanup-write-locks.ts \
        apps/dashboard/nuxt.config.ts
git commit -m "feat(tasks): daily cleanup of expired github_write_locks"
```

---

## Section C — Extend the reconciler

### Task 5: Pull issue state, diff, push

**Files:** modify `apps/dashboard/server/lib/github-reconcile.ts`.

Read the existing file first. Note the existing flow: loads report, loads integration, calls `findIssueByMarker` (for idempotency on create), creates issue OR reconciles existing issue's state + labels.

- [ ] **Step 1: Add a "pull current issue" helper**

Inside `github-reconcile.ts`, add a helper that loads the GitHub issue's current server-side state (title, state, state_reason, labels, assignees, milestone):

```ts
async function loadCurrentGithubIssue(
  client: Octokit, owner: string, repo: string, issueNumber: number,
): Promise<{
  title: string
  state: "open" | "closed"
  stateReason: string | null
  labels: string[]
  assignees: Array<{ githubUserId: string; login: string }>
  milestone: { number: number; title: string } | null
}> {
  const res = await client.rest.issues.get({ owner, repo, issue_number: issueNumber })
  const issue = res.data
  return {
    title: issue.title,
    state: issue.state as "open" | "closed",
    stateReason: issue.state_reason ?? null,
    labels: issue.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean),
    assignees: (issue.assignees ?? []).map((a) => ({ githubUserId: String(a!.id), login: a!.login })),
    milestone: issue.milestone ? { number: issue.milestone.number, title: issue.milestone.title } : null,
  }
}
```

- [ ] **Step 2: Extend the reconciliation path**

Inside the existing `reconcileReport` (or whatever the function is named), after identifying or creating the issue, change the "reconcile existing" branch:

```ts
// Load desired state from DB
const desired = {
  title: report.title,
  state: mapReportStatusToGithubState(report.status), // existing helper; returns { state, stateReason }
  labels: labelsFor(report, integration),             // existing helper
  assignees: await loadDesiredAssigneesGithubUserIds(reportId), // see below
  milestone: report.milestoneNumber,                   // nullable
}

// Load current state from GitHub
const current = await loadCurrentGithubIssue(client, integration.repoOwner, integration.repoName, issueNumber)

// Diff + execute
await reconcileTitle(current, desired, client, integration, reportId, issueNumber)
await reconcileLabels(current, desired, client, integration, reportId, issueNumber)
await reconcileState(current, desired, client, integration, reportId, issueNumber)
await reconcileAssignees(current, desired, client, integration, reportId, issueNumber)
await reconcileMilestone(current, desired, client, integration, reportId, issueNumber)
```

For each `reconcileX`:

```ts
async function reconcileTitle(current, desired, client, integration, reportId, issueNumber) {
  if (current.title === desired.title) return
  await recordWriteLock(db, { reportId, kind: "title", signature: signTitle(desired.title) })
  await updateIssueTitle(client, integration.repoOwner, integration.repoName, issueNumber, desired.title)
}

async function reconcileLabels(current, desired, client, integration, reportId, issueNumber) {
  const currentSet = new Set(current.labels)
  const desiredSet = new Set(desired.labels)
  if (currentSet.size === desiredSet.size && [...currentSet].every((l) => desiredSet.has(l))) return
  await recordWriteLock(db, { reportId, kind: "labels", signature: signLabels(desired.labels) })
  await updateIssueLabels(client, integration.repoOwner, integration.repoName, issueNumber, desired.labels)
}

async function reconcileState(current, desired, client, integration, reportId, issueNumber) {
  if (current.state === desired.state.state && current.stateReason === desired.state.stateReason) return
  await recordWriteLock(db, { reportId, kind: "state", signature: signState(desired.state.state, desired.state.stateReason) })
  await updateIssueState(client, integration.repoOwner, integration.repoName, issueNumber, desired.state)
}

async function reconcileAssignees(current, desired, client, integration, reportId, issueNumber) {
  // current.assignees is {login, githubUserId}; desired.assignees is logins
  // Map current to logins for diff (GitHub's add/remove APIs take logins)
  const currentLogins = current.assignees.map((a) => a.login)
  const { toAdd, toRemove } = diffAssignees(currentLogins, desired.assignees)
  if (toAdd.length === 0 && toRemove.length === 0) return
  await recordWriteLock(db, { reportId, kind: "assignees", signature: signAssignees(desired.assignees) })
  await addAssignees(client, integration.repoOwner, integration.repoName, issueNumber, toAdd)
  await removeAssignees(client, integration.repoOwner, integration.repoName, issueNumber, toRemove)
}

async function reconcileMilestone(current, desired, client, integration, reportId, issueNumber) {
  const currentNum = current.milestone?.number ?? null
  if (currentNum === desired.milestone) return
  await recordWriteLock(db, { reportId, kind: "milestone", signature: signMilestone(desired.milestone) })
  await updateIssueMilestone(client, integration.repoOwner, integration.repoName, issueNumber, desired.milestone)
}
```

`loadDesiredAssigneesGithubUserIds` (new helper):

```ts
async function loadDesiredAssigneeLogins(reportId: string): Promise<string[]> {
  const rows = await db
    .select({ login: reportAssignees.githubLogin, userId: reportAssignees.userId })
    .from(reportAssignees)
    .where(eq(reportAssignees.reportId, reportId))
  const logins: string[] = []
  const dashboardUserIds: string[] = []
  for (const r of rows) {
    if (r.login) logins.push(r.login)
    else if (r.userId) dashboardUserIds.push(r.userId)
  }
  if (dashboardUserIds.length) {
    // Map dashboard user ids → github logins via user_identities
    const linked = await db
      .select({ userId: userIdentities.userId, handle: userIdentities.externalHandle })
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, "github"), inArray(userIdentities.userId, dashboardUserIds)))
    for (const l of linked) logins.push(l.handle)
  }
  return [...new Set(logins)]
}
```

- [ ] **Step 3:** Update any existing `github-reconcile.test.ts` tests so they still pass. Most should — the existing behavior is a proper subset of the new behavior.

- [ ] **Step 4:** Update `reports.github_synced_at` at the end of a successful reconcile:
```ts
await db.update(reports).set({ githubSyncedAt: new Date() }).where(eq(reports.id, reportId))
```

- [ ] **Step 5:** `bun test apps/dashboard/server/lib/github-reconcile.test.ts` (if it exists) and `bun test apps/dashboard/tests/api/github-sync.test.ts` → all passing.

- [ ] **Step 6: Commit:**

```bash
git add apps/dashboard/server/lib/github-reconcile.ts
git commit -m "feat(reconcile): diff + push title, labels, state, assignees, milestone with write-locks"
```

---

## Section D — PATCH enqueue

### Task 6: Trigger sync on qualifying edits

**Files:** modify `apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts`.

- [ ] **Step 1:** At the end of the transaction (after all DB writes committed), call `enqueueSync` conditionally:

```ts
const [integration] = await db
  .select({
    status: githubIntegrations.status,
    pushOnEdit: githubIntegrations.pushOnEdit,
    installationId: githubIntegrations.installationId,
  })
  .from(githubIntegrations)
  .where(eq(githubIntegrations.projectId, projectId))
  .limit(1)

const ticketIsLinked = currentReport.githubIssueNumber !== null
const aSyncedFieldChanged =
  statusChanged || priorityChanged || tagsChanged || titleChanged ||
  assigneesChanged || githubAssigneesChanged || milestoneChanged

if (
  integration &&
  integration.status === "connected" &&
  integration.pushOnEdit &&
  ticketIsLinked &&
  aSyncedFieldChanged
) {
  await enqueueSync(reportId, projectId)
}
```

Where `*Changed` booleans are computed at the top of the transaction from the diff between `input` and `currentReport`. If the existing handler already tracks these for its event-emission logic, reuse those booleans.

**Critical:** the enqueue must happen *inside* the same transaction as the writes that produced the diff. If `enqueueSync` takes a db/tx argument, pass `tx`. If it always uses the global db, that's OK too — the queue row just lands slightly after commit, which is still race-safe because the job loads latest state when it runs.

- [ ] **Step 2: Test** — append to `apps/dashboard/tests/api/assignees-multi.test.ts` OR create a new `apps/dashboard/tests/api/push-on-edit.test.ts`:

```ts
test("PATCH on linked ticket with push_on_edit=true enqueues a sync job", async () => {
  const { projectId, cookie } = await seedLinkedProject("poe-owner@x.com")
  await db
    .update(githubIntegrations)
    .set({ pushOnEdit: true })
    .where(eq(githubIntegrations.projectId, projectId))

  const [r] = await db
    .insert(reports)
    .values({
      projectId, title: "t", description: "d", status: "open", priority: "normal", tags: [],
      githubIssueNumber: 7,
    })
    .returning()

  await apiFetch(`/api/projects/${projectId}/reports/${r.id}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ status: "resolved" }),
  })

  const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, r.id))
  expect(jobs).toHaveLength(1)
  expect(jobs[0].state).toBe("pending")
})

test("PATCH with push_on_edit=false does NOT enqueue", async () => {
  const { projectId, cookie } = await seedLinkedProject("poe-off@x.com")
  // push_on_edit stays false (default)
  const [r] = await db
    .insert(reports)
    .values({
      projectId, title: "t", description: "d", status: "open", priority: "normal", tags: [],
      githubIssueNumber: 8,
    })
    .returning()

  await apiFetch(`/api/projects/${projectId}/reports/${r.id}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ status: "resolved" }),
  })

  const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, r.id))
  expect(jobs).toHaveLength(0)
})

test("PATCH on unlinked ticket does NOT enqueue even with push_on_edit=true", async () => {
  const { projectId, cookie } = await seedLinkedProject("poe-unlinked@x.com")
  await db
    .update(githubIntegrations)
    .set({ pushOnEdit: true })
    .where(eq(githubIntegrations.projectId, projectId))
  const [r] = await db
    .insert(reports)
    .values({ projectId, title: "t", description: "d", status: "open", priority: "normal", tags: [] })
    .returning()
  // githubIssueNumber is null → unlinked

  await apiFetch(`/api/projects/${projectId}/reports/${r.id}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ status: "resolved" }),
  })

  const jobs = await db.select().from(reportSyncJobs).where(eq(reportSyncJobs.reportId, r.id))
  expect(jobs).toHaveLength(0)
})
```

Import `reportSyncJobs` from the existing schema file.

- [ ] **Step 3: Commit:**

```bash
git add apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts \
        apps/dashboard/tests/api/push-on-edit.test.ts
git commit -m "feat(triage): enqueue github sync on qualifying PATCH when push_on_edit=true"
```

---

## Section E — Webhook expansion

### Task 7: Webhook write-lock checks + new event branches

**Files:** modify `apps/dashboard/server/api/integrations/github/webhook.post.ts`.

- [ ] **Step 1: Add write-lock checks to existing branches**

For `issues.closed`, `issues.reopened`, `issues.labeled`, `issues.unlabeled` (existing), compute the post-event state's signature and try to consume a write-lock. If consumed → skip (our own echo).

Example for `issues.closed`:
```ts
case "issues": {
  const action = payload.action as string
  const issue = payload.issue

  // ... look up report by issue_number ...
  if (!report) break

  if (action === "closed" || action === "reopened") {
    const newState = action === "closed" ? "closed" : "open"
    const stateReason = issue.state_reason ?? null
    const sig = signState(newState, stateReason)
    if (await consumeWriteLock(db, { reportId: report.id, kind: "state", signature: sig })) {
      break // our own echo
    }
    // ... existing status-mapping + write ...
  }

  if (action === "labeled" || action === "unlabeled") {
    const labels = (issue.labels ?? []).map((l: unknown) => typeof l === "string" ? l : (l as { name: string }).name)
    const sig = signLabels(labels)
    if (await consumeWriteLock(db, { reportId: report.id, kind: "labels", signature: sig })) {
      break
    }
    // ... existing parseGithubLabels + write ...
  }

  if (action === "assigned" || action === "unassigned") {
    const assigneeLogins = (issue.assignees ?? []).map((a: { login: string }) => a.login)
    const sig = signAssignees(assigneeLogins)
    if (await consumeWriteLock(db, { reportId: report.id, kind: "assignees", signature: sig })) {
      break
    }
    await applyInboundAssignees(report.id, issue.assignees ?? [])
  }

  if (action === "milestoned" || action === "demilestoned") {
    const milestoneNumber = issue.milestone?.number ?? null
    const sig = signMilestone(milestoneNumber)
    if (await consumeWriteLock(db, { reportId: report.id, kind: "milestone", signature: sig })) {
      break
    }
    await db
      .update(reports)
      .set({
        milestoneNumber,
        milestoneTitle: issue.milestone?.title ?? null,
      })
      .where(eq(reports.id, report.id))
    await emitReportEvent(db, {
      reportId: report.id,
      actorId: null,
      kind: "milestone_changed",
      payload: { from: null, to: milestoneNumber === null ? null : { number: milestoneNumber, title: issue.milestone?.title } },
    })
  }

  if (action === "edited" && payload.changes?.title) {
    const sig = signTitle(issue.title)
    if (await consumeWriteLock(db, { reportId: report.id, kind: "title", signature: sig })) {
      break
    }
    await db.update(reports).set({ title: issue.title }).where(eq(reports.id, report.id))
  }

  break
}
```

`applyInboundAssignees` helper (new, near the top of the file or in `server/lib/github-inbound.ts`):

```ts
async function applyInboundAssignees(
  reportId: string,
  assignees: Array<{ id: number; login: string; avatar_url?: string | null }>,
) {
  // Full-replace: the inbound list IS the new assignee set.
  await db.transaction(async (tx) => {
    // Delete all existing github-sourced assignees AND all dashboard-linked ones whose github identity is present in the inbound set (to reconcile)
    // Simplest: full replace.
    await tx.delete(reportAssignees).where(eq(reportAssignees.reportId, reportId))
    for (const a of assignees) {
      const resolved = await resolveGithubUser(String(a.id), a.login, a.avatar_url ?? null)
      if (resolved.kind === "dashboard-user") {
        await tx.insert(reportAssignees).values({
          reportId, userId: resolved.userId,
          githubLogin: a.login, githubUserId: String(a.id),
          githubAvatarUrl: a.avatar_url ?? null,
        })
      } else {
        await tx.insert(reportAssignees).values({
          reportId, githubLogin: a.login, githubUserId: String(a.id),
          githubAvatarUrl: a.avatar_url ?? null,
        })
      }
      await emitReportEvent(tx, {
        reportId, actorId: null,
        kind: "assignee_added", payload: { githubLogin: a.login },
      })
    }
  })
}
```

**Tradeoff note on the full-replace approach:** we lose the delta between inbound assigned/unassigned events (since each event carries the full issue's assignees list post-change). For Phase 2 this is fine — the result is correct even if the audit log has fewer fine-grained entries. A subsequent enhancement can compute proper add/remove deltas from previous state.

- [ ] **Step 2: Tests** — create `apps/dashboard/tests/api/github-webhook-expanded.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "bun:test"
import { createHmac } from "node:crypto"
import { apiFetch, truncateDomain, truncateReports, createUser, seedProject } from "../helpers"
import { db } from "../../server/db"
import { reports } from "../../server/db/schema/reports"
import { reportAssignees } from "../../server/db/schema/report-assignees"
import { githubIntegrations } from "../../server/db/schema/github-integrations"
import { githubApp } from "../../server/db/schema/github-app"
import { githubWriteLocks } from "../../server/db/schema/github-write-locks"
import { projectMembers } from "../../server/db/schema/project-members"
import { eq } from "drizzle-orm"

const WEBHOOK_SECRET = "test-webhook-secret"
function sign(body: string) {
  return "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")
}

async function seedLinkedReport(ownerEmail: string) {
  await truncateDomain()
  await truncateReports()
  await db.delete(githubIntegrations)
  await db.delete(githubApp)
  await db.delete(githubWriteLocks)
  await db.insert(githubApp).values({
    id: 1, appId: "1", slug: "test", privateKey: "x", webhookSecret: WEBHOOK_SECRET,
    clientId: "x", clientSecret: "x", htmlUrl: "https://github.com/apps/test",
    createdBy: "test",
  })
  const ownerId = await createUser(ownerEmail, "member")
  const projectId = await seedProject({ name: "wx-test", publicKey: `pk_${crypto.randomUUID()}`, createdBy: ownerId })
  await db.insert(projectMembers).values({ projectId, userId: ownerId, role: "owner" })
  await db.insert(githubIntegrations).values({
    projectId, installationId: 42, repoOwner: "acme", repoName: "repro", status: "connected",
  })
  const [r] = await db.insert(reports).values({
    projectId, title: "t", description: "d", status: "open", priority: "normal", tags: [],
    githubIssueNumber: 99, githubIssueUrl: "https://github.com/acme/repro/issues/99",
  }).returning()
  return { projectId, reportId: r.id }
}

async function postWebhook(event: string, body: object) {
  const raw = JSON.stringify(body)
  const res = await apiFetch("/api/integrations/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sign(raw),
      "x-github-event": event,
      "x-github-delivery": crypto.randomUUID(),
    },
    body: raw,
  })
  return res
}

describe("expanded webhook events", () => {
  test("issues.assigned populates report_assignees", async () => {
    const { reportId } = await seedLinkedReport("ws-assigned@x.com")
    const res = await postWebhook("issues", {
      action: "assigned",
      issue: {
        number: 99,
        assignees: [{ id: 1001, login: "octocat", avatar_url: "https://a/o.png" }],
      },
      installation: { id: 42 },
      repository: { owner: { login: "acme" }, name: "repro" },
    })
    expect(res.status).toBe(202)
    const rows = await db.select().from(reportAssignees).where(eq(reportAssignees.reportId, reportId))
    expect(rows).toHaveLength(1)
    expect(rows[0].githubLogin).toBe("octocat")
  })

  test("issues.milestoned updates reports.milestoneNumber", async () => {
    const { reportId } = await seedLinkedReport("ws-ms@x.com")
    await postWebhook("issues", {
      action: "milestoned",
      issue: { number: 99, assignees: [], milestone: { number: 5, title: "M5" } },
      installation: { id: 42 },
      repository: { owner: { login: "acme" }, name: "repro" },
    })
    const [row] = await db.select().from(reports).where(eq(reports.id, reportId))
    expect(row.milestoneNumber).toBe(5)
    expect(row.milestoneTitle).toBe("M5")
  })

  test("issues.demilestoned clears milestone", async () => {
    const { reportId } = await seedLinkedReport("ws-de@x.com")
    await db.update(reports).set({ milestoneNumber: 5, milestoneTitle: "M5" }).where(eq(reports.id, reportId))
    await postWebhook("issues", {
      action: "demilestoned",
      issue: { number: 99, assignees: [], milestone: null },
      installation: { id: 42 },
      repository: { owner: { login: "acme" }, name: "repro" },
    })
    const [row] = await db.select().from(reports).where(eq(reports.id, reportId))
    expect(row.milestoneNumber).toBeNull()
  })

  test("issues.edited (title) updates reports.title", async () => {
    const { reportId } = await seedLinkedReport("ws-title@x.com")
    await postWebhook("issues", {
      action: "edited",
      changes: { title: { from: "t" } },
      issue: { number: 99, assignees: [], title: "New title" },
      installation: { id: 42 },
      repository: { owner: { login: "acme" }, name: "repro" },
    })
    const [row] = await db.select().from(reports).where(eq(reports.id, reportId))
    expect(row.title).toBe("New title")
  })

  test("echo: write-lock skips apply", async () => {
    const { reportId } = await seedLinkedReport("ws-echo@x.com")
    // Pre-seed the write-lock as if we just wrote the title ourselves.
    const { signTitle } = await import("../../server/lib/github-diff")
    const { recordWriteLock } = await import("../../server/lib/github-write-locks")
    await recordWriteLock(db, {
      reportId, kind: "title", signature: signTitle("Echo title"),
    })
    await postWebhook("issues", {
      action: "edited",
      changes: { title: { from: "t" } },
      issue: { number: 99, assignees: [], title: "Echo title" },
      installation: { id: 42 },
      repository: { owner: { login: "acme" }, name: "repro" },
    })
    const [row] = await db.select().from(reports).where(eq(reports.id, reportId))
    // Title should NOT have been updated because it was our echo
    expect(row.title).toBe("t")
    // The lock should have been consumed
    const locks = await db.select().from(githubWriteLocks).where(eq(githubWriteLocks.reportId, reportId))
    expect(locks).toHaveLength(0)
  })
})
```

Run and fix until all passing. This is load-bearing — if write-lock echoes don't work, push-on-edit loops.

- [ ] **Step 3: Commit:**

```bash
git add apps/dashboard/server/api/integrations/github/webhook.post.ts \
        apps/dashboard/tests/api/github-webhook-expanded.test.ts
git commit -m "feat(webhook): assigned/milestoned/edited branches + write-lock echo skip"
```

---

## Section F — Config UI

### Task 8: Toggle `push_on_edit` from project settings

**Files:** modify `apps/dashboard/app/components/integrations/github/github-panel.vue`; extend `packages/shared/src/github.ts`; extend `apps/dashboard/server/api/projects/[id]/integrations/github/index.patch.ts`.

- [ ] **Step 1: DTO** — append to `packages/shared/src/github.ts`:

```ts
// In GithubConfigDTO
pushOnEdit: z.boolean(),

// In UpdateGithubConfigInput
pushOnEdit: z.boolean().optional(),
```

- [ ] **Step 2: GET endpoint** — ensure `pushOnEdit` is included in the response (the route at `apps/dashboard/server/api/projects/[id]/integrations/github/index.get.ts` selects integration fields; add `pushOnEdit`).

- [ ] **Step 3: PATCH endpoint** — accept `pushOnEdit` in the input; persist to `github_integrations.pushOnEdit`.

- [ ] **Step 4: UI toggle** — add a `USwitch` to `github-panel.vue` near the default-labels / default-assignees fields:

```vue
<div class="flex items-center justify-between">
  <div>
    <div class="font-medium">Auto-sync edits to GitHub</div>
    <p class="text-xs text-muted">
      When on, changes to status, labels, assignees, and milestone on the dashboard
      push to the linked issue. Leave off for a manual-sync workflow.
    </p>
  </div>
  <USwitch v-model="localPushOnEdit" @change="patchConfig" />
</div>
```

- [ ] **Step 5: New integration rows default to `push_on_edit=true`** — find the install-callback / reconnect route that INSERTs a new `github_integrations` row. Add `pushOnEdit: true` to the insert's values. This preserves Phase 0's invariant: pre-existing integrations stay `false`, new ones default to `true`.

- [ ] **Step 6: Commit:**

```bash
git add apps/dashboard/app/components/integrations/github/github-panel.vue \
        apps/dashboard/server/api/projects/[id]/integrations/github/index.patch.ts \
        apps/dashboard/server/api/projects/[id]/integrations/github/index.get.ts \
        apps/dashboard/server/api/projects/[id]/integrations/github/install-callback.get.ts \
        packages/shared/src/github.ts
git commit -m "feat(integration-ui): push_on_edit toggle + new-integration default-on"
```

---

## Section G — End-to-end roundtrip test

### Task 9: Full push-on-edit + echo-skip integration test

**Files:** create `apps/dashboard/tests/api/github-push-on-edit.test.ts`.

- [ ] **Step 1:** Write a test that:
  1. Seeds a linked project with `push_on_edit=true` and an existing issue (`githubIssueNumber=99`)
  2. Sets up `__setClientOverride` with an Octokit fake that records calls AND responds to `issues.get` with current state
  3. PATCHes the ticket's title
  4. Manually runs `reconcileReport(reportId)` (synchronously bypass the worker tick)
  5. Verifies the fake Octokit got the `issues.update` call with the new title
  6. Verifies a `github_write_locks` row for `(reportId, "title", signTitle("new title"))` exists
  7. Simulates the inbound webhook for `issues.edited` with the new title
  8. Verifies the write-lock is consumed AND `reports.title` is unchanged (no double-apply)

This is the load-bearing test for Phase 2. If it passes, push-on-edit works end-to-end.

Detailed test code will be substantial (~150 lines). Model it on the existing `github-sync.test.ts` patterns — same `__setClientOverride` mechanics, same seed fixtures.

- [ ] **Step 2:** Run, debug to green.

- [ ] **Step 3: Commit:**

```bash
git add apps/dashboard/tests/api/github-push-on-edit.test.ts
git commit -m "test: end-to-end push-on-edit roundtrip with write-lock echo-skip"
```

---

## Final verification

### Task 10: Full suite + lint + smoke

- [ ] `bun test` — all tests passing.
- [ ] `bun run check` — clean on touched files.
- [ ] Manual smoke via dev server: with a linked project + `push_on_edit=true`, changing the title / assignee in the drawer results in an `issues.update` call to GitHub (check via staging repo, or mock override in development).

Commit any fixups.

---

## Self-review checklist

- [ ] Adapter writes (title, milestone, addAssignees, removeAssignees, state) exist in `@reprojs/integrations-github`.
- [ ] Write-lock helpers record/consume/cleanup in `server/lib/github-write-locks.ts`.
- [ ] Pure signature helpers in `server/lib/github-diff.ts` — stable across input ordering, differ across inputs.
- [ ] Reconciler diffs all 5 resources (title, state, labels, assignees, milestone) and records a write-lock per outbound call.
- [ ] Triage PATCH conditionally enqueues a sync job (`push_on_edit=true` AND linked AND synced-field changed).
- [ ] Webhook handler skips echoes via `consumeWriteLock` for all 5 event kinds.
- [ ] `issues.assigned/unassigned/milestoned/demilestoned/edited` branches write to Postgres correctly (full-replace for assignees).
- [ ] `push_on_edit` toggle in project-settings UI; new integrations default to `true`, existing stay `false`.
- [ ] Daily cleanup task for expired write-locks is registered.
- [ ] End-to-end roundtrip test passes.
- [ ] `bun run check` clean on touched files.
