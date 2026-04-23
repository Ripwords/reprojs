# Deeper GitHub Integration — Phase 3 (Comments Two-Way) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add a bidirectional comment thread to each ticket. Dashboard users post in the drawer's new Comments tab; comments are mirrored to the linked GitHub issue (as the App bot, preserving human authorship in a footer). Issue comments created on GitHub mirror back to the dashboard in near-real-time via webhook.

**Architecture:** Four parts. (1) Adapter wrappers for `issues.comments.*`. (2) Dashboard-side comment API (GET/POST/PATCH/DELETE) writing to `report_comments`, enqueuing sync jobs when the ticket is GitHub-linked. (3) Reconciler extension handling `comment_upsert` / `comment_delete` job kinds. (4) Webhook `issue_comment.*` branches with write-lock echo detection. (5) Comments tab UI with GitHub-flavoured markdown rendering (new dep: `marked` or `markdown-it`).

**Tech Stack:** Nuxt 4, Nitro, Octokit, Drizzle ORM, Vue 3 + Nuxt UI, `bun:test`. Adds one dep: a markdown renderer.

**Spec:** §10 of `docs/superpowers/specs/2026-04-24-deeper-github-integration-design.md`.

**Scope kept OUT of Phase 3:**
- Per-user OAuth tokens for impersonated comment posting (bot-attribution footer is the v1 identity model).
- Image-upload proxying (pasted markdown image URLs pass through as-is; no blob upload).
- Real-time SSE push (use polling every 20s on drawer mount — simpler, good enough for v1).
- Notifications (no notification system in the codebase today).

**Phase 0/1/2 dependencies:**
- `report_comments` table exists (Phase 0)
- `github_write_locks` + helpers exist (Phase 2)
- Write-lock kinds `comment_upsert`, `comment_delete` already in the enum (Phase 0)
- `resolveGithubUser` / `resolveGithubUsers` helpers exist (Phase 1)
- Reconciler + job queue exist (Phase 2)

---

## File structure

### New files
- `packages/integrations/github/src/comments.ts` — `createIssueComment`, `updateIssueComment`, `deleteIssueComment`, `listIssueComments` Octokit wrappers.
- `packages/integrations/github/src/comments.test.ts`
- `apps/dashboard/server/lib/comment-serializer.ts` — pure functions: `withBotFooter(body, author)` and `stripBotFooter(body)`.
- `apps/dashboard/server/lib/comment-serializer.test.ts`
- `apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/index.get.ts` — list
- `apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/index.post.ts` — create
- `apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/[commentId].patch.ts` — edit
- `apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/[commentId].delete.ts` — delete
- `apps/dashboard/tests/api/comments.test.ts`
- `apps/dashboard/tests/api/github-comment-webhook.test.ts`
- `apps/dashboard/app/components/report-drawer/comments-tab.vue`
- `apps/dashboard/app/composables/use-markdown.ts` — wrapper around the chosen markdown library.
- `packages/shared/src/comments.ts` — `CommentDTO`, `CreateCommentInput`, `UpdateCommentInput`.

