# GitHub Issues Sync Design (Sub-project G)

**Status:** design approved by user on 2026-04-18. Ready for plan + implementation.

## 1. Goal

Every report in the dashboard becomes a GitHub issue in a configured repo, and the two stay in sync both directions on status. Dashboard-side triage changes (priority, tags) flow outbound to GitHub labels. Admins work issues in GitHub as they normally would; the dashboard auto-reflects issue-close/reopen events. One-time install, zero per-report friction.

## 2. Scope — locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Sync direction** | Full two-way: dashboard ↔ GitHub status both ways; dashboard → GitHub labels one-way. | Matches CLAUDE.md §3.7 intent; status is the only field both systems model identically. |
| **Auth** | **GitHub App** (replaces the existing OAuth App). One registration serves both user sign-in via better-auth AND repo installation access + webhooks. | Cleanest architecture — avoids two parallel auth stacks; webhook is App-level so admins don't configure repo webhooks manually. |
| **Repo mapping** | One repo per project, set in Project Settings via a dropdown populated by the App's installed repos. | Matches the "one product, one issue tracker" mental model. Multi-repo teams can spin up additional dashboard projects. |
| **Creation trigger** | **Auto-create on every new intake.** Intake returns 201 immediately; issue creation is async via the sync queue. | Dashboard acts as the ingest; GitHub sees every report. Auto-close/reopen in GitHub = end-to-end loop. |
| **Delivery guarantees** | Durable Postgres-backed queue (`report_sync_jobs`) polled every 10s by a Nitro scheduled task. Exponential backoff: 10s → 30s → 2m → 10m → 1h, 5 attempts then `failed`. | Survives dashboard restarts; GitHub outages don't lose data. Avoids introducing Redis/BullMQ. |
| **Inbound scope** | GitHub → dashboard status only. `closed` with reason `completed` → dashboard `resolved`; `closed` with reason `not_planned` → `closed`; `reopened` → `open`. | Status is the only field with shared semantics. Assignee/label sync back introduces user-matching + lossy mapping bombs — deferred. |
| **Outbound scope** | Dashboard → GitHub status + labels. Status maps `open`/`in_progress` → GitHub `open`; `resolved` → `closed`(completed); `closed` → `closed`(not_planned). Labels from default config + `priority:<level>` + raw dashboard tags. | Asymmetric outbound vs inbound is principled: labels are native to GitHub with color/hierarchy; dashboard tags are strictly simpler, so one-way flow is the only lossless direction. |
| **Conflict resolution** | Last-write-wins with echo suppression. Each side's write overrides the other's; if a sync observes the remote already matches desired, no-op. | Idempotent, simple. True races in single-workspace admin usage are rare and self-heal after one more tick. |
| **Issue body content** | Rich markdown: reporter + pageUrl + timestamp + description + inline screenshot via HMAC-signed dashboard URL + deeplink to the dashboard drawer for full context (console/network/cookies/replay). | Self-describing for the 80% engineer workflow; attachments stay in the dashboard blob store (no re-upload to GitHub). |
| **Labels on create** | Fixed per-project defaults (editable comma-separated in settings) + automatic `priority:<level>` + dashboard tag names verbatim. | Default labels cover team conventions (`feedback`, `needs-triage`). Priority/tags enrich over time as dashboard admins triage — label-sync fires on subsequent edits. |
| **Settings UI** | Minimal config (install, repo picker, default labels, default assignees, disconnect) + a Sync Status panel showing failed jobs with error messages and per-job / bulk retry. | Fixed label mapping conventions cover 95% of real configs. Sync Status is load-bearing since auto-create is on — invisible failures are unacceptable. |
| **Webhook configuration** | App-level (auto-configured). Admin doesn't touch repo Webhooks UI. | Only possible because we picked GitHub App in Q2. |
| **Unlink** | Supported via drawer `⋯` menu. Clears `github_*` columns on the report + deletes any pending sync job. GitHub issue is orphaned, not deleted. | Real triage need when a report is merged or filed in the wrong place. |
| **Backfill** | None. Only reports created after the integration is saved auto-sync. Admins can manually file older reports one-at-a-time from the drawer. | Avoids a "40,000 GitHub issues instantly" footgun. |

