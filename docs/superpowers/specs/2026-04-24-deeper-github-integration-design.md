# Deeper GitHub Integration — Design

**Status:** approved by user, ready for implementation planning
**Date:** 2026-04-24
**Related:**
- Existing spec: `docs/superpowers/specs/2026-04-18-github-sync-design.md` (current v1 integration)
- Existing plan: `docs/superpowers/plans/2026-04-18-github-sync.md`
- Baseline commit for label two-way sync: `89d3d9e` (`feat: Add two way sync for github issue labels`)

---

## 1. Goal

Make the dashboard *feel like the user is managing GitHub Issues directly*. Today the integration supports manual "create issue", two-way status sync, and two-way label sync. That's enough to link a ticket to an issue, but it still feels like a side channel. This design upgrades the experience so that everything a triager normally does in the GitHub Issues UI — pick labels from the repo, pick assignees from the collaborators, set a milestone, read and post comments, see edits land instantly — happens in the dashboard, with the issue staying in lock-step.

Extensible beyond GitHub: the identity layer introduced here is designed so Jira / Linear / etc. slot in later by adding a provider.

## 2. Scope (Approach B — "Issue parity")

**In scope:**
- Live pickers fed by the linked repo: labels (with colours), assignable users (with avatars), milestones.
- User identity mapping: each dashboard user can link a GitHub account. GitHub users with no dashboard account are still visible and assignable.
- Push-on-edit: every dashboard mutation of a synced field (status, priority, tags, assignees, milestone, title) automatically pushes to the linked GitHub issue. No "sync now" button required.
- Expanded webhook surface with loop avoidance via short-lived write-locks.
- Two-way issue comments. Dashboard comments post to the GitHub issue (as the App bot with human attribution footer); GitHub comments mirror back as dashboard comments.
- Auto-create issue on SDK intake (project toggle, opt-in, default off).
- Webhook authenticity hardening (size cap, installation allowlist, replay protection) on top of the existing HMAC-SHA256 signature verification.

**Out of scope (deferred):**
- Issue body sync (body stays as the auto-generated diagnostic block; no human edit on either side).
- Multi-repo per project.
- Notifications (email / push) for comment / assignment events — dashboard has no notification system today; adding one is its own project.
- User OAuth tokens for impersonated comment posting.
- Backfill of existing unlinked reports when auto-create-on-intake is turned on.

## 3. Non-breaking invariants

The design preserves every existing ticket's data, every existing deep link, and every existing workflow. Specifically:
- Every report's assignee is preserved through the single-to-multi migration (data migrated atomically into `report_assignees`).
- Every report's tags are preserved — tags that don't match any repo label simply render as dimmed chips with a "not in repo" hint, rather than being discarded.
- Existing projects have `push_on_edit` defaulted to **off** at migration time, matching today's manual-sync behaviour. New projects default **on**.
- Existing projects have `auto_create_on_intake` defaulted to **off**, matching today's behaviour.
- URL-based filters (`?assignee=...`, `?tags=...`) keep their shape. "Assignee equals X" becomes "X is among the assignees" — a strict superset of today's matches.
- No permission check is tightened.
- Ticket-row rendering (avatar stack up to 3 + `+N`) and bulk-assign dialog's new **Replace / Add / Remove** three-way UX both default to today's behaviour (single avatar / Replace), so users who never touch the new affordances see no change.

## 4. Architecture

Four layers, each with clear boundaries:

1. **Adapter (`packages/integrations/github`)** — pure Octokit wrappers. Existing functions plus:
   - `listRepoLabels`, `listAssignableUsers`, `listMilestones`
   - `createComment`, `updateComment`, `deleteComment`, `listIssueComments`
   - `addAssignees`, `removeAssignees`, `updateIssueMilestone`, `updateIssueTitle`
