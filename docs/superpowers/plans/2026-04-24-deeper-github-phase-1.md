# Deeper GitHub Integration — Phase 1 (Live Pickers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Flip the triage drawer so label/assignee/milestone selection is driven by the linked GitHub repo instead of free-text — making the dashboard *feel* like GitHub Issues to users of a connected project, without yet pushing any of those edits back to GitHub (Phase 2).

**Architecture:** Four parts. (1) A generic per-repo GitHub cache (`github-cache.ts`) with 5-minute TTL, stale-while-revalidate, single-flight, and webhook-driven invalidation. (2) Three new project-scoped GET endpoints that back the pickers, each going through the cache. (3) Three new Vue picker components (`labels-picker`, `assignees-picker`, `milestone-picker`), mounted conditionally based on whether the project is linked to a repo. (4) Webhook handler branches to invalidate the cache on `label.*`, `milestone.*`, `member.*` events.

**Tech Stack:** Nuxt 4, Nitro, Octokit (via existing `packages/integrations/github`), Drizzle ORM, Vue 3 + Nuxt UI, TanStack Query, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-04-24-deeper-github-integration-design.md` §7 (pickers), §4 (architecture), §14 (error handling).

**Scope kept OUT of Phase 1** (Phase 2+):
- Push-on-edit — PATCH still writes Postgres only; no GitHub write triggered by edits.
- Loop-avoidance write-locks — not used since no push-on-edit.
- Milestone column mutations via the picker — wiring stops at "user can select"; the selection writes to `reports.milestone_number` / `milestone_title` but doesn't push to GitHub.
- Bulk-assign multi-UX — keeps Phase 0's single-select bulk dialog.
- Creating new repo labels via "Recreate in GitHub?" flow — deferred to Phase 2.

**Phase 0 dependency:** This plan assumes Phase 0 has shipped (on feature branch `feat/deeper-github-integration` or merged to main). `report_assignees`, `user_identities`, `reports.milestone_number/title`, and the new `github_integrations` columns must exist.

---

## File structure

### New files
- `apps/dashboard/server/lib/github-cache.ts` — generic keyed cache with TTL, SWR, single-flight, webhook-invalidation hooks.
- `apps/dashboard/server/lib/github-cache.test.ts` — unit tests.
- `apps/dashboard/server/api/projects/[id]/integrations/github/labels.get.ts`
- `apps/dashboard/server/api/projects/[id]/integrations/github/assignable-users.get.ts`
- `apps/dashboard/server/api/projects/[id]/integrations/github/milestones.get.ts`
- `apps/dashboard/tests/api/github-pickers.test.ts`
- `apps/dashboard/app/components/report-drawer/pickers/labels-picker.vue`
- `apps/dashboard/app/components/report-drawer/pickers/assignees-picker.vue`
- `apps/dashboard/app/components/report-drawer/pickers/milestone-picker.vue`
- `packages/integrations/github/src/repo-read.ts` — Octokit wrappers `listRepoLabels`, `listAssignableUsers`, `listMilestones`. Tests beside source.
- `packages/integrations/github/src/repo-read.test.ts`

### Modified files
- `packages/integrations/github/src/client.ts` — export new read functions.
- `apps/dashboard/server/lib/github-repo-cache.ts` — fold existing repo-list cache into the new generic cache (or leave standalone if refactoring creates risk; see Task 2).
- `apps/dashboard/server/api/integrations/github/webhook.post.ts` — add cache-invalidation branches for `label.*`, `milestone.*`, `member.*`, and extend `installation_repositories.*` to invalidate assignees cache too.
- `apps/dashboard/server/lib/github-identities.ts` — add a batched `resolveGithubUsers(externalIds: string[])` helper for the assignees endpoint's `linkedUser` resolution.
- `apps/dashboard/app/components/report-drawer/triage-footer.vue` — switch to live pickers when the project is linked; multi-select for assignees; free-text fallback for unlinked projects.
- `apps/dashboard/app/composables/use-github-integration.ts` (new file) — small composable returning `{ isLinked, repoOwner, repoName, installationId }` for the current project.

---

## Section A — Cache layer

### Task 1: Generic cache primitives

**Files:** create `apps/dashboard/server/lib/github-cache.ts` + `.test.ts`.

- [ ] **Step 1: Write failing tests** (`apps/dashboard/server/lib/github-cache.test.ts`):

```ts
import { describe, test, expect, beforeEach } from "bun:test"
import { GithubRepoCache } from "./github-cache"

describe("GithubRepoCache", () => {
  let cache: GithubRepoCache
  beforeEach(() => {
    cache = new GithubRepoCache({ ttlMs: 50 })
  })

  test("cold miss calls the fetcher and caches the result", async () => {
    let calls = 0
    const result = await cache.get("k1", async () => {
      calls++
      return ["a", "b"]
    })
    expect(result).toEqual(["a", "b"])
    expect(calls).toBe(1)

    const second = await cache.get("k1", async () => {
      calls++
      return ["z"]
    })
    expect(second).toEqual(["a", "b"])
    expect(calls).toBe(1)
  })

  test("single-flight: concurrent misses share one fetch", async () => {
    let calls = 0
    let resolveInner!: (v: string[]) => void
    const inner = new Promise<string[]>((r) => { resolveInner = r })
    const p1 = cache.get("k2", async () => { calls++; return inner })
    const p2 = cache.get("k2", async () => { calls++; return inner })
    resolveInner(["one"])
    expect(await p1).toEqual(["one"])
    expect(await p2).toEqual(["one"])
    expect(calls).toBe(1)
  })

  test("stale-while-revalidate: expired entries return stale synchronously, refresh in background", async () => {
    let version = 1
    const fetcher = async () => [`v${version}`]
    const first = await cache.get("k3", fetcher)
    expect(first).toEqual(["v1"])

    await Bun.sleep(60) // past ttl
    version = 2
    // stale read returns v1 and kicks background refresh
    const stale = await cache.get("k3", fetcher)
    expect(stale).toEqual(["v1"])
    await Bun.sleep(20) // let background refresh land
    const fresh = await cache.get("k3", fetcher)
    expect(fresh).toEqual(["v2"])
  })

  test("invalidate drops the entry", async () => {
    let calls = 0
    await cache.get("k4", async () => { calls++; return ["x"] })
    cache.invalidate("k4")
    await cache.get("k4", async () => { calls++; return ["y"] })
    expect(calls).toBe(2)
  })
})
```

- [ ] **Step 2:** `bun test apps/dashboard/server/lib/github-cache.test.ts` → 4 failing.

- [ ] **Step 3: Implement** (`apps/dashboard/server/lib/github-cache.ts`):

```ts
type Entry<T> = { value: T; fetchedAt: number }