## 3. Out of scope for v1

- Bidirectional assignee sync (requires GitHub-user ↔ dashboard-user matching).
- Bidirectional label sync (lossy mapping — GitHub labels carry color/description/repo scope).
- Configurable label mapping tables per project (fixed `priority:<level>` + tag-name-verbatim conventions cover real configs).
- Title/body edit mirroring (silent GitHub-side rewrites overwriting dashboard state is user-hostile).
- Issue assignees picked per-report from the dashboard UI at create time.
- Bulk backfill "create issues for all existing reports" action.
- Re-linking a previously-unlinked report to an existing GitHub issue.
- Sync for non-GitHub providers (Linear, Jira, Slack). The adapter interface is provider-agnostic-friendly, but additional providers are separate sub-projects.
- Webhook replay-protection via delivery-id dedup (our handlers are idempotent; add if a replay-driven bug ever surfaces in practice).

## 4. Architecture

### 4.1 Component split

```
packages/integrations/github/            ← pure TS adapter, no Nuxt, no DB
├── src/
│   ├── client.ts                        # createInstallationClient(), GitHubInstallationClient interface
│   ├── signature.ts                     # verifyWebhookSignature() — pure, no network
│   ├── types.ts                         # shared types (GitHubIssueRef, CreateIssueInput, etc.)
│   └── index.ts                         # barrel
└── package.json                         # depends on @octokit/*, @feedback-tool/shared; no dashboard deps

apps/dashboard/
├── server/
│   ├── db/schema/
│   │   ├── reports.ts                   # MODIFY: add github_issue_* columns
│   │   ├── report-events.ts             # MODIFY: add 'github_unlinked' to kind enum
│   │   └── integrations-github.ts       # CREATE: github_integrations + report_sync_jobs
│   ├── lib/
│   │   ├── github.ts                    # CREATE: thin shim (reads env, constructs adapter client)
│   │   └── signed-attachment-url.ts     # CREATE: HMAC signer for screenshot URLs
│   ├── api/
│   │   ├── integrations/github/
│   │   │   ├── webhook.post.ts          # CREATE: HMAC-verified webhook receiver
│   │   │   └── install-callback.get.ts  # CREATE: post-install redirect handler
│   │   └── projects/[id]/
│   │       ├── integrations/github/
│   │       │   ├── index.get.ts         # CREATE: config + status + failed jobs
│   │       │   ├── index.patch.ts       # CREATE: update repo/defaults
│   │       │   ├── install-redirect.post.ts  # CREATE: returns signed install URL
│   │       │   ├── disconnect.post.ts   # CREATE: flip status + clear installation_id
│   │       │   └── retry-failed.post.ts # CREATE: bulk retry
│   │       └── reports/[reportId]/
│   │           ├── attachment.get.ts    # MODIFY: accept signed token as cookie alternative
│   │           ├── github-sync.post.ts  # CREATE: manual enqueue
│   │           └── github-unlink.post.ts # CREATE: clear link + delete pending job
│   └── tasks/
│       └── github-sync.ts               # CREATE: Nitro scheduled task, every 10s
└── app/
    ├── pages/projects/[id]/settings.vue # MODIFY: add "GitHub" tab
    └── components/
        ├── integrations/github/
        │   ├── github-panel.vue         # CREATE: main settings panel (all 4 states)
        │   ├── sync-status.vue          # CREATE: failed-jobs table
        │   └── repo-picker.vue          # CREATE: dropdown with installation repos
        └── report-drawer/
            ├── triage-panel.vue         # MODIFY: add GitHub row (linked/unlinked/failed states)
            └── github-unlink-dialog.vue # CREATE: confirm dialog
```

### 4.2 File responsibilities at a glance