2. **Server lib (`apps/dashboard/server/lib/github-*`)**:
   - `github.ts` (existing) — installation-client factory.
   - `github-reconcile.ts` (existing, extended) — now reconciles labels + assignees + milestone + title + state in one pass per job.
   - `github-identities.ts` (new) — `resolveGithubUser(externalId, login, avatar)` returning either a dashboard-user or github-only descriptor.
   - `github-cache.ts` (new, extends existing `github-repo-cache.ts`) — generic per-repo keyed cache for labels / assignees / milestones. TTL 5min, stale-while-revalidate, webhook-driven invalidation, single-flight.
   - `github-write-locks.ts` (new) — insert/match/expire signature-based markers for loop avoidance.
3. **API routes** (`apps/dashboard/server/api/**`) — new picker endpoints (§7.3), new comment endpoints (§10.2), new identity endpoints (§6.1-6.2); existing triage PATCH extended to enqueue sync on every synced-field change; existing webhook handler extended with new event branches (§10.3, §9).
4. **UI (`apps/dashboard/app/**`)** — new pickers under `components/report-drawer/pickers/`, new comments tab `components/report-drawer/comments-tab.vue`, new settings page `pages/settings/identities.vue`.

The existing durable job queue (`report_sync_jobs` + the Nitro scheduled task at `apps/dashboard/server/tasks/github/sync.ts`, 10s tick) stays and is fed more often: every qualifying PATCH enqueues a job in the same DB transaction.

## 5. Data model

### 5.1 New tables

#### `user_identities`
Extensible across providers. One row per (user, provider) link.

```
id                  uuid pk
user_id             uuid fk → user(id) on delete cascade
provider            enum('github')                -- extendable
external_id         text                          -- GitHub node ID (stable across renames)
external_handle     text                          -- login, denormalised for display
external_name       text nullable
external_email      text nullable
external_avatar_url text nullable
linked_at           timestamptz
last_verified_at    timestamptz
unique(provider, external_id)
unique(user_id, provider)
```