export class GithubRepoCache {
  private ttlMs: number
  private store = new Map<string, Entry<unknown>>()
  private inflight = new Map<string, Promise<unknown>>()

  constructor(opts: { ttlMs?: number } = {}) {
    this.ttlMs = opts.ttlMs ?? 5 * 60 * 1000
  }

  async get<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const entry = this.store.get(key) as Entry<T> | undefined
    const now = Date.now()

    if (entry && now - entry.fetchedAt <= this.ttlMs) {
      return entry.value
    }

    // Stale but present: return stale, refresh in background
    if (entry) {
      this.maybeRefresh(key, fetcher)
      return entry.value
    }

    // Cold miss: single-flight
    const inflight = this.inflight.get(key) as Promise<T> | undefined
    if (inflight) return inflight

    const p = fetcher()
      .then((value) => {
        this.store.set(key, { value, fetchedAt: Date.now() })
        return value
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, p)
    return p
  }

  invalidate(key: string): void {
    this.store.delete(key)
  }

  invalidatePrefix(prefix: string): void {
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k)
    }
  }

  private maybeRefresh<T>(key: string, fetcher: () => Promise<T>): void {
    if (this.inflight.has(key)) return
    const p = fetcher()
      .then((value) => {
        this.store.set(key, { value, fetchedAt: Date.now() })
        return value
      })
      .catch(() => {
        // Swallow: stale data is better than a user-facing error here.
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, p)
  }
}

export const githubCache = new GithubRepoCache()

export function cacheKey(installationId: number, owner: string, name: string, resource: string): string {
  return `${installationId}:${owner}/${name}:${resource}`
}
```

- [ ] **Step 4:** `bun test apps/dashboard/server/lib/github-cache.test.ts` → 4 passing.

- [ ] **Step 5: Commit:**

```bash
git add apps/dashboard/server/lib/github-cache.ts \
        apps/dashboard/server/lib/github-cache.test.ts
git commit -m "feat(github-cache): generic per-repo cache with TTL + SWR + single-flight"
```

### Task 2: Leave existing `github-repo-cache.ts` in place

No code change this task. Reason: the existing `github-repo-cache.ts` caches the *list of repositories accessible to an installation*, which is a slightly different resource than labels/assignees/milestones (scoped per installation, not per repo). Folding it into the new cache is a nice-to-have cleanup but orthogonal to Phase 1. Deferred.

- [ ] **Step 1:** Verify `apps/dashboard/server/lib/github-repo-cache.ts` still works — `bun test apps/dashboard/tests/lib/github-repo-cache.test.ts` (if the test file exists) → passing. If no specific test file, skip.

- [ ] **Step 2:** No commit.

---

## Section B — Adapter functions

### Task 3: `listRepoLabels`, `listAssignableUsers`, `listMilestones`

**Files:** create `packages/integrations/github/src/repo-read.ts` + `.test.ts`; extend `packages/integrations/github/src/client.ts`.

- [ ] **Step 1: Write the adapter** (`packages/integrations/github/src/repo-read.ts`):

```ts
import type { Octokit } from "@octokit/rest"

export type RepoLabel = { name: string; color: string; description: string | null }
export type AssignableUser = {
  githubUserId: string
  login: string
  avatarUrl: string | null
}
export type RepoMilestone = {
  number: number
  title: string
  state: "open" | "closed"
  dueOn: string | null
}

export async function listRepoLabels(
  client: Octokit,
  owner: string,
  repo: string,
): Promise<RepoLabel[]> {
  const items: RepoLabel[] = []
  const iterator = client.paginate.iterator(client.rest.issues.listLabelsForRepo, {
    owner,
    repo,
    per_page: 100,
  })
  for await (const { data } of iterator) {
    for (const l of data) {
      items.push({ name: l.name, color: l.color, description: l.description ?? null })
    }
  }
  return items
}

export async function listAssignableUsers(
  client: Octokit,
  owner: string,
  repo: string,
): Promise<AssignableUser[]> {
  const items: AssignableUser[] = []
  const iterator = client.paginate.iterator(client.rest.issues.listAssignees, {
    owner,
    repo,
    per_page: 100,
  })
  for await (const { data } of iterator) {
    for (const u of data) {
      items.push({
        githubUserId: String(u.id),
        login: u.login,
        avatarUrl: u.avatar_url ?? null,
      })
    }
  }
  return items
}

export async function listMilestones(
  client: Octokit,
  owner: string,
  repo: string,
  state: "open" | "all" = "open",
): Promise<RepoMilestone[]> {
  const items: RepoMilestone[] = []
  const iterator = client.paginate.iterator(client.rest.issues.listMilestones, {
    owner,
    repo,
    state,
    per_page: 100,
  })
  for await (const { data } of iterator) {
    for (const m of data) {
      items.push({
        number: m.number,
        title: m.title,
        state: m.state as "open" | "closed",
        dueOn: m.due_on ?? null,
      })
    }
  }
  return items
}
```

- [ ] **Step 2: Tests** (`packages/integrations/github/src/repo-read.test.ts`):

```ts
import { describe, test, expect } from "bun:test"
import { listRepoLabels, listAssignableUsers, listMilestones } from "./repo-read"

function fakeClient(pages: Array<{ data: unknown[] }>) {
  const iterator = {
    async *[Symbol.asyncIterator]() {
      for (const p of pages) yield p
    },
  }
  return {
    paginate: {
      iterator: () => iterator,
    },
    rest: {
      issues: {
        listLabelsForRepo: () => {},
        listAssignees: () => {},
        listMilestones: () => {},
      },
    },
  } as never
}