- **Adapter package** (`packages/integrations/github/`): all Octokit usage lives here. Pure functions + a client factory. No environment reads, no DB, no HTTP server. Unit-testable in isolation.
- **`server/lib/github.ts`**: env-var reader + adapter-factory thin shim. Single place where `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET` are loaded. Also owns `createInstallationClientForProject(projectId)` helper that looks up the integration row and constructs a client.
- **`server/tasks/github-sync.ts`**: the worker loop. Owns `reconcileReport(reportId)`. Pure business logic is extracted to a testable function; the task wrapper handles scheduling, batching, and error bookkeeping.
- **`packages/integrations/github/src/signature.ts`**: HMAC-SHA256 signature verification for the inbound webhook. Pure function — no crypto.timingSafeEqual imports leak into the dashboard.

## 5. Data model

### 5.1 `reports` extensions (nullable, additive)

| column | type | notes |
|---|---|---|
| `github_issue_number` | `integer` nullable | set on first successful create |
| `github_issue_node_id` | `text` nullable | GraphQL node ID (future-proof for v4 API) |
| `github_issue_url` | `text` nullable | shown in drawer + inbox badge |

Migration in-place — existing reports keep behaviour.

### 5.2 New table `github_integrations`

One row per project that has GitHub configured. `project_id` is the PK — 1:1.

```
project_id           uuid PRIMARY KEY FK → projects(id) ON DELETE CASCADE
installation_id      bigint NOT NULL
repo_owner           text NOT NULL
repo_name            text NOT NULL
default_labels       text[] NOT NULL DEFAULT '{}'
default_assignees    text[] NOT NULL DEFAULT '{}'
status               text NOT NULL DEFAULT 'connected'
                     CHECK (status IN ('connected', 'disconnected'))
last_error           text
connected_by         text FK → user(id) ON DELETE SET NULL
connected_at         timestamptz NOT NULL DEFAULT now()
updated_at           timestamptz NOT NULL DEFAULT now()
```

During the post-install step where the admin hasn't yet picked a repo, `repo_owner` and `repo_name` are empty strings (client-side blocks save until both are non-empty).

### 5.3 New table `report_sync_jobs`

Durable queue, keyed by `report_id` (natural key — only one in-flight sync per report).

```
report_id         uuid PRIMARY KEY FK → reports(id) ON DELETE CASCADE
state             text NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending', 'syncing', 'failed'))
attempts          int NOT NULL DEFAULT 0
last_error        text
next_attempt_at   timestamptz NOT NULL DEFAULT now()
created_at        timestamptz NOT NULL DEFAULT now()
updated_at        timestamptz NOT NULL DEFAULT now()
```

**Successful syncs delete the row.** No job-kind enum; the worker reconciles against the report's current state and figures out what to do.

### 5.4 Indexes

```sql
-- worker poll query optimization
CREATE INDEX report_sync_jobs_pending_idx
  ON report_sync_jobs (next_attempt_at)
  WHERE state = 'pending';
```

### 5.5 `report_events.kind` enum addendum

Append `github_unlinked` to the existing check constraint. Small migration addendum.

### 5.6 Config schema (env vars, NOT in DB)

- `GITHUB_APP_ID` — numeric App ID from GitHub
- `GITHUB_APP_PRIVATE_KEY` — PEM-encoded RSA private key (multi-line; tolerate both literal newlines and `\n` escapes)
- `GITHUB_APP_WEBHOOK_SECRET` — shared secret configured at App registration
- `ATTACHMENT_URL_SECRET` — separate HMAC secret for signed attachment URLs (rotatable independently)
- `BETTER_AUTH_GITHUB_CLIENT_ID` and `BETTER_AUTH_GITHUB_CLIENT_SECRET` — unchanged env names consumed by better-auth; admins point these at the GitHub App's client credentials (same App, new values from GitHub's App page).

## 6. API

### 6.1 Dashboard server endpoints