#### `report_assignees`
Replaces the single `reports.assignee_id` column. 0-N assignees per report (GitHub's cap is 10). Supports both dashboard-user assignees and GitHub-only assignees in the same list.

```
id                uuid pk
report_id         uuid fk → reports(id) on delete cascade
user_id           uuid nullable fk → user(id)
github_login      text nullable
github_user_id    text nullable         -- GitHub node ID, lets us re-resolve after rename
github_avatar_url text nullable
assigned_at       timestamptz
assigned_by       uuid nullable fk → user(id)
check (user_id is not null or github_login is not null)
unique(report_id, user_id)
unique(report_id, github_login)
```

Rendering rule: if `user_id` set → dashboard user (name + email + avatar); else GitHub-only (`@login` + avatar).

#### `report_comments`
Two-way comment store.

```
id                uuid pk
report_id         uuid fk → reports(id) on delete cascade
user_id           uuid nullable fk → user(id)     -- dashboard author, if known
github_login      text nullable                    -- GitHub author, if sourced from github or round-trip
body              text                             -- user-authored markdown, WITHOUT the attribution footer
github_comment_id bigint nullable unique           -- GitHub's numeric comment id; null until synced
source            enum('dashboard','github')
created_at        timestamptz
updated_at        timestamptz
deleted_at        timestamptz nullable             -- soft-delete for audit
```

#### `github_write_locks`
Short-lived (30s TTL) markers for loop avoidance.

```
id          uuid pk
report_id   uuid fk → reports(id) on delete cascade
kind        enum('labels','assignees','milestone','state','title','comment_upsert','comment_delete')
signature   text             -- deterministic hash of expected post-change state
expires_at  timestamptz      -- now() + 30s
index (report_id, kind, expires_at)
```

#### `github_webhook_deliveries`
Replay protection.

```
delivery_id  text pk         -- X-GitHub-Delivery GUID
received_at  timestamptz     -- pruned at 24h by daily cron
```

### 5.2 Column changes

#### `reports`
```
- assignee_id                                -- DROPPED (data migrated to report_assignees)
+ milestone_number          int nullable
+ milestone_title           text nullable    -- denormalised for UI
+ github_synced_at          timestamptz nullable
+ github_comments_synced_at timestamptz nullable
```

The `(project_id, assignee_id)` index is dropped; replaced by `report_assignees (user_id)` and `report_assignees (report_id)` indexes.

#### `github_integrations`
```
+ auto_create_on_intake      boolean default false
+ push_on_edit               boolean default false    -- see §5.4 for the "new rows = true" policy
+ labels_last_synced_at      timestamptz nullable
+ milestones_last_synced_at  timestamptz nullable
+ members_last_synced_at     timestamptz nullable
```

### 5.3 `report_events.kind` enum additions

Add: `assignee_added`, `assignee_removed`, `milestone_changed`, `comment_added`, `comment_edited`, `comment_deleted`, `github_labels_updated`. Existing `assignee_changed` stays in the enum as a historical record (not written by new code but read by older audit entries); `tag_added` / `tag_removed` stay for local tag changes on unlinked tickets.

### 5.4 Migration notes

- Assignee split runs in a single Drizzle migration that creates `report_assignees`, backfills from `reports.assignee_id`, then drops the column + old index in the same transaction.
- `push_on_edit` DDL default is `false`. Pre-existing integration rows stay `false` (preserves today's manual-sync behaviour). The integration-connect API route (for *new* installations) explicitly sets `true` on insert. Net effect: existing connected projects behave exactly as today until an admin flips the switch; new projects are auto-sync from the first connect.

## 6. Identity & linking

### 6.1 Link flow
1. User clicks **Connect GitHub** on `/settings/identities`.
2. `POST /api/me/identities/github/start` returns `{ redirectUrl }`. State is an HMAC-signed blob (secret = `BETTER_AUTH_SECRET`, fields = `{ userId, nonce, expiresAt: now+10min }`).
3. User is redirected to `https://github.com/login/oauth/authorize?client_id=…&state=…&scope=read:user`.
4. GitHub redirects back to `GET /api/me/identities/github/callback?code=…&state=…`. Server verifies state, exchanges `code` for an access token, calls `GET /user`.
5. Upserts `user_identities` (`provider='github'`, `external_id=<node id>`). **Access token is discarded** — all subsequent GitHub API calls go through the App installation.
6. Redirects to `/settings/identities?linked=github`.

### 6.2 Unlink
`DELETE /api/me/identities/github` removes the row. Does **not** cascade-delete anything in `report_assignees`; the denorms on existing rows simply stop being refreshed. Re-linking with the same GitHub account restores full behaviour.

### 6.3 Constraints
- `unique(user_id, provider)` → one GitHub identity per dashboard user.
- `unique(provider, external_id)` → one dashboard user per GitHub identity. Collision → user-facing error *"That GitHub account is already linked to another dashboard user."*

### 6.4 Opportunistic backfill
At migration time, `insert into user_identities (user_id, provider, external_id, external_handle, ...) select ... from account where provider_id='github' on conflict do nothing` — users who signed in with GitHub via better-auth get their identity auto-linked.

### 6.5 Resolution helper
`server/lib/github-identities.ts`:

```ts
type ResolvedIdentity =
  | { kind: "dashboard-user"; userId: string; githubLogin: string; avatarUrl: string | null }
  | { kind: "github-only";    githubLogin: string; githubUserId: string; avatarUrl: string | null }

async function resolveGithubUser(
  githubUserId: string,
  githubLogin: string,
  avatarUrl: string | null,
): Promise<ResolvedIdentity>
```

One indexed lookup on `user_identities`.

### 6.6 User-settings UI
New page `app/pages/settings/identities.vue`. Lists linked providers with status, connect / disconnect buttons, linked handle + avatar. Extensible row-per-provider layout for future Jira / Linear.

## 7. Live pickers

### 7.1 Data sources

| Picker | GitHub API | Filter |
|---|---|---|
| Labels | `GET /repos/:owner/:repo/labels` | hides `priority:*` in the UI (still round-trips) |
| Assignees | `GET /repos/:owner/:repo/assignees` | optional `?q=` prefix filter (login + linkedUser.name) |
| Milestones | `GET /repos/:owner/:repo/milestones?state=open|all` | currently-assigned closed milestone is preserved in selection but absent from options |

### 7.2 Cache layer

`server/lib/github-cache.ts` — generic keyed cache.

```
cacheKey  = `${installationId}:${repoOwner}/${repoName}:${resource}`
resource  ∈ { "labels", "assignees", "milestones-open", "milestones-all", "collaborators" }
value     = { fetchedAt: Date, items: T[] }
TTL       = 5 minutes, stale-while-revalidate on read
```

- In-memory per Nitro worker (matches today's assumption for the repo-list cache).
- Single-flight per cache key (`Map<cacheKey, Promise<T[]>>`) prevents thundering-herd refreshes.
- Webhook-driven invalidation: `label.*` → labels; `milestone.*` → milestones; `member.*` + `installation_repositories.*` → assignees.
- Cold miss blocks for one paginated fetch (~200-400ms). Warm hits are instant; stale hits return cached + trigger background refresh.

### 7.3 API shape

All project-scoped, `member+` role.

```
GET /api/projects/:id/integrations/github/labels
    → { items: Array<{ name, color, description | null }> }

GET /api/projects/:id/integrations/github/assignable-users?q=<optional prefix>
    → { items: Array<{ githubUserId, login, avatarUrl,
                      linkedUser: { id, name, email } | null }> }

GET /api/projects/:id/integrations/github/milestones?state=open|all
    → { items: Array<{ number, title, state, dueOn | null }> }
```

`assignable-users` resolves `linkedUser` in a single batched query on `user_identities`.

### 7.4 UI

Three components under `app/components/report-drawer/pickers/`:
- **`labels-picker.vue`** — multi-select combobox with colour swatches. Tags in the ticket that aren't in the repo's label set render as dimmed chips with a "not in repo" tooltip; clicking one opens a "Recreate in GitHub?" prompt (`developer+` only).
- **`assignees-picker.vue`** — multi-select, max 10. Options: `[...dashboardMembersWithGithubIdentity, ...githubOnlyCollaborators]`, sorted dashboard-first. Rows show avatar + primary label + secondary identifier. `?q=` filter debounced 200ms. Selected assignees render as an avatar stack (up to 3, then `+N`) — consistent across drawer and inbox.
- **`milestone-picker.vue`** — single-select. "No milestone" at top of options.

All three use TanStack Query with 5min staleTime; v-model is the full selection, parent (`triage-footer.vue`) computes diff for PATCH. For projects without a GitHub integration, the drawer falls back to today's free-text components via a `hasGithubIntegration` composable.

## 8. Push-on-edit

### 8.1 Fields that push

| Field | API call |
|---|---|
| `status` | `PATCH /issues/:n { state, state_reason }` |
| `priority` | as `priority:<level>` synthetic label, folded into labels |
| `tags` | `PUT /issues/:n/labels` (full set) |
| `title` | `PATCH /issues/:n { title }` |
| `assignees` | `POST /issues/:n/assignees` + `DELETE /issues/:n/assignees` (diff-based) |
| `milestone` | `PATCH /issues/:n { milestone }` |
| `description` | **not synced** (body stays as auto-generated diagnostic block) |

### 8.2 Enqueue mechanism

The triage PATCH endpoint (and bulk-update) calls `enqueueSync(reportId, projectId)` in the same DB transaction whenever a synced field changes, but only if:
- the project has a connected integration, AND
- the ticket has a linked issue (`reports.github_issue_number` is not null), AND
- `github_integrations.push_on_edit = true`.

Unlinked tickets short-circuit — PATCH still writes Postgres; enqueue is skipped. When a ticket later gets linked, the initial reconcile naturally pushes the current state.

### 8.3 Reconciler extensions

`github-reconcile.ts`:
1. Load ticket + `report_assignees` + the GitHub issue (one `GET /issues/:n`).
2. Compute diffs: title, state, labels (set compare), milestone, assignees added/removed.
3. Before each outbound call, insert a write-lock row (see §8.4).
4. Execute in parallel where independent (title/state/milestone can go in one `PATCH`; labels + assignees each need their own endpoint).
5. On success: set `reports.github_synced_at = now()`, clear `report_sync_jobs.last_error`, delete the job row.
6. On failure: existing backoff schedule (`[10s, 30s, 2m, 10m, 1h]`, max 5 attempts). The whole job retries — reconciliation is idempotent by design.

### 8.4 Loop avoidance via write-locks

Before each outbound call the reconciler inserts a `github_write_locks` row:
- `kind` ∈ `{ labels, assignees, milestone, state, title, comment_upsert, comment_delete }`
- `signature` = deterministic hash of the *expected post-change state*:
  - labels → `sha256(sorted(label_names).join(','))`
  - assignees → `sha256(sorted(github_user_ids).join(','))`
  - milestone → `sha256(milestone_number || 'null')`
  - state → `sha256(state || ':' || state_reason)`
  - title → `sha256(title)`
  - comment_upsert → `sha256(github_comment_id + ':' + sha256(body))`
  - comment_delete → `sha256(github_comment_id)`
- `expires_at` = `now() + 30s`

The webhook handler, for each event it would apply:
1. Compute the signature of the *inbound* post-event state.
2. `SELECT id FROM github_write_locks WHERE report_id=$r AND kind=$k AND signature=$s AND expires_at>now() FOR UPDATE SKIP LOCKED`.
3. If a row matches → delete it, return 202 without applying (this is our own write echoing back).
4. If no match → apply the change normally (a human edited on GitHub).

Why signatures and not timestamps: GitHub webhook delivery can lag by seconds or occasionally minutes. A time window is both too tight and too loose. Signatures let us recognise our exact intended state regardless of when the echo arrives.

### 8.5 Concurrency edge cases

- **Concurrent dashboard edits to the same ticket** → PATCHes serialize via row-lock on `reports.id`. Two near-simultaneous PATCHes each enqueue; second upsert just bumps `next_attempt_at`. Reconciler reads latest state on run — multiple rapid edits collapse into one effective push.
- **Dashboard edit while reconcile in flight** → new PATCH enqueues a fresh job; running reconcile ignores it, finishes, worker picks the fresh job on next tick against latest state.
- **GitHub edit while reconcile in flight** → webhook arrives mid-reconcile. If the GitHub change matches our pending intended state (signature match on existing lock), we skip. Otherwise we apply it. When the in-flight reconcile finishes it writes its own state → last-write-wins race between two humans editing the same field within seconds. Not solved (no vector clocks here); documented as "avoid simultaneous edits on both sides".
- **Reconciler crash mid-write** → lock rows stay until `expires_at`. A webhook arriving within the window gets skipped once (self-healing at next human edit). Not a correctness issue.

### 8.6 Per-project toggle

`github_integrations.push_on_edit` (boolean). Default `true` for new integrations, `false` for integrations that exist at migration time (preserves current manual-sync behaviour). Admin-toggleable (`developer+`).

### 8.7 Observability

Extend the existing failed-jobs UI (`sync-status.vue`): add a "kind" column so ops can see *what* failed, not just "sync failed". Uses existing state + audit infrastructure.

## 9. Webhook authenticity

Existing: HMAC-SHA256 on the raw request body (`X-Hub-Signature-256`), timing-safe compare, 401 on mismatch.

Added, in order (each fails fast before the next):

1. **Size cap** — reject with 413 when `Content-Length > 5 MB`. Cheap first-line defence.
2. **HMAC verification** — existing.
3. **Replay dedupe** — `INSERT INTO github_webhook_deliveries (delivery_id, received_at) VALUES ($1, now()) ON CONFLICT DO NOTHING RETURNING delivery_id`. Nothing returned → replay → 202 no-op. TTL 24h, pruned by the existing daily cron task.
4. **Installation allowlist** — `SELECT 1 FROM github_integrations WHERE installation_id = $1`. No match → 202 with a logged warning. Defends against stolen-secret attacks targeting unknown installations.
5. **Event-type allowlist** — handler's `switch` only dispatches known events; unknown → 202 no-op.

Documented additions in `docs/self-hosting/integrations.md`: rotation procedure, the inherent HTTPS requirement, clarifying we deliberately do not IP-allowlist (too brittle for self-hosters behind LBs).

## 10. Comments two-way

### 10.1 Identity choice

GitHub Apps cannot post as arbitrary users. We choose **bot-posts-with-attribution**: the App posts the comment with a blockquote footer preserving the human author.

```
> Your comment body here.
>
> — *Jane Doe* (via Repro dashboard)
```

If the author has a linked GitHub identity the footer uses `@octocat` so GitHub's own @-mention flow lights up.

Rejected: per-user OAuth tokens (credential-management burden for v1, broader scopes required); per-user GitHub Apps (absurd).

### 10.2 Outbound (dashboard → GitHub)

```
POST   /api/projects/:id/reports/:reportId/comments        create
PATCH  /api/projects/:id/reports/:reportId/comments/:cid   edit
DELETE /api/projects/:id/reports/:reportId/comments/:cid   delete
GET    /api/projects/:id/reports/:reportId/comments        list (paginated)
```

`POST`:
1. `manager+` gate.
2. Insert `report_comments` (`source='dashboard'`, `user_id=me`, `github_comment_id=null`).
3. If linked + integration connected → enqueue a job `{ kind: 'comment_upsert', comment_id }`.
4. Return to caller immediately; UI shows "Posting…" until the sync worker fills `github_comment_id`.

The worker serializes `<body>\n\n— *<author>* (via Repro dashboard)`, calls `POST /repos/:o/:r/issues/:n/comments`, writes back `github_comment_id`, records a `comment_upsert` write-lock.

`PATCH` / `DELETE` behave analogously. If `github_comment_id IS NULL` (not yet synced), the dashboard row is edited / deleted locally and the pending sync job is updated / dropped — no orphan GitHub call.

### 10.3 Inbound (GitHub → dashboard)

**`issue_comment.created`** — auth stack (§9) → resolve `issue.number → report_id` → check `comment_upsert` write-lock (skip if echo) → resolve author via `github-identities.ts` → strip our bot footer if author is our own App (defence in depth) → insert row (`source='github'`, `github_comment_id=<id>`) → emit `comment_added`.

**`issue_comment.edited`** — auth → lookup by `github_comment_id` → `UPDATE body=$new, updated_at=now()` → emit `comment_edited`.

**`issue_comment.deleted`** — auth → `UPDATE deleted_at=now()` → emit `comment_deleted`.

### 10.4 Backfill on first link

When a ticket gets linked (via `findIssueByMarker` reuse or manual link), the reconciler runs a one-shot: `GET /repos/:o/:r/issues/:n/comments?per_page=100` (paginated), inserts any comments not already present by `github_comment_id`. Sets `reports.github_comments_synced_at`. Comments created between backfill and webhook-subscription live in the ≤1-tick gap — catchable via a manual "Refresh comments" button (idempotent).

### 10.5 UI

New tab in the report drawer: `app/components/report-drawer/comments-tab.vue`.

- Chronological, non-threaded list. Each row: author avatar + name/handle + relative time (tooltip = absolute) + rendered markdown + edit/delete menu when author === me.
- Markdown composer with Write / Preview tabs. Uses the existing markdown pipeline to match GitHub's rendering. 65,536 char limit (GitHub's cap).
- Live-ish freshness: poll `GET /comments` every 20s when drawer is open. SSE upgrade is a later improvement.
- "Open on GitHub" link on every comment with a `github_comment_id`.
- Tab label shows live count: `Comments (7)`.

### 10.6 Permissions

- Post / edit / delete *own* comment → `manager+`.
- Edit / delete *others'* comments → `owner` (matches GitHub's maintainer semantics).

### 10.7 Edge cases

- **GitHub offline on post** → comment shows "Posting…", backoff retries; terminal failure surfaces "Failed to sync" with a Retry button. Local row is never silently dropped.
- **Deleted comment with `source='dashboard'`** → tombstoned locally ("deleted on GitHub"), not restorable — matches GitHub's model.
- **Embedded images** → pasted markdown image tags pass through as-is; no image-upload proxying in v1.

## 11. Auto-create on intake

Project-level toggle `github_integrations.auto_create_on_intake` (default `false`).

After `POST /api/intake/reports` commits the report row + attachments, a post-commit hook:

```
if integration.status='connected'
   AND integration.auto_create_on_intake=true
   AND integration.repo_owner/repo_name are set
→ enqueueSync(reportId, projectId)
```

SDK-facing latency unchanged — the intake endpoint returns 202 before the GitHub call.

UI: a single switch on the project's GitHub panel, `developer+` to change, disabled until a repo is selected. Explicit safety: off → on does **not** backfill existing unlinked reports.

## 12. GitHub App permissions

Current: `Issues: write`, `Metadata: read`, `Emails: read`.

Added:
- `Members: read` — required for `listAssignableUsers`.

That's the only new permission. Labels, milestones, and issue comments all live under `Issues: write`.

**Webhook events subscribed** (additions in **bold**):
- `issues` (existing) — now also handles **`assigned`**, **`unassigned`**, **`milestoned`**, **`demilestoned`**, **`edited`**.
- **`issue_comment`** — `created`, `edited`, `deleted`.
- **`label`** — `created`, `edited`, `deleted`.
- **`milestone`** — `created`, `edited`, `closed`, `opened`, `deleted`.
- **`member`** — `added`, `removed`, `edited`.
- `installation` / `installation_repositories` (existing).

Migration for existing installations: GitHub's "review permissions" prompt. Until the admin approves, events requiring the new scope simply don't fire — no crash; pickers fall back to empty / cached state. Env-var-configured installations update permissions via the GitHub App settings page. Documented.

## 13. Permissions matrix

| Action | Who |
|---|---|
| Link / unlink my GitHub identity | any authenticated user, for themselves |
| View pickers (labels / assignees / milestones) | `viewer+` on project |
| PATCH ticket fields (status, priority, tags, assignees, milestone, title) | `manager+` |
| Create a new label in GitHub via "Recreate" prompt | `developer+` |
| Post / edit my own comment | `manager+` |
| Edit / delete others' comments | `owner` |
| Toggle `auto_create_on_intake` | `developer+` |
| Toggle `push_on_edit` | `developer+` |
| Connect / disconnect the integration | `owner` (unchanged) |

Nothing existing is tightened; new actions sit at the lowest reasonable role.

## 14. Error handling

Guiding principle: **GitHub being down or misconfigured never breaks dashboard triage.**

- Picker fetch failure → stale cache if available, else fallback to free-text for this session; subtle banner `"Couldn't reach GitHub. Your changes will still save locally and sync when we reconnect."`
- Push-on-edit sync failure → existing retry schedule; failed-jobs UI surfaces with new "kind" column.
- Webhook auth failure → dropped per §9; logged but no user-facing noise.
- Installation revoked in GitHub → existing `installation.deleted` handler marks integration `disconnected`; pickers hide, push-on-edit no-ops.
- Identity link collision → user-facing error; no silent overwrite.
- Comment terminal sync failure → comment stays as "Failed to sync" with Retry button; never silently deleted.

## 15. Testing

Same discipline as the existing integration — real Postgres, Octokit mocked via `__setClientOverride()`.

**Unit / pure-function** (`*.test.ts` next to source):
- `github-identities.test.ts` — resolution (matched / unmatched / duplicate external id rejection).
- `github-cache.test.ts` — TTL, stale-while-revalidate, single-flight, webhook invalidation per resource kind.
- `github-write-locks.test.ts` — signature formulas for every `kind`; match / skip semantics; expiry.
- `report-comments.test.ts` — footer serialization on outbound; footer stripping on inbound when author is our own App.

**Integration** (`apps/dashboard/tests/api/**`):
- `github-pickers.test.ts` — each picker endpoint shape; `priority:*` filter; `linkedUser` resolution.
- `github-push-on-edit.test.ts` — PATCH → job enqueued → reconciler pushes → write-lock recorded → simulated webhook echo skipped. Every synced field + a mixed-diff case.
- `github-webhook-expanded.test.ts` — fixture payloads for every new event. DB end-state + write-lock interaction assertions.
- `github-webhook-auth.test.ts` — oversized body → 413; bad signature → 401; replay → 202 no-op no side effects; unknown installation → 202 no-op logged.
- `github-comments.test.ts` — post → row + job → Octokit call with footer → `github_comment_id` backfill. Edit / delete. Inbound comment resolves to correct identity. First-link backfill reads existing thread.
- `github-autocreate.test.ts` — toggle on + SDK intake → enqueue; toggle off → no enqueue; flip off → on → no backfill.
- `github-identities-api.test.ts` — OAuth state sign / verify; callback upsert; unlink; collision error.

**Migration tests**:
- `migrations/assignee-split.test.ts` — seed with `assignee_id`, run migration, assert every assignee in `report_assignees`, column dropped, new-shape queries match old-shape results.

Existing `github-helpers.test.ts` label-round-trip stays valid; `github-sync.test.ts` reconciler tests extend naturally.

## 16. Rollout

Phased for risk-first delivery, each phase green-deployable alone:

1. **Phase 0 — Backbone.** Migrations (new tables, assignee split, column additions, write-locks, webhook-deliveries). Identity API + settings page. Opportunistic backfill from `account` table. Webhook authenticity hardening (§9) — strictly additive, ships immediately. **Nothing new is user-visible beyond `/settings/identities`.**
2. **Phase 1 — Read-only pickers.** Cache layer, 3 GET endpoints, 3 picker components wired into the drawer only when the project is GitHub-linked. PATCH behaviour unchanged.
3. **Phase 2 — Push-on-edit + webhook expansion.** Reconciler extended, write-locks active, new webhook branches (assignees / milestones / labels / title / member events). `push_on_edit=false` for pre-existing integrations, `true` for new.
4. **Phase 3 — Comments two-way.** New tab, new API, new webhook branches, backfill on first link.
5. **Phase 4 — Auto-create on intake.** Toggle shipped off; admin opts in per project.

## 17. Documentation updates

- `docs/self-hosting/integrations.md` — updated Permissions table, rotation procedure, `auto_create_on_intake` and `push_on_edit` toggle explanations, clarified "no IP allowlist" stance.
- `docs/guide/triaging-github-linked-tickets.md` (new) — user-facing walkthrough of the dashboard-as-GitHub-Issues experience.

## 18. Open items (resolve during planning)

- Whether there is an existing SSE channel for `report_events` that the comments tab should subscribe to instead of polling (to be verified during plan step; polling is the default fallback).
- Exact markdown renderer used in the dashboard today for the diagnostic block — the comments tab should reuse it (to be verified).
- Bulk-assign dialog's new UX (Replace / Add / Remove three-way, per §3) — to be wireframed during Phase 2 implementation.