describe("listRepoLabels", () => {
  test("flattens paginated labels", async () => {
    const client = fakeClient([
      { data: [{ name: "bug", color: "f00", description: "a bug" }] },
      { data: [{ name: "feat", color: "0f0", description: null }] },
    ])
    const res = await listRepoLabels(client, "o", "r")
    expect(res).toEqual([
      { name: "bug", color: "f00", description: "a bug" },
      { name: "feat", color: "0f0", description: null },
    ])
  })
})

describe("listAssignableUsers", () => {
  test("maps to AssignableUser shape", async () => {
    const client = fakeClient([
      { data: [{ id: 42, login: "octocat", avatar_url: "https://a.png" }] },
    ])
    const res = await listAssignableUsers(client, "o", "r")
    expect(res).toEqual([
      { githubUserId: "42", login: "octocat", avatarUrl: "https://a.png" },
    ])
  })
})

describe("listMilestones", () => {
  test("maps to RepoMilestone shape with null dueOn", async () => {
    const client = fakeClient([
      { data: [{ number: 1, title: "M1", state: "open", due_on: null }] },
    ])
    const res = await listMilestones(client, "o", "r", "open")
    expect(res).toEqual([{ number: 1, title: "M1", state: "open", dueOn: null }])
  })
})
```

- [ ] **Step 3:** `bun test packages/integrations/github/src/repo-read.test.ts` → 3 passing.

- [ ] **Step 4: Export from client.ts**

Append to `packages/integrations/github/src/client.ts`:

```ts
export { listRepoLabels, listAssignableUsers, listMilestones } from "./repo-read"
export type { RepoLabel, AssignableUser, RepoMilestone } from "./repo-read"
```

- [ ] **Step 5: Commit:**

```bash
git add packages/integrations/github/src/repo-read.ts \
        packages/integrations/github/src/repo-read.test.ts \
        packages/integrations/github/src/client.ts
git commit -m "feat(github-adapter): list labels, assignees, milestones"
```

---

## Section C — Picker API endpoints

### Task 4: `GET /api/projects/:id/integrations/github/labels`

**Files:** create `apps/dashboard/server/api/projects/[id]/integrations/github/labels.get.ts`.

- [ ] **Step 1: Write the endpoint:**

```ts
import { listRepoLabels } from "@reprojs/integrations-github"
import { getGithubClient } from "~/server/lib/github"
import { githubIntegrations } from "~/server/db/schema/github-integrations"
import { db } from "~/server/db"
import { eq } from "drizzle-orm"
import { githubCache, cacheKey } from "~/server/lib/github-cache"
import { requireProjectMember } from "~/server/lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "Missing project id" })

  // member+ role check — reuse whatever helper is already in use
  await requireProjectMember(event, projectId)

  const [integration] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)
  if (!integration || integration.status !== "connected" || !integration.repoOwner || !integration.repoName) {
    throw createError({ statusCode: 409, statusMessage: "GitHub integration is not connected" })
  }

  const key = cacheKey(Number(integration.installationId), integration.repoOwner, integration.repoName, "labels")
  const items = await githubCache.get(key, async () => {
    const client = await getGithubClient(integration.installationId)
    return listRepoLabels(client, integration.repoOwner, integration.repoName)
  })

  return { items }
})
```

Verify the package name (`@reprojs/integrations-github` vs whatever the workspace actually uses) and `getGithubClient` signature by reading the existing `apps/dashboard/server/lib/github.ts`. Verify `requireProjectMember` / equivalent exists at `server/lib/permissions.ts` — if not, mirror whatever existing routes use for viewer+ role gating (e.g. `requireProjectRole(event, projectId, "viewer")`).

- [ ] **Step 2: Commit:**

```bash
git add apps/dashboard/server/api/projects/[id]/integrations/github/labels.get.ts
git commit -m "feat(api): GET repo labels for a project"
```

### Task 5: `GET /api/projects/:id/integrations/github/assignable-users`

**Files:** create `apps/dashboard/server/api/projects/[id]/integrations/github/assignable-users.get.ts`.

- [ ] **Step 1: Add batched resolver to `github-identities.ts`**

Append to `apps/dashboard/server/lib/github-identities.ts`:

```ts
export type LinkedUserMini = { id: string; name: string | null; email: string | null }

export async function resolveGithubUsers(
  externalIds: string[],
): Promise<Map<string, LinkedUserMini>> {
  if (externalIds.length === 0) return new Map()
  const rows = await db
    .select({
      externalId: userIdentities.externalId,
      userId: userIdentities.userId,
      name: user.name,
      email: user.email,
    })
    .from(userIdentities)
    .innerJoin(user, eq(user.id, userIdentities.userId))
    .where(and(eq(userIdentities.provider, "github"), inArray(userIdentities.externalId, externalIds)))
  const out = new Map<string, LinkedUserMini>()
  for (const r of rows) {
    out.set(r.externalId, { id: r.userId, name: r.name, email: r.email })
  }
  return out
}
```

Add `inArray` to the drizzle-orm imports and `user` from `../db/schema/auth-schema`.

- [ ] **Step 2: Endpoint:**

```ts
import { listAssignableUsers } from "@reprojs/integrations-github"
import { getGithubClient } from "~/server/lib/github"
import { githubIntegrations } from "~/server/db/schema/github-integrations"
import { db } from "~/server/db"
import { eq } from "drizzle-orm"
import { githubCache, cacheKey } from "~/server/lib/github-cache"
import { requireProjectMember } from "~/server/lib/permissions"
import { resolveGithubUsers } from "~/server/lib/github-identities"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "Missing project id" })
  await requireProjectMember(event, projectId)

  const query = getQuery(event)
  const q = typeof query.q === "string" ? query.q.trim().toLowerCase() : ""

  const [integration] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)
  if (!integration || integration.status !== "connected" || !integration.repoOwner || !integration.repoName) {
    throw createError({ statusCode: 409, statusMessage: "GitHub integration is not connected" })
  }

  const key = cacheKey(Number(integration.installationId), integration.repoOwner, integration.repoName, "assignees")
  const rawItems = await githubCache.get(key, async () => {
    const client = await getGithubClient(integration.installationId)
    return listAssignableUsers(client, integration.repoOwner, integration.repoName)
  })

  const linkedMap = await resolveGithubUsers(rawItems.map((i) => i.githubUserId))

  const items = rawItems
    .map((u) => {
      const linked = linkedMap.get(u.githubUserId) ?? null
      return {
        githubUserId: u.githubUserId,
        login: u.login,
        avatarUrl: u.avatarUrl,
        linkedUser: linked,
      }
    })
    .filter((u) => {
      if (!q) return true
      const loginMatch = u.login.toLowerCase().includes(q)
      const nameMatch = u.linkedUser?.name?.toLowerCase().includes(q) ?? false
      return loginMatch || nameMatch
    })
    .sort((a, b) => {
      // dashboard-linked first, then alphabetical by login
      const aLinked = a.linkedUser ? 0 : 1
      const bLinked = b.linkedUser ? 0 : 1
      if (aLinked !== bLinked) return aLinked - bLinked
      return a.login.localeCompare(b.login)
    })

  return { items }
})
```

- [ ] **Step 3: Commit:**

```bash
git add apps/dashboard/server/lib/github-identities.ts \
        apps/dashboard/server/api/projects/[id]/integrations/github/assignable-users.get.ts