### Modified files
- `packages/integrations/github/src/client.ts` — re-export comments adapter.
- `apps/dashboard/server/lib/github-reconcile.ts` — extend to handle `comment_upsert` and `comment_delete` job kinds; add first-link comment backfill.
- `apps/dashboard/server/lib/github-diff.ts` — add `signCommentUpsert(githubCommentId, body)` and `signCommentDelete(githubCommentId)` helpers.
- `apps/dashboard/server/api/integrations/github/webhook.post.ts` — new `issue_comment` event branch (created/edited/deleted), with write-lock echo detection.
- `apps/dashboard/server/db/schema/report-sync-jobs.ts` (or wherever the jobs table lives) — extend the job-kind / payload to carry `{ kind: "comment_upsert", commentId }` / `{ kind: "comment_delete", commentId }`. If the existing jobs table uses a single shape (just `reportId`), extend with a nullable `payload jsonb` column.
- `apps/dashboard/app/components/report-drawer/index.vue` (or wherever the drawer's tab bar is) — add a "Comments" tab.
- `packages/shared/src/index.ts` — export comment DTOs.
- `apps/dashboard/package.json` — add `marked` (or `markdown-it`).

---

## Section A — Adapter

### Task 1: Octokit comment wrappers

**Files:** create `packages/integrations/github/src/comments.ts` + `.test.ts`; append to `client.ts`.

- [ ] **Step 1: Implement**

```ts
import type { Octokit } from "@octokit/rest"

export type GithubComment = {
  id: number
  body: string
  user: { id: number; login: string; avatar_url: string | null }
  createdAt: string
  updatedAt: string
}

export async function createIssueComment(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<GithubComment> {
  const res = await client.rest.issues.createComment({
    owner, repo, issue_number: issueNumber, body,
  })
  const c = res.data
  return {
    id: c.id,
    body: c.body ?? "",
    user: {
      id: c.user?.id ?? 0,
      login: c.user?.login ?? "",
      avatar_url: c.user?.avatar_url ?? null,
    },
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }
}

export async function updateIssueComment(
  client: Octokit,
  owner: string,
  repo: string,
  commentId: number,
  body: string,
): Promise<void> {
  await client.rest.issues.updateComment({
    owner, repo, comment_id: commentId, body,
  })
}

export async function deleteIssueComment(
  client: Octokit,
  owner: string,
  repo: string,
  commentId: number,
): Promise<void> {
  await client.rest.issues.deleteComment({
    owner, repo, comment_id: commentId,
  })
}

export async function listIssueComments(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GithubComment[]> {
  const items: GithubComment[] = []
  const iterator = client.paginate.iterator(client.rest.issues.listComments, {
    owner, repo, issue_number: issueNumber, per_page: 100,
  })
  for await (const { data } of iterator) {
    for (const c of data) {
      items.push({
        id: c.id,
        body: c.body ?? "",
        user: {
          id: c.user?.id ?? 0,
          login: c.user?.login ?? "",
          avatar_url: c.user?.avatar_url ?? null,
        },
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })
    }
  }
  return items
}
```

- [ ] **Step 2: Tests** — use fake Octokit (mock `rest.issues.createComment/updateComment/deleteComment/listComments`). At minimum:
  - `createIssueComment` returns normalized shape
  - `updateIssueComment` passes `comment_id` + `body`
  - `deleteIssueComment` passes `comment_id`
  - `listIssueComments` flattens pagination

- [ ] **Step 3: Append to `client.ts`:**

```ts
export {
  createIssueComment,
  updateIssueComment,
  deleteIssueComment,
  listIssueComments,
} from "./comments"
export type { GithubComment } from "./comments"
```

- [ ] **Step 4: Run tests, commit:**

```bash
git add packages/integrations/github/src/comments.ts \
        packages/integrations/github/src/comments.test.ts \
        packages/integrations/github/src/client.ts
git commit -m "feat(github-adapter): issue-comment wrappers (create/update/delete/list)"
```

---

## Section B — Serializer

### Task 2: Footer serialization

**Files:** create `apps/dashboard/server/lib/comment-serializer.ts` + `.test.ts`.

- [ ] **Step 1: Tests:**

```ts
import { describe, test, expect } from "bun:test"
import { withBotFooter, stripBotFooter, hasBotFooter } from "./comment-serializer"

describe("withBotFooter", () => {
  test("appends a markdown blockquote with the author name", () => {
    const out = withBotFooter("hello", { name: "Jane Doe", githubLogin: null })
    expect(out).toContain("hello")
    expect(out).toMatch(/—\s*\*Jane Doe\*\s+\(via Repro dashboard\)/)
    expect(out.split("\n").some((l) => l.trim().startsWith(">"))).toBe(true)
  })

  test("uses @handle when the author has a linked github identity", () => {
    const out = withBotFooter("hi", { name: "Jane", githubLogin: "jane-gh" })
    expect(out).toContain("@jane-gh")
  })

  test("multi-line body preserves original", () => {
    const out = withBotFooter("line1\n\nline2", { name: "X", githubLogin: null })
    expect(out).toContain("line1\n\nline2")
  })
})

describe("stripBotFooter", () => {
  test("removes a trailing footer produced by withBotFooter", () => {
    const body = withBotFooter("hello", { name: "Jane", githubLogin: null })
    expect(stripBotFooter(body)).toBe("hello")
  })

  test("leaves a body without footer unchanged", () => {
    expect(stripBotFooter("plain body")).toBe("plain body")
  })

  test("does not strip a blockquote that is NOT our footer", () => {
    const body = "first\n\n> a user's own quote"
    expect(stripBotFooter(body)).toBe(body)
  })
})

describe("hasBotFooter", () => {
  test("detects the footer", () => {
    const body = withBotFooter("hello", { name: "J", githubLogin: null })
    expect(hasBotFooter(body)).toBe(true)
  })
  test("returns false without a footer", () => {
    expect(hasBotFooter("hello")).toBe(false)
  })
})
```

- [ ] **Step 2: Implementation:**

```ts
const FOOTER_MARKER = "(via Repro dashboard)"

export type CommentAuthor = { name: string | null; githubLogin: string | null }

export function withBotFooter(body: string, author: CommentAuthor): string {
  const attribution = author.githubLogin
    ? `@${author.githubLogin}`
    : author.name ?? "Repro dashboard user"
  return `${body}\n\n> — *${attribution}* ${FOOTER_MARKER}`
}

export function hasBotFooter(body: string): boolean {
  // Our footer specifically: a trailing blockquote line containing the marker.
  // Match only the last non-empty line.
  const lines = body.trimEnd().split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line === "") continue
    return line.startsWith(">") && line.includes(FOOTER_MARKER)
  }
  return false
}

export function stripBotFooter(body: string): string {
  if (!hasBotFooter(body)) return body
  const lines = body.split("\n")
  // Walk backwards removing trailing blank + the footer line
  let lastContentIdx = lines.length - 1
  while (lastContentIdx >= 0 && lines[lastContentIdx].trim() === "") lastContentIdx--
  if (lastContentIdx < 0) return ""
  // Remove the footer line
  lines.splice(lastContentIdx, 1)
  // Trim trailing blank lines that were separators
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop()
  return lines.join("\n")
}
```

- [ ] **Step 3:** Run + commit:

```bash
git add apps/dashboard/server/lib/comment-serializer.ts \
        apps/dashboard/server/lib/comment-serializer.test.ts
git commit -m "feat(comments): bot-footer serialize/strip/detect helpers"
```

---

## Section C — Signature helpers for comments

### Task 3: Extend `github-diff.ts`

**Files:** modify `apps/dashboard/server/lib/github-diff.ts` + its test.

- [ ] **Step 1: Append signatures**

```ts
export function signCommentUpsert(githubCommentId: number, body: string): string {
  return sha256(`${githubCommentId}:${sha256(body)}`)
}

export function signCommentDelete(githubCommentId: number): string {
  return sha256(String(githubCommentId))
}
```

- [ ] **Step 2: Tests** — verify signatures are stable and differ across inputs.

- [ ] **Step 3: Commit:**

```bash
git add apps/dashboard/server/lib/github-diff.ts \
        apps/dashboard/server/lib/github-diff.test.ts
git commit -m "feat(github-diff): signCommentUpsert + signCommentDelete"
```

---

## Section D — Sync job payload extension

### Task 4: Add `payload jsonb` to `report_sync_jobs` (if not already present)

**Files:** inspect/modify `apps/dashboard/server/db/schema/` for the sync-jobs schema.

- [ ] **Step 1: Read** `apps/dashboard/server/db/schema/github-integrations.ts` or wherever `report_sync_jobs` is defined.

- [ ] **Step 2:** If the table already has a `payload jsonb` column, skip this task. Otherwise add:

```ts
payload: jsonb("payload").$type<SyncJobPayload>(),
```

Where `SyncJobPayload` is a discriminated union:

```ts
export type SyncJobPayload =
  | { kind: "reconcile" }                                    // default, for backward compat (null payload = reconcile)
  | { kind: "comment_upsert"; commentId: string }
  | { kind: "comment_delete"; commentId: string; githubCommentId: number }
```

- [ ] **Step 3:** `bun run db:gen` → inspect + `bun run db:push`.

- [ ] **Step 4: Update `enqueueSync`** and callers — default payload is `null`/`{ kind: "reconcile" }` for existing callers. Add `enqueueCommentSync(reportId, commentId, kind)` helper for comments.

- [ ] **Step 5: Commit:**

```bash
git add apps/dashboard/server/db/schema/ \
        apps/dashboard/server/lib/ \
        apps/dashboard/server/db/migrations/
git commit -m "feat(sync-jobs): carry comment-sync payloads"
```

---

## Section E — Outbound: comment API endpoints

### Task 5: GET list comments

**File:** create `apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/index.get.ts`.

```ts
import { db } from "~/server/db"
import { reportComments } from "~/server/db/schema/report-comments"
import { user } from "~/server/db/schema/auth-schema"
import { userIdentities } from "~/server/db/schema/user-identities"
import { asc, eq, isNull, and } from "drizzle-orm"
import { requireProjectMember } from "~/server/lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) throw createError({ statusCode: 400, statusMessage: "Missing ids" })
  await requireProjectMember(event, projectId)

  const rows = await db
    .select({
      id: reportComments.id,
      body: reportComments.body,
      source: reportComments.source,
      userId: reportComments.userId,
      githubLogin: reportComments.githubLogin,
      githubCommentId: reportComments.githubCommentId,
      createdAt: reportComments.createdAt,
      updatedAt: reportComments.updatedAt,
      deletedAt: reportComments.deletedAt,
      authorName: user.name,
      authorEmail: user.email,
      authorLinkedHandle: userIdentities.externalHandle,
      authorAvatarUrl: userIdentities.externalAvatarUrl,
    })
    .from(reportComments)
    .leftJoin(user, eq(user.id, reportComments.userId))
    .leftJoin(
      userIdentities,
      and(eq(userIdentities.userId, user.id), eq(userIdentities.provider, "github")),
    )
    .where(and(eq(reportComments.reportId, reportId), isNull(reportComments.deletedAt)))
    .orderBy(asc(reportComments.createdAt))

  return { items: rows.map((r) => ({
    id: r.id,
    body: r.body,
    source: r.source,
    githubCommentId: r.githubCommentId,
    author: r.userId
      ? { kind: "dashboard", id: r.userId, name: r.authorName, email: r.authorEmail, githubLogin: r.authorLinkedHandle, avatarUrl: r.authorAvatarUrl }
      : { kind: "github", githubLogin: r.githubLogin, avatarUrl: null },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })) }
})
```

Reuse the exact permissions helper used by other `GET /projects/:id/reports/:reportId/*` routes. Use `requireProjectMember` if that's the pattern; otherwise match whatever's there.

Commit: `feat(api): GET report comments list`

### Task 6: POST create

**File:** create `apps/dashboard/server/api/projects/[id]/reports/[reportId]/comments/index.post.ts`.

```ts
import { db } from "~/server/db"
import { reportComments } from "~/server/db/schema/report-comments"
import { reports } from "~/server/db/schema/reports"
import { githubIntegrations } from "~/server/db/schema/github-integrations"
import { eq } from "drizzle-orm"
import { CreateCommentInput } from "@reprojs/shared"
import { requireProjectRole } from "~/server/lib/permissions"
import { enqueueCommentSync } from "~/server/lib/github-reconcile"
import { getSessionOrThrow } from "~/server/lib/auth"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const reportId = getRouterParam(event, "reportId")
  if (!projectId || !reportId) throw createError({ statusCode: 400, statusMessage: "Missing ids" })

  const session = await getSessionOrThrow(event)
  await requireProjectRole(event, projectId, "manager")

  const body = await readValidatedBody(event, CreateCommentInput.parse)

  const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1)
  if (!report) throw createError({ statusCode: 404, statusMessage: "Report not found" })

  const [inserted] = await db.insert(reportComments).values({
    reportId,
    userId: session.user.id,
    body: body.body,
    source: "dashboard",
  }).returning()

  const [integration] = await db
    .select({ status: githubIntegrations.status })
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)

  if (report.githubIssueNumber !== null && integration?.status === "connected") {
    await enqueueCommentSync(reportId, inserted.id, "upsert")
  }

  return { comment: inserted }
})
```

Commit: `feat(api): POST create report comment`

### Task 7: PATCH + DELETE

**Files:**
- `.../comments/[commentId].patch.ts`
- `.../comments/[commentId].delete.ts`

For PATCH:
- Allow the original author (manager+), or an owner, to edit
- If the comment's `githubCommentId` is set → enqueue `comment_upsert`
- If null (not yet synced) → just update the local row; any pending sync job is updated in place when the reconciler runs

For DELETE (soft):
- Same permission check
- Set `deletedAt = now()`
- If `githubCommentId` is set → enqueue `comment_delete` with the github id
- If null and there's a pending upsert job → delete that job row instead of enqueuing a delete (net zero GitHub calls)

Commit: `feat(api): PATCH + DELETE report comments`

### Task 8: Shared DTOs

**File:** create `packages/shared/src/comments.ts`, export from `packages/shared/src/index.ts`.

```ts
import { z } from "zod"

export const CommentAuthorDTO = z.union([
  z.object({
    kind: z.literal("dashboard"),
    id: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    githubLogin: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("github"),
    githubLogin: z.string(),
    avatarUrl: z.string().nullable(),
  }),
])
export type CommentAuthorDTO = z.infer<typeof CommentAuthorDTO>

export const CommentDTO = z.object({
  id: z.string(),
  body: z.string(),
  source: z.enum(["dashboard", "github"]),
  githubCommentId: z.number().nullable(),
  author: CommentAuthorDTO,
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type CommentDTO = z.infer<typeof CommentDTO>

export const CreateCommentInput = z.object({
  body: z.string().min(1).max(65_536),
})
export type CreateCommentInput = z.infer<typeof CreateCommentInput>

export const UpdateCommentInput = z.object({
  body: z.string().min(1).max(65_536),
})
export type UpdateCommentInput = z.infer<typeof UpdateCommentInput>
```

Export from `packages/shared/src/index.ts`.

Commit: `feat(shared): comment DTOs`

### Task 9: Tests for endpoints

Create `apps/dashboard/tests/api/comments.test.ts`. Cover:
- GET returns empty list for a report with no comments
- POST creates a comment (dashboard source)
- POST on a linked report with connected integration enqueues a `comment_upsert` job
- POST on an unlinked report does NOT enqueue
- PATCH own comment succeeds
- PATCH someone else's comment → 403 for manager role, 200 for owner
- DELETE soft-deletes + if linked, enqueues `comment_delete`
- DELETE on an unsynced comment with pending upsert job deletes the job instead of enqueuing delete

Commit: `test(comments): API endpoint coverage`

---

## Section F — Reconciler + outbound sync

### Task 10: Extend reconciler for comment jobs

**Files:** modify `apps/dashboard/server/lib/github-reconcile.ts`.

Add handlers for the new job payload kinds:

```ts
async function reconcileCommentUpsert(job, client, integration) {
  const [comment] = await db.select().from(reportComments).where(eq(reportComments.id, job.payload.commentId))
  if (!comment || comment.deletedAt) return // orphan or already deleted

  const [author] = comment.userId
    ? await db.select({ name: user.name, handle: userIdentities.externalHandle })
        .from(user)
        .leftJoin(
          userIdentities,
          and(eq(userIdentities.userId, user.id), eq(userIdentities.provider, "github")),
        )
        .where(eq(user.id, comment.userId))
        .limit(1)
    : [{ name: null, handle: null }]

  const serializedBody = withBotFooter(comment.body, { name: author.name, githubLogin: author.handle })

  if (comment.githubCommentId === null) {
    // Create on GitHub
    const [report] = await db.select().from(reports).where(eq(reports.id, comment.reportId)).limit(1)
    if (!report?.githubIssueNumber) return // ticket unlinked between enqueue and run
    const created = await createIssueComment(
      client, integration.repoOwner, integration.repoName,
      report.githubIssueNumber, serializedBody,
    )
    await recordWriteLock(db, {
      reportId: comment.reportId, kind: "comment_upsert",
      signature: signCommentUpsert(created.id, serializedBody),
    })
    await db
      .update(reportComments)
      .set({ githubCommentId: created.id })
      .where(eq(reportComments.id, comment.id))
  } else {
    // Update on GitHub
    await recordWriteLock(db, {
      reportId: comment.reportId, kind: "comment_upsert",
      signature: signCommentUpsert(comment.githubCommentId, serializedBody),
    })
    await updateIssueComment(
      client, integration.repoOwner, integration.repoName,
      comment.githubCommentId, serializedBody,
    )
  }
}

async function reconcileCommentDelete(job, client, integration) {
  const gid = job.payload.githubCommentId
  await recordWriteLock(db, {
    reportId: job.payload.reportId, kind: "comment_delete",
    signature: signCommentDelete(gid),
  })
  await deleteIssueComment(client, integration.repoOwner, integration.repoName, gid)
}
```

The worker's job dispatch (where it calls `reconcileReport`) should now branch on `job.payload?.kind`:

```ts
if (!job.payload || job.payload.kind === "reconcile") {
  await reconcileReport(job.reportId)
} else if (job.payload.kind === "comment_upsert") {
  await reconcileCommentUpsert(job, client, integration)
} else if (job.payload.kind === "comment_delete") {
  await reconcileCommentDelete(job, client, integration)
}
```

Commit: `feat(reconcile): handle comment_upsert and comment_delete job kinds`

### Task 11: Backfill on first link

Extend the create-issue path in `reconcileReport`: after a new issue is created (or a pre-existing one found via `findIssueByMarker`), if `report.githubCommentsSyncedAt IS NULL`, run a backfill:

```ts
if (report.githubCommentsSyncedAt === null) {
  const comments = await listIssueComments(
    client, integration.repoOwner, integration.repoName, issueNumber,
  )
  for (const c of comments) {
    const alreadyHave = await db
      .select({ id: reportComments.id })
      .from(reportComments)
      .where(eq(reportComments.githubCommentId, c.id))
      .limit(1)
    if (alreadyHave.length) continue

    const resolved = await resolveGithubUser(String(c.user.id), c.user.login, c.user.avatar_url)
    const body = hasBotFooter(c.body) ? stripBotFooter(c.body) : c.body
    await db.insert(reportComments).values({
      reportId: report.id,
      userId: resolved.kind === "dashboard-user" ? resolved.userId : null,
      githubLogin: c.user.login,
      body,
      githubCommentId: c.id,
      source: "github",
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
    })
  }
  await db
    .update(reports)
    .set({ githubCommentsSyncedAt: new Date() })
    .where(eq(reports.id, report.id))
}
```

Commit: `feat(reconcile): backfill existing GitHub comments on first link`

---

## Section G — Inbound: webhook

### Task 12: `issue_comment` event branches

**Files:** modify `apps/dashboard/server/api/integrations/github/webhook.post.ts`.

For `issue_comment` event with each of `created`, `edited`, `deleted`:

1. Look up report by `issue.number` + repo.
2. If not found → break.
3. Compute signature and call `consumeWriteLock`; skip if matched.
4. Apply inbound change.

```ts
case "issue_comment": {
  const action = payload.action as string
  const comment = payload.comment
  const issue = payload.issue
  const [report] = await db.select().from(reports)
    .where(and(eq(reports.githubIssueNumber, issue.number), eq(reports.projectId, ...)))
    .limit(1)
  if (!report) break

  if (action === "created" || action === "edited") {
    const sig = signCommentUpsert(comment.id, comment.body ?? "")
    if (await consumeWriteLock(db, { reportId: report.id, kind: "comment_upsert", signature: sig })) break

    const body = hasBotFooter(comment.body) ? stripBotFooter(comment.body) : (comment.body ?? "")
    const resolved = await resolveGithubUser(String(comment.user.id), comment.user.login, comment.user.avatar_url)

    if (action === "created") {
      await db.insert(reportComments).values({
        reportId: report.id,
        userId: resolved.kind === "dashboard-user" ? resolved.userId : null,
        githubLogin: comment.user.login,
        body,
        githubCommentId: comment.id,
        source: "github",
      }).onConflictDoNothing({ target: reportComments.githubCommentId })
      await emitReportEvent(db, {
        reportId: report.id, actorId: null, kind: "comment_added",
        payload: { githubCommentId: comment.id },
      })
    } else { // edited
      await db.update(reportComments)
        .set({ body, updatedAt: new Date() })
        .where(eq(reportComments.githubCommentId, comment.id))
      await emitReportEvent(db, {
        reportId: report.id, actorId: null, kind: "comment_edited",
        payload: { githubCommentId: comment.id },
      })
    }
  }

  if (action === "deleted") {
    const sig = signCommentDelete(comment.id)
    if (await consumeWriteLock(db, { reportId: report.id, kind: "comment_delete", signature: sig })) break
    await db.update(reportComments)
      .set({ deletedAt: new Date() })
      .where(eq(reportComments.githubCommentId, comment.id))
    await emitReportEvent(db, {
      reportId: report.id, actorId: null, kind: "comment_deleted",
      payload: { githubCommentId: comment.id },
    })
  }
  break
}
```

Finding the report by `issue.number` needs a project scope: either the webhook payload carries enough info to locate the project (via `installation.id` + `repository.owner+name` → `github_integrations.projectId` → `reports` with that project + issue number), or extend the lookup. Match the existing pattern from `issues.closed` branch.

Create `apps/dashboard/tests/api/github-comment-webhook.test.ts`:
- `issue_comment.created` inserts a row
- `issue_comment.edited` updates
- `issue_comment.deleted` soft-deletes
- Echo skip: pre-record a write-lock, send the matching webhook, verify no change
- Author resolution: when the inbound author has a `user_identities` row, `userId` is set; when not, only `github_login` is set

Commit: `feat(webhook): issue_comment branches with write-lock echo skip`

---

## Section H — UI

### Task 13: Markdown renderer

**Files:** `apps/dashboard/package.json`, `apps/dashboard/app/composables/use-markdown.ts`.

- [ ] **Step 1:** Add `marked` as a dashboard dependency:

```bash
bun add marked --cwd apps/dashboard
```

(If the repo's root has hoisted deps, use the right workspace flag.)

- [ ] **Step 2: Composable:**

```ts
// apps/dashboard/app/composables/use-markdown.ts
import { marked } from "marked"

export function useMarkdown() {
  // Configure GitHub-flavoured markdown (GFM is marked's default in newer versions)
  marked.setOptions({ gfm: true, breaks: true })

  function render(md: string): string {
    // `marked.parse` returns string in sync mode with async: false
    return marked.parse(md, { async: false }) as string
  }

  return { render }
}
```

Security note: `marked` does NOT sanitize by default. For Phase 3, render only comments authored by authenticated users within the same workspace — the threat model here is similar to any markdown editor where trust is scoped to logged-in members. If a stricter sanitizer is warranted later, wrap with `DOMPurify` — but don't add it now (YAGNI).

Commit: `feat(ui): markdown renderer composable (marked)`

### Task 14: Comments tab

**File:** create `apps/dashboard/app/components/report-drawer/comments-tab.vue`.

Structure:
- Header: "Comments (<count>)" + refresh button
- List (chronological): each row shows avatar + author name/handle + relative time + rendered markdown + edit/delete menu (when `session.user.id === comment.author.id` OR owner)
- Composer at the bottom: textarea with Write/Preview tabs + Submit button
- Polling: `useFetch` with `watch: [pollTick]` and a `setInterval` every 20s when the drawer is open

```vue
<script setup lang="ts">
import type { CommentDTO } from "@reprojs/shared"
import { useMarkdown } from "~/composables/use-markdown"

const props = defineProps<{ reportId: string; projectId: string; canPost: boolean }>()

const pollTick = ref(0)
const { data, refresh } = await useFetch<{ items: CommentDTO[] }>(
  () => `/api/projects/${props.projectId}/reports/${props.reportId}/comments`,
  { default: () => ({ items: [] }), watch: [pollTick] },
)

let interval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  interval = setInterval(() => { pollTick.value++ }, 20_000)
})
onBeforeUnmount(() => {
  if (interval) clearInterval(interval)
})

const { render } = useMarkdown()

const draft = ref("")
const showPreview = ref(false)
const submitting = ref(false)

async function submit() {
  if (!draft.value.trim()) return
  submitting.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/reports/${props.reportId}/comments`, {
      method: "POST",
      body: { body: draft.value },
    })
    draft.value = ""
    showPreview.value = false
    await refresh()
  } finally {
    submitting.value = false
  }
}