| Method + Path | Role | Purpose |
|---|---|---|
| `GET /api/projects/:id/integrations/github` | viewer+ | Current config, status, last-synced timestamp, list of failed sync jobs (up to 50). |
| `POST /api/projects/:id/integrations/github/install-redirect` | owner | Returns `{ url }` — the App's install URL with signed `state` param. |
| `GET /api/integrations/github/install-callback` | owner (derived from `state`) | Verifies `state`, upserts `github_integrations` with the `installation_id`, redirects to the project's settings page in the "pick-a-repo" post-install state. |
| `PATCH /api/projects/:id/integrations/github` | owner | Update `repo_owner` / `repo_name` / `default_labels` / `default_assignees`. |
| `POST /api/projects/:id/integrations/github/disconnect` | owner | Sets `status='disconnected'`, clears `installation_id`. Does not touch GitHub. |
| `POST /api/projects/:id/integrations/github/retry-failed` | developer+ | UPSERT every `state='failed'` job back to `pending` with `next_attempt_at = now()`. |
| `POST /api/integrations/github/webhook` | none (HMAC) | Public. Verifies `X-Hub-Signature-256` before any work. Handles `installation.deleted`, `installation_repositories.removed`, `issues.closed`, `issues.reopened`. |
| `POST /api/projects/:id/reports/:reportId/github-sync` | developer+ | Manually enqueue a sync job (drawer's "Create GitHub issue" button, or retry after failure). Idempotent — UPSERT. |
| `POST /api/projects/:id/reports/:reportId/github-unlink` | developer+ | Clear the report's `github_*` columns, delete any pending sync job, insert a `report_events` row with `kind='github_unlinked'`. Does not touch GitHub. |
| `GET /api/projects/:id/reports/:reportId/attachment?kind=screenshot&token=<hmac>&expires=<ts>` | public via HMAC | Extension to the existing attachment endpoint: accepts a signed token as an alternative to the session cookie. Used by the screenshot URL embedded in the GitHub issue body. |

### 6.2 Adapter interface (`packages/integrations/github/src/client.ts`)

```ts
export interface InstallationClientOptions {
  appId: string
  privateKey: string        // PEM-encoded RSA
  installationId: number
}

export interface GitHubIssueRef {
  number: number
  nodeId: string
  url: string
}

export interface GitHubInstallationClient {
  createIssue(input: {
    owner: string; repo: string
    title: string; body: string
    labels?: string[]; assignees?: string[]
  }): Promise<GitHubIssueRef>

  getIssue(input: {
    owner: string; repo: string; number: number
  }): Promise<{ state: "open" | "closed"; labels: string[] }>

  closeIssue(input: {
    owner: string; repo: string; number: number
    reason?: "completed" | "not_planned"
  }): Promise<void>

  reopenIssue(input: { owner: string; repo: string; number: number }): Promise<void>

  updateIssueLabels(input: {
    owner: string; repo: string; number: number; labels: string[]
  }): Promise<void>

  listInstallationRepositories(): Promise<Array<{
    id: number; owner: string; name: string; fullName: string
  }>>
}

export function createInstallationClient(opts: InstallationClientOptions): GitHubInstallationClient

// Pure — used by webhook handler
export function verifyWebhookSignature(params: {
  secret: string
  payload: string           // raw request body bytes as string
  signatureHeader: string   // value of X-Hub-Signature-256
}): boolean
```

### 6.3 Worker reconcile logic (`server/tasks/github-sync.ts`)

Scheduled every 10s via Nitro scheduled tasks. Per tick:

1. `SELECT * FROM report_sync_jobs WHERE state='pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 10` (uses the partial index from §5.4).
2. For each job:
   - Flip `state='syncing'` in a single-row transaction.
   - Call `reconcileReport(reportId)`.
   - On success: `DELETE FROM report_sync_jobs WHERE report_id = ?`.
   - On error: bump `attempts`, compute backoff, write `last_error`. If `attempts >= 5` → `state='failed'`; else `state='pending'` with new `next_attempt_at`.

`reconcileReport(reportId)` is the idempotent core routine:

```
1. SELECT r.*, gi.* FROM reports r
     LEFT JOIN github_integrations gi ON gi.project_id = r.project_id
     WHERE r.id = ?
2. If no gi OR gi.status != 'connected': delete the job row, return (stale)
3. client = createInstallationClientForProject(gi)
4. desiredLabels = uniqSort([
     ...gi.default_labels,
     `priority:${r.priority}`,
     ...r.tags,
   ])
5. If r.github_issue_number is null:
     ref = client.createIssue({
       owner: gi.repo_owner, repo: gi.repo_name,
       title: r.title, body: buildIssueBody(r),
       labels: desiredLabels,
       assignees: gi.default_assignees,
     })
     UPDATE reports SET
       github_issue_number  = ref.number,
       github_issue_node_id = ref.nodeId,
       github_issue_url     = ref.url
       WHERE id = r.id
     return
6. Else (linked — reconcile state + labels):
     live = client.getIssue({ owner, repo, number: r.github_issue_number })
     desiredState = (r.status IN ('resolved','closed')) ? 'closed' : 'open'
     if live.state != desiredState:
       if desiredState == 'closed':
         reason = r.status == 'resolved' ? 'completed' : 'not_planned'
         client.closeIssue({ owner, repo, number, reason })
       else:
         client.reopenIssue({ owner, repo, number })
     if sortStable(live.labels) != sortStable(desiredLabels):
       client.updateIssueLabels({ owner, repo, number, labels: desiredLabels })
```

**Echo suppression is free**: `live.state == desiredState` → no close/reopen call; likewise for label parity.

### 6.4 Enqueue points

Sync jobs are UPSERTed (insert-or-update existing row, bumping `next_attempt_at=now()` if the job is pending or failed) from:

- **Intake hook** (B's `reports.post.ts`): after successful INSERT, if the project has a `connected` github_integrations row, UPSERT a sync job.
- **Triage hooks** (F's `reports/[reportId]/index.patch.ts` and `bulk-update.post.ts`): after successful mutation, if the report has `github_issue_number` set AND integration is connected, UPSERT a sync job.
- **Manual create button** (`github-sync.post.ts`): always UPSERT, regardless of current state.
- **Webhook handler** (`webhook.post.ts`): if the webhook fires an inbound state change, the DB write is immediate; no sync job needed (the state has already been applied, no outbound needed — echo suppression prevents the worker from round-tripping).

### 6.5 Issue body format

```markdown
> Reported by **reporter@example.com** via Feedback Tool
> Page: https://app.example.com/checkout
> Captured: 2026-04-18 10:42 UTC

## Description

Checkout crashed when I clicked pay.

![Screenshot](https://dashboard.example.com/api/projects/abc/reports/xyz/attachment?kind=screenshot&token=<hmac>&expires=1777968000)

---

<sub>Full context (console, network, cookies, replay): https://dashboard.example.com/projects/abc/reports/xyz</sub>
```

- Reporter line omits the bold name → "anonymous" if the SDK didn't identify a reporter.
- Page line omitted if `pageUrl` is empty.
- Description is the raw report description (no markdown escaping beyond what users type).
- Screenshot `<img>` omitted if the report has no screenshot attachment.
- The signed URL expires after 7 days. GitHub's image proxy caches aggressively, so the issue renders the screenshot even after token expiry for most viewers. Direct URL clicks past expiry → 401.

### 6.6 Webhook handler responsibilities

Request flow:

1. Read raw body BEFORE any JSON parsing (signature is over exact bytes).
2. `verifyWebhookSignature({ secret: env.GITHUB_APP_WEBHOOK_SECRET, payload: rawBody, signatureHeader: req.headers['x-hub-signature-256'] })`. Mismatch → 401, nothing logged beyond a generic "invalid signature" with the delivery ID.
3. Parse JSON; branch on `X-GitHub-Event`:
   - `installation` with `action='deleted'` → `UPDATE github_integrations SET status='disconnected' WHERE installation_id = ?`.
   - `installation_repositories` with `action='removed'` → if `repositories_removed` array contains `{owner, name}` matching a connected integration, flip it to disconnected.
   - `issues` with `action IN ('closed', 'reopened')` → lookup report by `(repo_owner, repo_name, issue.number)`; if missing, no-op; otherwise compute desiredDashboardStatus, echo-suppress (if already at that status, no-op), else UPDATE report + INSERT `report_events` row with `actor_id=NULL` and `kind='status_changed'`.
4. Return 202. DB work happens in-handler (cheap); if it ever gets slow, enqueue a job instead of processing in-line.

## 7. UI

### 7.1 Project Settings → "GitHub" tab

Four visual states:

**Not connected** — headline + single "Install on GitHub" button + informational webhook URL. Click kicks off the App install redirect.

**Post-install, repo not yet chosen** — inline dropdown populated by `client.listInstallationRepositories()`. Save writes `repo_owner/repo_name` via `PATCH`.

**Connected** — shows linked repo (with Change dropdown), "Installed by you on <date>", editable default-labels and default-assignees fields, Save button. Below: Sync Status panel (last-synced timestamp + list of failed jobs with report titles, error messages, per-row Retry and bulk Retry-all buttons). Footer: Disconnect button (confirm dialog).

**Disconnected** — red banner ("The App was uninstalled or access was revoked. Pending reports won't retry until reconnected.") + Reconnect button (reuses install flow).

### 7.2 Report drawer — TriagePanel additions

New row below existing Status / Priority / Assignee / Tags pills:

- **Linked**: `GitHub  #123 · acme-corp/frontend  ↗  [⋯]`. Link opens the issue URL in a new tab. `⋯` menu has "Copy issue URL" + "Unlink from GitHub" (confirm dialog).
- **Unlinked**: `GitHub  [ Create GitHub issue ]`. Click enqueues a manual sync job; button switches to a spinner while the job is `pending` or `syncing`.
- **Failed**: `GitHub  ⚠ Sync failed — "<error>"  [ Retry ]`. Retry re-UPSERTs the job back to `pending`.

### 7.3 Inbox list — GitHub badge column

Small GitHub icon with the issue number when linked:

```
□  🟥 URGENT   Checkout crash on Safari   🐙#123   PJ   2m ago
□  ⬜ normal   Dashboard slow             —        —    1h ago
```

Tooltip shows `acme-corp/frontend#123`. Clicking the badge opens GitHub in a new tab; clicking elsewhere in the row opens the dashboard drawer.

### 7.4 Permissions

- `owner` — install, disconnect, change repo, edit defaults.
- `developer+` — retry failed jobs (per-report or bulk), manual create, unlink.
- `viewer` — read-only access to the settings panel and drawer GitHub row.

Matches F's role semantics.

### 7.5 Unlink confirm dialog

```
Unlink this report from issue #123?

The GitHub issue will stay open in acme-corp/frontend but won't sync with
the dashboard anymore. You can create a new issue afterward.

[ Cancel ]  [ Unlink ]
```

After confirm: `POST /github-unlink`, clears `github_*` columns, deletes pending sync job, inserts a `report_events` row with `kind='github_unlinked'` for audit.

## 8. Testing

### 8.1 Unit tests — `packages/integrations/github/` + `apps/dashboard/tests/lib/`

1. `verifyWebhookSignature` — valid / wrong secret / tampered payload / missing header / malformed header.
2. `buildIssueBody(report)` — full report, anonymous reporter, no screenshot, no pageUrl.
3. `computeBackoff(attempts)` — returns 10s / 30s / 2m / 10m / 1h for attempts 1–5.
4. `signedAttachmentUrl` + `verifyAttachmentToken` — round-trip, expired, tampered, cross-report.
5. `labelsFor(report, integration)` — deterministic sorted output combining defaults + priority + tags.

### 8.2 Integration tests — `apps/dashboard/tests/api/github-sync.test.ts`

All tests use Nuxt `setup({ server: true })` with a mocked `GitHubInstallationClient`. The dashboard's `server/lib/github.ts` exposes a test-only `__setClientOverride(fn)` for injecting a mock.

1. Install callback happy path.
2. Install callback rejects invalid `state` HMAC.
3. Repo picker save (PATCH `repo_owner`/`repo_name`).
4. Disconnect flips status + clears installation_id.
5. Intake enqueues sync job when integration is connected.
6. Intake skips enqueue when no integration row.
7. Worker creates issue on first reconcile; mock records correct call; report columns populated.
8. Worker closes issue when status → resolved.
9. Worker updates labels when priority changes.
10. Worker echo-suppresses when remote already matches desired state.
11. Worker retries + backoff on transient error.
12. Worker permanent-fails after 5 attempts.
13. Retry-failed endpoint UPSERTs all failed jobs to pending.
14. Webhook HMAC pass/fail.
15. Webhook `issues.closed` updates dashboard + inserts `report_events`.
16. Webhook echo-suppresses when dashboard already at target state.
17. Webhook `installation.deleted` flips all matching integrations to disconnected.
18. Manual create idempotent (second POST doesn't duplicate the row).
19. Manual unlink clears columns, deletes pending job, inserts `github_unlinked` event.
20. Viewer 403 on all mutating endpoints.

### 8.3 Regression

- All D (annotation, collectors) tests pass.
- All F (ticket inbox) tests pass.
- Intake's behaviour change is async enqueue only — no 2xx shape change, no new synchronous failure modes.

### 8.4 Manual smoke (done criteria)

Against a real GitHub App + test repo:

1. Install flow — App registration, install on org, callback, save repo. Settings page shows connected.
2. Auto-create — submit a report via the demo SDK. GitHub issue appears within ~15s with screenshot + labels + deeplink.
3. Triage labels — change priority → urgent in the dashboard. GitHub labels update within ~15s.
4. Close in GitHub — close the issue. Dashboard status → resolved within ~15s; Activity tab shows the entry with `actor: System`.
5. Reopen in GitHub — dashboard status returns to open.
6. Close in dashboard — GitHub issue closes within ~15s (reason `not_planned` since F's close ≠ resolve).
7. Disconnect — uninstall App in GitHub UI. Dashboard settings flips to disconnected banner within 30s.
8. Reconnect — reinstall; pending jobs retry automatically.
9. Unlink — drawer `⋯` → Unlink. Issue stays in GitHub, drawer shows Create button; creating gives a fresh issue number.

## 9. Threat model additions

Appended to `docs/superpowers/security/threat-model.md`:

- **App private key** lives only in `GITHUB_APP_PRIVATE_KEY` env. Never logged; never persisted in DB. Missing → install attempts return "GitHub not configured", no half-state.
- **Webhook HMAC verification** via `crypto.timingSafeEqual` on raw request bytes. Rejected 401 before any DB access. Webhook is the only public endpoint besides intake.
- **Install callback `state`** is HMAC-signed `{projectId, userId, createdAt}` with 10-minute expiry. Prevents install-redirect hijacking.
- **Signed attachment URLs** use HMAC-SHA256 over `{projectId, reportId, kind, expiresAt}` with 7-day expiry. Expired/tampered token → 401 without revealing whether the attachment exists. `ATTACHMENT_URL_SECRET` is a distinct env var, rotatable independently.
- **Installation token lifecycle** — requested via App JWT, cached in-process with 5-minute safety margin, refreshed lazily. Never persisted.
- **Mass-enqueue DoS** — bounded by intake's existing rate limits from B. Worker ceiling 60/min is well below GitHub's 5000/hr per-installation.
- **Stale jobs for deleted rows** — FK CASCADEs on `report_id` and `project_id` clean up automatically.
- **GitHub-side label pollution** — dashboard's `updateIssueLabels` is full-replacement. Manual labels in GitHub are overwritten on next triage-driven sync. Documented — admins can add labels to `default_labels` to preserve them.
- **Orphan issues from unlink** — intentional: dashboard explicitly abandons ownership. Not a leak.

## 10. Done criteria

- Schema migration applied; existing reports/events unchanged.
- `packages/integrations/github/` scaffolded, published as a workspace package, adapter + tests in place.
- All ~20 integration tests + ~5 unit tests pass.
- Regression on D and F tests still green.
- Threat model doc appended.
- Full manual smoke walk (9 steps in §8.4) completed against a real GitHub App.
- Tag `v0.6.0-github-sync`. Dashboard bundle impact: negligible (new route + settings tab + drawer additions). SDK bundle unchanged.