git commit -m "feat(api): GET assignable users with linkedUser resolution"
```

### Task 6: `GET /api/projects/:id/integrations/github/milestones`

**Files:** create `apps/dashboard/server/api/projects/[id]/integrations/github/milestones.get.ts`.

- [ ] **Step 1: Write:**

```ts
import { listMilestones } from "@reprojs/integrations-github"
import { getGithubClient } from "~/server/lib/github"
import { githubIntegrations } from "~/server/db/schema/github-integrations"
import { db } from "~/server/db"
import { eq } from "drizzle-orm"
import { githubCache, cacheKey } from "~/server/lib/github-cache"
import { requireProjectMember } from "~/server/lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "Missing project id" })
  await requireProjectMember(event, projectId)

  const query = getQuery(event)
  const state = query.state === "all" ? "all" : "open"

  const [integration] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)
  if (!integration || integration.status !== "connected" || !integration.repoOwner || !integration.repoName) {
    throw createError({ statusCode: 409, statusMessage: "GitHub integration is not connected" })
  }

  const resource = state === "all" ? "milestones-all" : "milestones-open"
  const key = cacheKey(Number(integration.installationId), integration.repoOwner, integration.repoName, resource)
  const items = await githubCache.get(key, async () => {
    const client = await getGithubClient(integration.installationId)
    return listMilestones(client, integration.repoOwner, integration.repoName, state)
  })

  return { items }
})
```

- [ ] **Step 2: Commit:**

```bash
git add apps/dashboard/server/api/projects/[id]/integrations/github/milestones.get.ts
git commit -m "feat(api): GET repo milestones"
```

### Task 7: Integration tests for the three picker endpoints

**Files:** create `apps/dashboard/tests/api/github-pickers.test.ts`.

- [ ] **Step 1: Write tests**

The existing github-sync test suite at `apps/dashboard/tests/api/github-sync.test.ts` uses `__setClientOverride()` to stub Octokit. Follow the same pattern. Read that file first for the exact override mechanism before writing.

```ts
import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { apiFetch, signIn, truncateDomain, truncateReports, createUser, seedProject } from "../helpers"
import { db } from "../../server/db"
import { githubIntegrations } from "../../server/db/schema/github-integrations"
import { githubApp } from "../../server/db/schema/github-app"
import { projectMembers } from "../../server/db/schema/project-members"
import { userIdentities } from "../../server/db/schema/user-identities"
import { user } from "../../server/db/schema/auth-schema"
import { __setClientOverride } from "../../server/lib/github"
import { githubCache } from "../../server/lib/github-cache"
import { eq } from "drizzle-orm"

async function seedLinkedProject(ownerEmail: string) {
  await truncateDomain()
  await truncateReports()
  await db.delete(githubIntegrations)
  await db.delete(githubApp)
  await db.delete(userIdentities)
  await db.insert(githubApp).values({
    id: 1, appId: "1", slug: "test", privateKey: "x", webhookSecret: "x",
    clientId: "x", clientSecret: "x", htmlUrl: "https://github.com/apps/test",
    createdBy: "test",
  })
  const ownerId = await createUser(ownerEmail, "member")
  const cookie = await signIn(ownerEmail)
  const projectId = await seedProject({
    name: "picker-test",
    publicKey: `pk_${crypto.randomUUID()}`,
    createdBy: ownerId,
  })
  await db.insert(projectMembers).values({ projectId, userId: ownerId, role: "owner" })
  await db.insert(githubIntegrations).values({
    projectId,
    installationId: 12345,
    repoOwner: "acme",
    repoName: "repro",
    status: "connected",
  })
  return { projectId, cookie, ownerId }
}