async function deleteComment(id: string) {
  await $fetch(`/api/projects/${props.projectId}/reports/${props.reportId}/comments/${id}`, {
    method: "DELETE",
  })
  await refresh()
}

const { data: me } = useFetch<{ user: { id: string } }>("/api/me")

function authorName(c: CommentDTO) {
  if (c.author.kind === "dashboard") return c.author.name ?? c.author.email ?? "?"
  return `@${c.author.githubLogin}`
}
function canEdit(c: CommentDTO): boolean {
  if (c.author.kind === "github") return false
  return me.value?.user.id === c.author.id
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <div v-for="c in data?.items" :key="c.id" class="border rounded-md p-3">
        <div class="flex items-center gap-2 mb-2">
          <UAvatar
            :src="c.author.kind === 'dashboard' ? c.author.avatarUrl ?? undefined : c.author.avatarUrl ?? undefined"
            size="xs"
          />
          <span class="font-medium">{{ authorName(c) }}</span>
          <span class="text-xs text-muted">{{ new Date(c.createdAt).toLocaleString() }}</span>
          <UDropdownMenu v-if="canEdit(c)" :items="[[{ label: 'Delete', onClick: () => deleteComment(c.id) }]]">
            <UButton variant="ghost" size="xs" icon="i-lucide-more-horizontal" />
          </UDropdownMenu>
        </div>
        <div class="prose prose-sm max-w-none" v-html="render(c.body)" />
      </div>
    </div>

    <div v-if="canPost" class="border-t p-3">
      <div class="flex gap-2 mb-2">
        <UButton size="xs" :variant="showPreview ? 'ghost' : 'solid'" @click="showPreview = false">Write</UButton>
        <UButton size="xs" :variant="showPreview ? 'solid' : 'ghost'" @click="showPreview = true">Preview</UButton>
      </div>
      <div v-if="!showPreview">
        <UTextarea v-model="draft" placeholder="Add a comment… (supports markdown)" :rows="4" :disabled="submitting" />
      </div>
      <div v-else class="prose prose-sm max-w-none border rounded-md p-3 min-h-[6rem]" v-html="render(draft || '*Nothing to preview*')" />
      <div class="flex justify-end mt-2">
        <UButton :loading="submitting" :disabled="!draft.trim()" @click="submit">Comment</UButton>
      </div>
    </div>
  </div>
</template>
```

Adapt to whatever Nuxt UI version is in use (e.g. `UDropdownMenu` shape varies). Fallbacks are OK.

Commit: `feat(ui): comments tab with markdown composer + polling`

### Task 15: Wire tab into drawer

**File:** `apps/dashboard/app/components/report-drawer/index.vue` (or wherever the tabs live).

Find the existing tab configuration. Add a "Comments" entry:

```ts
{ label: "Comments", icon: "i-lucide-message-square", slot: "comments" }
```

Render in the slot:
```vue
<template #comments>
  <CommentsTab :report-id="report.id" :project-id="report.projectId" :can-post="canTriage" />
</template>
```

`canTriage` should already be a ref/computed the drawer exposes (role check for manager+). If not, compute it inline.

Commit: `feat(ui): add Comments tab to report drawer`

---

## Section I — End-to-end verification

### Task 16: Full roundtrip test

Create `apps/dashboard/tests/api/github-comment-roundtrip.test.ts`:

1. Seed a linked project + report with `githubIssueNumber=99`, `push_on_edit=true`.
2. Stub Octokit with `createComment` returning `{id: 500, ...}`.
3. POST a dashboard comment.
4. Run `reconcileReport` (or manually dispatch the job).
5. Verify the stub saw `createComment` with body containing the footer.
6. Verify `report_comments.githubCommentId = 500`.
7. Verify a write-lock row exists for `(report, "comment_upsert", signature)`.
8. Simulate the inbound webhook for `issue_comment.created` with `id: 500, body: <with our footer>`.
9. Verify the write-lock is consumed AND no new `report_comments` row is inserted (no duplicate).

### Task 17: Full-suite sanity

```bash
bun test
```

Expect all Phase 0/1/2/3/4 tests green. Fix any regressions before reporting.

`bun run check` — clean on touched files.

Commit fixups if any.

---

## Self-review checklist

- [ ] Adapter `createIssueComment` / `updateIssueComment` / `deleteIssueComment` / `listIssueComments` exist.
- [ ] `withBotFooter` / `stripBotFooter` / `hasBotFooter` correctly roundtrip.
- [ ] `signCommentUpsert` / `signCommentDelete` signatures in `github-diff.ts`.
- [ ] `report_sync_jobs` carries a `payload` JSONB that discriminates `reconcile` / `comment_upsert` / `comment_delete`.
- [ ] GET/POST/PATCH/DELETE comment endpoints work + enqueue sync jobs when linked.
- [ ] Reconciler handles the new job kinds.
- [ ] Reconciler backfills existing comments on first link.
- [ ] Webhook `issue_comment.*` branches insert/update/delete with echo detection.
- [ ] Comments tab shows the thread and posts new comments; Write/Preview tabs; polling 20s.
- [ ] Permissions: `manager+` to post/edit/delete own; `owner` to edit/delete others'.
- [ ] Tests: endpoint coverage + webhook coverage + roundtrip + suite all green.
- [ ] `bun run check` clean on touched files.