describe("github picker endpoints", () => {
  beforeEach(() => {
    // clear the in-memory cache between tests
    githubCache.invalidatePrefix("12345:acme/repro")
  })

  afterAll(() => {
    __setClientOverride(null)
  })

  test("GET labels returns repo labels via cache", async () => {
    const { projectId, cookie } = await seedLinkedProject("labels-owner@x.com")
    __setClientOverride({
      paginate: {
        iterator: async function* () {
          yield { data: [{ name: "bug", color: "f00", description: null }] }
        },
      },
      rest: { issues: { listLabelsForRepo: () => {} } },
    } as never)

    const res = await apiFetch<{ items: unknown[] }>(
      `/api/projects/${projectId}/integrations/github/labels`,
      { headers: { cookie } },
    )
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([{ name: "bug", color: "f00", description: null }])
  })

  test("GET assignable-users resolves linkedUser for dashboard accounts", async () => {
    const { projectId, cookie, ownerId } = await seedLinkedProject("au-owner@x.com")
    // The owner will be linked; a second GitHub user is github-only
    await db.insert(userIdentities).values({
      userId: ownerId,
      provider: "github",
      externalId: "100",
      externalHandle: "owner-gh",
    })
    __setClientOverride({
      paginate: {
        iterator: async function* () {
          yield {
            data: [
              { id: 100, login: "owner-gh", avatar_url: "https://a.png" },
              { id: 200, login: "unlinked", avatar_url: null },
            ],
          }
        },
      },
      rest: { issues: { listAssignees: () => {} } },
    } as never)

    const res = await apiFetch<{
      items: Array<{ login: string; linkedUser: { id: string } | null }>
    }>(`/api/projects/${projectId}/integrations/github/assignable-users`, { headers: { cookie } })

    expect(res.status).toBe(200)
    // Dashboard-linked user sorts first
    expect(res.body.items[0].login).toBe("owner-gh")
    expect(res.body.items[0].linkedUser).not.toBeNull()
    expect(res.body.items[1].login).toBe("unlinked")
    expect(res.body.items[1].linkedUser).toBeNull()
  })

  test("GET assignable-users respects q= filter", async () => {
    const { projectId, cookie } = await seedLinkedProject("fil-owner@x.com")
    __setClientOverride({
      paginate: {
        iterator: async function* () {
          yield {
            data: [
              { id: 1, login: "alpha", avatar_url: null },
              { id: 2, login: "beta", avatar_url: null },
              { id: 3, login: "alphabet", avatar_url: null },
            ],
          }
        },
      },
      rest: { issues: { listAssignees: () => {} } },
    } as never)

    const res = await apiFetch<{ items: Array<{ login: string }> }>(
      `/api/projects/${projectId}/integrations/github/assignable-users?q=alph`,
      { headers: { cookie } },
    )
    expect(res.body.items.map((i) => i.login).sort()).toEqual(["alpha", "alphabet"])
  })

  test("GET milestones with state=all returns all", async () => {
    const { projectId, cookie } = await seedLinkedProject("ms-owner@x.com")
    __setClientOverride({
      paginate: {
        iterator: async function* () {
          yield {
            data: [
              { number: 1, title: "M1", state: "open", due_on: null },
              { number: 2, title: "M2", state: "closed", due_on: "2026-06-01T00:00:00Z" },
            ],
          }
        },
      },
      rest: { issues: { listMilestones: () => {} } },
    } as never)

    const res = await apiFetch<{ items: Array<{ state: string }> }>(
      `/api/projects/${projectId}/integrations/github/milestones?state=all`,
      { headers: { cookie } },
    )
    expect(res.status).toBe(200)
    expect(res.body.items.map((i) => i.state)).toEqual(["open", "closed"])
  })

  test("returns 409 when integration is disconnected", async () => {
    const { projectId, cookie } = await seedLinkedProject("off-owner@x.com")
    await db
      .update(githubIntegrations)
      .set({ status: "disconnected" })
      .where(eq(githubIntegrations.projectId, projectId))

    const res = await apiFetch(`/api/projects/${projectId}/integrations/github/labels`, {
      headers: { cookie },
    })
    expect(res.status).toBe(409)
  })
})
```

- [ ] **Step 2:** `bun test apps/dashboard/tests/api/github-pickers.test.ts` → 5 passing.

- [ ] **Step 3: Commit:**

```bash
git add apps/dashboard/tests/api/github-pickers.test.ts
git commit -m "test(api): github picker endpoints"
```

---

## Section D — Webhook cache invalidation

### Task 8: Invalidate cache on `label.*`, `milestone.*`, `member.*` events

**Files:** modify `apps/dashboard/server/api/integrations/github/webhook.post.ts`.

- [ ] **Step 1: Read the current webhook switch.** Locate the event-dispatch block. For each new event type, add a case that invalidates the relevant cache key by prefix.

Add near the top, once:
```ts
import { githubCache } from "~/server/lib/github-cache"
```

Add a helper at the top of the dispatch to compute the repo-scoped prefix:
```ts
function repoPrefix(installationId: number | string, owner: string, name: string): string {
  return `${installationId}:${owner}/${name}:`
}
```

Then extend the `switch (eventType)` or equivalent:

```ts
case "label": {
  // payload: { action: 'created'|'edited'|'deleted', repository: { owner, name }, installation: { id } }
  const { repository, installation } = payload
  if (repository && installation) {
    githubCache.invalidate(`${installation.id}:${repository.owner.login}/${repository.name}:labels`)
  }
  break
}
case "milestone": {
  const { repository, installation } = payload
  if (repository && installation) {
    githubCache.invalidatePrefix(`${installation.id}:${repository.owner.login}/${repository.name}:milestones`)
  }
  break
}
case "member": {
  const { repository, installation } = payload
  if (repository && installation) {
    githubCache.invalidate(`${installation.id}:${repository.owner.login}/${repository.name}:assignees`)
  }
  break
}
```

If the handler doesn't have a generic switch keyed on `eventType`, but instead conditionally branches on `payload.action`, adapt to match whatever shape exists. The key point: **on any label/milestone/member event, invalidate the corresponding cache resource for that repo**.

Extend the existing `installation_repositories` handler (the one already in place): after marking integration disconnected (or whenever repos change), invalidate assignees + labels + milestones for the affected repos.

- [ ] **Step 2: Test** — append to `apps/dashboard/tests/api/github-pickers.test.ts`:

```ts
import { createHmac } from "node:crypto"

test("label webhook invalidates labels cache", async () => {
  const { projectId, cookie } = await seedLinkedProject("inv-owner@x.com")
  const [integration] = await db
    .select()
    .from(githubIntegrations)
    .where(eq(githubIntegrations.projectId, projectId))
    .limit(1)

  // First fetch — populates cache with "initial"
  __setClientOverride({
    paginate: {
      iterator: async function* () {
        yield { data: [{ name: "initial", color: "000", description: null }] }
      },
    },
    rest: { issues: { listLabelsForRepo: () => {} } },
  } as never)
  const first = await apiFetch<{ items: Array<{ name: string }> }>(
    `/api/projects/${projectId}/integrations/github/labels`, { headers: { cookie } },
  )
  expect(first.body.items[0].name).toBe("initial")

  // Send a label webhook that should invalidate
  const body = JSON.stringify({
    action: "created",
    label: { name: "new" },
    repository: { owner: { login: "acme" }, name: "repro" },
    installation: { id: 12345 },
  })
  const sig = "sha256=" + createHmac("sha256", "x").update(body).digest("hex")
  const webhookRes = await apiFetch("/api/integrations/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sig,
      "x-github-event": "label",
      "x-github-delivery": crypto.randomUUID(),
    },
    body,
  })
  expect(webhookRes.status).toBe(202)

  // Next fetch should re-fetch, returning the new data
  __setClientOverride({
    paginate: {
      iterator: async function* () {
        yield { data: [{ name: "after-invalidate", color: "000", description: null }] }
      },
    },
    rest: { issues: { listLabelsForRepo: () => {} } },
  } as never)
  const second = await apiFetch<{ items: Array<{ name: string }> }>(
    `/api/projects/${projectId}/integrations/github/labels`, { headers: { cookie } },
  )
  expect(second.body.items[0].name).toBe("after-invalidate")
})
```

Run: `bun test apps/dashboard/tests/api/github-pickers.test.ts -t "webhook invalidates"` → passing.

- [ ] **Step 3: Commit:**

```bash
git add apps/dashboard/server/api/integrations/github/webhook.post.ts \
        apps/dashboard/tests/api/github-pickers.test.ts
git commit -m "feat(webhook): invalidate picker caches on label/milestone/member events"
```

---

## Section E — Vue picker components

### Task 9: Composable for integration state

**Files:** create `apps/dashboard/app/composables/use-github-integration.ts`.

- [ ] **Step 1: Write:**

```ts
import type { Ref } from "vue"

export type GithubIntegrationState = {
  isLinked: boolean
  repoOwner: string | null
  repoName: string | null
}

export function useGithubIntegration(projectId: Ref<string> | string) {
  const pid = typeof projectId === "string" ? ref(projectId) : projectId
  const { data } = useFetch<{
    config: { repoOwner: string | null; repoName: string | null; status: string } | null
  }>(() => `/api/projects/${pid.value}/integrations/github`, {
    default: () => ({ config: null }),
  })
  const state = computed<GithubIntegrationState>(() => {
    const cfg = data.value?.config
    if (!cfg || cfg.status !== "connected" || !cfg.repoOwner || !cfg.repoName) {
      return { isLinked: false, repoOwner: null, repoName: null }
    }
    return { isLinked: true, repoOwner: cfg.repoOwner, repoName: cfg.repoName }
  })
  return { state }
}
```

> Verify that the existing `GET /api/projects/:id/integrations/github` endpoint returns `{ config: {...} }` (the Phase 0 exploration report noted this endpoint exists). If the response shape differs, adapt.

- [ ] **Step 2: Commit:**

```bash
git add apps/dashboard/app/composables/use-github-integration.ts
git commit -m "feat(ui): composable exposing github integration state per project"
```

### Task 10: Labels picker component

**Files:** create `apps/dashboard/app/components/report-drawer/pickers/labels-picker.vue`.

- [ ] **Step 1: Write:**

```vue
<script setup lang="ts">
type RepoLabel = { name: string; color: string; description: string | null }

const props = defineProps<{
  projectId: string
  modelValue: string[]
  disabled?: boolean
}>()
const emit = defineEmits<{
  "update:modelValue": [value: string[]]
}>()

const { data, pending, error } = useFetch<{ items: RepoLabel[] }>(
  () => `/api/projects/${props.projectId}/integrations/github/labels`,
  { default: () => ({ items: [] }) },
)

const repoLabels = computed(() => (data.value?.items ?? []).filter((l) => !l.name.startsWith("priority:")))

const current = computed({
  get: () => props.modelValue,
  set: (v: string[]) => emit("update:modelValue", v),
})

const orphanLabels = computed(() => {
  const known = new Set(repoLabels.value.map((l) => l.name))
  return current.value.filter((name) => !known.has(name) && !name.startsWith("priority:"))
})

function removeOrphan(name: string) {
  current.value = current.value.filter((n) => n !== name)
}
</script>

<template>
  <div>
    <USelectMenu
      v-model="current"
      :items="repoLabels"
      value-key="name"
      label-key="name"
      multiple
      :loading="pending"
      :disabled="disabled"
      placeholder="Select labels"
    >
      <template #option="{ option }">
        <span
          class="inline-block w-3 h-3 rounded-full mr-2"
          :style="`background: #${option.color}`"
        />
        <span>{{ option.name }}</span>
      </template>
    </USelectMenu>

    <div v-if="orphanLabels.length" class="mt-2 flex flex-wrap gap-1">
      <UChip
        v-for="name in orphanLabels"
        :key="name"
        color="warning"
        variant="soft"
        :title="`${name} is not present in the linked repository's label set`"
        @click="removeOrphan(name)"
      >
        {{ name }} <span class="ml-1 text-xs">not in repo</span>
      </UChip>
    </div>

    <p v-if="error" class="mt-1 text-xs text-muted">
      Couldn't reach GitHub. Your changes will still save.
    </p>
  </div>
</template>
```

- [ ] **Step 2: Commit:**

```bash
git add apps/dashboard/app/components/report-drawer/pickers/labels-picker.vue
git commit -m "feat(ui): labels picker backed by repo label set"
```

### Task 11: Assignees picker component

**Files:** create `apps/dashboard/app/components/report-drawer/pickers/assignees-picker.vue`.

- [ ] **Step 1: Write:**

```vue
<script setup lang="ts">
type AssigneeOption = {
  githubUserId: string
  login: string
  avatarUrl: string | null
  linkedUser: { id: string; name: string | null; email: string | null } | null
}

const props = defineProps<{
  projectId: string
  modelValue: { dashboardUserIds: string[]; githubLogins: string[] }
  disabled?: boolean
}>()
const emit = defineEmits<{
  "update:modelValue": [value: { dashboardUserIds: string[]; githubLogins: string[] }]
}>()

const q = ref("")
const { data, pending } = useFetch<{ items: AssigneeOption[] }>(
  () => `/api/projects/${props.projectId}/integrations/github/assignable-users?q=${encodeURIComponent(q.value)}`,
  { default: () => ({ items: [] }), watch: [q] },
)

// For display, flatten the model into selected ids (either dashboard user id or `gh:login`)
const selectedKeys = computed({
  get: () => [
    ...props.modelValue.dashboardUserIds,
    ...props.modelValue.githubLogins.map((l) => `gh:${l}`),
  ],
  set: (keys: string[]) => {
    if (keys.length > 10) return // silently cap
    const dashboardUserIds: string[] = []
    const githubLogins: string[] = []
    for (const k of keys) {
      if (k.startsWith("gh:")) githubLogins.push(k.slice(3))
      else dashboardUserIds.push(k)
    }
    emit("update:modelValue", { dashboardUserIds, githubLogins })
  },
})

const options = computed(() =>
  (data.value?.items ?? []).map((opt) => ({
    key: opt.linkedUser ? opt.linkedUser.id : `gh:${opt.login}`,
    label: opt.linkedUser?.name ?? opt.login,
    sublabel: opt.linkedUser ? `@${opt.login}` : null,
    avatar: opt.avatarUrl,
    raw: opt,
  })),
)

const debouncedQ = refDebounced(q, 200)
watch(debouncedQ, (v) => {
  q.value = v
})
</script>

<template>
  <USelectMenu
    v-model="selectedKeys"
    :items="options"
    value-key="key"
    label-key="label"
    multiple
    :loading="pending"
    :disabled="disabled"
    placeholder="Select assignees"
    searchable
    @update:query="q = $event"
  >
    <template #option="{ option }">
      <UAvatar :src="option.avatar ?? undefined" size="xs" class="mr-2" />
      <div class="flex-1">
        <div>{{ option.label }}</div>
        <div v-if="option.sublabel" class="text-xs text-muted">{{ option.sublabel }}</div>
      </div>
    </template>
  </USelectMenu>
</template>
```

> `refDebounced` comes from `@vueuse/core`. If that dep isn't already in the dashboard's `package.json`, replace the debounce with a simple `setTimeout` + clear on mount — it's not worth adding a dep for this alone. Verify.

- [ ] **Step 2: Commit:**

```bash
git add apps/dashboard/app/components/report-drawer/pickers/assignees-picker.vue
git commit -m "feat(ui): assignees picker — dashboard-linked and github-only in one list"
```

### Task 12: Milestone picker component

**Files:** create `apps/dashboard/app/components/report-drawer/pickers/milestone-picker.vue`.

- [ ] **Step 1: Write:**

```vue
<script setup lang="ts">
type RepoMilestone = {
  number: number
  title: string
  state: "open" | "closed"
  dueOn: string | null
}

const props = defineProps<{
  projectId: string
  modelValue: { number: number; title: string } | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  "update:modelValue": [value: { number: number; title: string } | null]
}>()

const { data, pending } = useFetch<{ items: RepoMilestone[] }>(
  () => `/api/projects/${props.projectId}/integrations/github/milestones?state=open`,
  { default: () => ({ items: [] }) },
)

const options = computed(() => {
  const opts: Array<{ value: number | null; label: string }> = [{ value: null, label: "No milestone" }]
  for (const m of data.value?.items ?? []) {
    opts.push({ value: m.number, label: m.title })
  }
  // If the current selection is a closed milestone, show it at the end with (closed) marker.
  if (props.modelValue && !opts.find((o) => o.value === props.modelValue!.number)) {
    opts.push({ value: props.modelValue.number, label: `${props.modelValue.title} (closed)` })
  }
  return opts
})

const current = computed({
  get: () => props.modelValue?.number ?? null,
  set: (n: number | null) => {
    if (n === null) {
      emit("update:modelValue", null)
      return
    }
    const item = data.value?.items.find((m) => m.number === n)
    emit("update:modelValue", item ? { number: item.number, title: item.title } : null)
  },
})
</script>

<template>
  <USelect
    v-model="current"
    :items="options"
    value-key="value"
    label-key="label"
    :loading="pending"
    :disabled="disabled"
  />
</template>
```

- [ ] **Step 2: Commit:**

```bash
git add apps/dashboard/app/components/report-drawer/pickers/milestone-picker.vue
git commit -m "feat(ui): milestone picker"
```

---

## Section F — Triage drawer integration

### Task 13: Wire pickers into `triage-footer.vue`

**Files:** modify `apps/dashboard/app/components/report-drawer/triage-footer.vue`.

- [ ] **Step 1: Import pickers + integration composable**

```ts
import LabelsPicker from "./pickers/labels-picker.vue"
import AssigneesPicker from "./pickers/assignees-picker.vue"
import MilestonePicker from "./pickers/milestone-picker.vue"
import { useGithubIntegration } from "~/composables/use-github-integration"
```

- [ ] **Step 2: Expose integration state**

Inside `<script setup>`:
```ts
const projectIdRef = toRef(() => props.report.projectId)
const { state: integrationState } = useGithubIntegration(projectIdRef)
const isLinked = computed(() => integrationState.value.isLinked)
```

- [ ] **Step 3: Replace tag input conditionally**

Find the existing `<!-- Tags -->` block. Wrap in a conditional:

```vue
<template v-if="isLinked">
  <LabelsPicker
    :project-id="report.projectId"
    :model-value="report.tags"
    @update:model-value="emit('patch', { tags: $event })"
  />
</template>
<template v-else>
  <!-- existing free-text tag chip input stays as-is -->
  <!-- ... -->
</template>
```

- [ ] **Step 4: Replace assignee USelectMenu conditionally — flip to multi-select when linked**

Find the existing `<USelectMenu v-model="primaryAssignee" ...>`. Replace with:

```vue
<template v-if="isLinked">
  <AssigneesPicker
    :project-id="report.projectId"
    :model-value="{
      dashboardUserIds: report.assignees.filter((a) => a.id).map((a) => a.id as string),
      githubLogins: report.assignees.filter((a) => !a.id && a.githubLogin).map((a) => a.githubLogin as string),
    }"
    @update:model-value="emit('patch', {
      assigneeIds: $event.dashboardUserIds,
      githubAssigneeLogins: $event.githubLogins,
    })"
  />
</template>
<template v-else>
  <!-- existing single-select USelectMenu for internal members; unchanged -->
</template>
```

**DTO note:** Phase 0 only defined `assigneeIds`. Phase 1 needs `githubAssigneeLogins` added to `TriagePatchInput` in `packages/shared/src/reports.ts`:

```ts
githubAssigneeLogins: z.array(z.string()).optional(),
```

And the triage PATCH handler (`apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts`) must accept that field. For Phase 1 (no push-on-edit), the handler should simply upsert rows into `report_assignees` with `github_login` set instead of `user_id`:

```ts
if (input.githubAssigneeLogins) {
  // Union of dashboard + github logins = new assignee set
  // (keep the dashboard side as Task 24 of Phase 0 implemented)
  // For the github-only side:
  const currentGh = await tx
    .select({ login: reportAssignees.githubLogin })
    .from(reportAssignees)
    .where(and(eq(reportAssignees.reportId, reportId), isNotNull(reportAssignees.githubLogin)))
  const currentLogins = currentGh.map((r) => r.login).filter((x): x is string => !!x)
  const toRemove = currentLogins.filter((l) => !input.githubAssigneeLogins!.includes(l))
  const toAdd = input.githubAssigneeLogins.filter((l) => !currentLogins.includes(l))
  if (toRemove.length) {
    await tx
      .delete(reportAssignees)
      .where(and(eq(reportAssignees.reportId, reportId), inArray(reportAssignees.githubLogin, toRemove)))
  }
  if (toAdd.length) {
    await tx.insert(reportAssignees).values(
      toAdd.map((login) => ({ reportId, githubLogin: login, assignedBy: actorUserId })),
    )
  }
  // Emit assignee_added / assignee_removed events with {githubLogin}
  for (const login of toRemove) {
    await emitReportEvent(tx, { reportId, actorId: actorUserId, kind: "assignee_removed", payload: { githubLogin: login } })
  }
  for (const login of toAdd) {
    await emitReportEvent(tx, { reportId, actorId: actorUserId, kind: "assignee_added", payload: { githubLogin: login } })
  }
}
```

Add `isNotNull` import from `drizzle-orm` where needed.

- [ ] **Step 5: Add Milestone row conditionally**

After the priority row, add:

```vue
<template v-if="isLinked">
  <div class="flex items-center justify-between">
    <span class="text-sm text-muted">Milestone</span>
    <MilestonePicker
      :project-id="report.projectId"
      :model-value="report.milestoneNumber !== null ? { number: report.milestoneNumber, title: report.milestoneTitle ?? '' } : null"
      @update:model-value="emit('patch', { milestone: $event })"
    />
  </div>
</template>
```

**DTO note:** `ReportSummaryDTO` needs `milestoneNumber: number | null` and `milestoneTitle: string | null`. The Phase 0 Section B migration added these DB columns but the DTO wasn't updated — do so now in `packages/shared/src/reports.ts`:

```ts
milestoneNumber: z.number().nullable(),
milestoneTitle: z.string().nullable(),
```

`TriagePatchInput` needs:
```ts
milestone: z.union([z.object({ number: z.number(), title: z.string() }), z.null()]).optional(),
```

PATCH handler: persist to `reports.milestoneNumber` / `reports.milestoneTitle` when the field is present. Emit a `milestone_changed` report-event. Like `githubAssigneeLogins`, no GitHub push yet (Phase 2).

The reports list + detail endpoints need to include `milestoneNumber` and `milestoneTitle` in their DTO projections — extend those queries to `SELECT reports.milestone_number, reports.milestone_title`.

- [ ] **Step 6: Smoke**

With dev server running, open a linked project (if none in dev DB, seed one). Open a ticket drawer. Verify:
- Labels dropdown appears, shows repo labels, saves on change
- Assignees dropdown appears as multi-select, shows linked + github-only users
- Milestone dropdown appears

- [ ] **Step 7: Commit (split into two if convenient)**

```bash
git add apps/dashboard/app/components/report-drawer/triage-footer.vue \
        packages/shared/src/reports.ts \
        apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.patch.ts \
        apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.get.ts \
        apps/dashboard/server/api/projects/[id]/reports/index.get.ts
git commit -m "feat(triage): live pickers for linked projects (labels/assignees/milestone)"
```

---

## Final verification

### Task 14: Full test suite + lint + smoke

- [ ] **Step 1:** `bun test` — expect all Phase 0 + Phase 1 tests passing. Fix any regressions.
- [ ] **Step 2:** `bun run check` — expect clean on touched files.
- [ ] **Step 3:** Grep: no `assigneeId` (camelCase singular) anywhere outside migrations/history. Expected clean.
- [ ] **Step 4:** Manual smoke through the dashboard UI as in Task 13, Step 6.
- [ ] **Step 5:** If any fixups, commit as `chore: fixups from phase-1 verification`.

---

## Self-review checklist

- [ ] `githubCache` primitive exists with TTL, SWR, single-flight, invalidate, invalidatePrefix.
- [ ] `listRepoLabels`, `listAssignableUsers`, `listMilestones` adapter fns exported from `@reprojs/integrations-github`.
- [ ] Three `GET` endpoints return expected shapes, gated by `member+` role, returning 409 when integration disconnected.
- [ ] Webhook invalidates cache on `label.*`, `milestone.*`, `member.*` events.
- [ ] Labels picker replaces tag input for linked projects; tag input persists for unlinked projects.
- [ ] Assignees picker is multi-select, max 10, shows linked users first.
- [ ] Milestone picker appears for linked projects.
- [ ] `TriagePatchInput` carries `assigneeIds`, `githubAssigneeLogins`, `milestone`.
- [ ] `ReportSummaryDTO` carries `milestoneNumber`, `milestoneTitle`.
- [ ] PATCH handler writes github-only assignees to `report_assignees.github_login`; writes milestone to `reports.milestone_*`; emits relevant report-events.
- [ ] No push to GitHub on any of these mutations (Phase 2 territory).
- [ ] All tests passing; `bun run check` clean on touched files.
