# SDK Core + Minimal Reporter — Design

**Sub-project:** B (second slice of the feedback-tool platform)
**Status:** Design approved, awaiting spec review
**Date:** 2026-04-17
**Depends on:** `v0.1.0-skeleton` (sub-project A)

## 1. Purpose & Scope

Sub-project B delivers the smallest end-to-end SDK slice that proves the feedback-tool's core value proposition: a host site embeds a lightweight widget, an end user reports a bug in one click, and the report (text + screenshot + page context + optional reporter identity) lands in the dashboard where project members can list and inspect it.

**In scope:**
- Framework-agnostic SDK (`packages/core`) with `init`, `open`, `close`, `identify`.
- Shadow-DOM widget (`packages/ui`) using Preact: floating launcher + reporter form.
- Viewport screenshot capture via `modern-screenshot`.
- Automatic page context (URL, user agent, viewport, timestamp) + optional reporter identity.
- Dual-emit build: IIFE (`window.FeedbackTool`) + ESM (`import { init }`).
- Demo playground at `packages/ui/demo/` served on `:4000` via `Bun.serve`.
- Dashboard additions: `reports` + `report_attachments` tables; `projects.public_key` + `allowed_origins`; public `POST /api/intake/reports` endpoint; project-scoped `GET /api/projects/:id/reports` list + attachment streaming; new `/projects/:id/reports` page with table + drawer.
- Local filesystem storage adapter behind a `StorageAdapter` interface; S3 adapter stub.
- CORS, rate limiting, payload size cap, origin allowlist on intake.

**Out of scope (deferred to later sub-projects):**
- Annotation canvas (C).
- Console / network / cookie collectors (D).
- 30-second session replay (E).
- Triage inbox — filters, status transitions, assignees, comments (F).
- GitHub Issues sync (G).
- WordPress / Drupal plugin wrappers (post-v1 distribution work).
- S3 storage implementation (adapter stub only).
- `data-project-key` auto-init sugar.
- Theming, i18n, onReport/onError hooks.

## 2. Decisions (from brainstorming)

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | B delivers SDK + intake + minimal dashboard viewer | Closes the loop so the SDK can be validated without DB inspection |
| 2 | Dual IIFE + ESM build via tsdown | One codebase serves script-tag and npm users |
| 3 | Per-project `public_key` (`ft_pk_` + 24 base62) + `allowed_origins[]` | Simplest model that supports self-host; keys are public by design, plaintext at rest |
| 4 | `modern-screenshot`, viewport-only default | ~12 kB gzipped, no permission prompt, keeps bundle under 50 kB |
| 5 | Intake uses `multipart/form-data`; screenshots land on the local filesystem behind a `StorageAdapter` | Avoids base64 overhead and Postgres bytea bloat; adapter abstraction makes S3 a later drop-in |
| 6 | Report carries text + screenshot + auto page context + optional `identify()` reporter | Useful reports without blocking on collectors (D); `context` is JSONB so D/E can extend without migrations |
| 7 | Origin-allowlist-gated CORS + per-key (60/min) + per-IP (20/min) rate limit + 5 MB payload cap | Blocks cross-origin spam; rate limits are in-memory (single-instance self-host) |
| 8 | Dashboard viewer at `/projects/:id/reports` with table + side drawer | Clean home for list; detail drawer keeps users in context; evolves into F's triage inbox |
| 9 | Demo playground: plain HTML served by `Bun.serve` on `:4000` | Honest framework-agnostic smoke test, zero framework overhead |

## 3. Repository Layout

New directories marked ★. Existing directories from sub-project A are unchanged unless a file is listed.

```
feedback-tool/
├── apps/
│   └── dashboard/
│       ├── app/
│       │   └── pages/projects/[id]/
│       │       └── reports.vue                       ★
│       └── server/
│           ├── api/
│           │   ├── intake/
│           │   │   └── reports.post.ts               ★
│           │   └── projects/[id]/reports/
│           │       ├── index.get.ts                  ★
│           │       └── [reportId]/attachment.get.ts  ★
│           ├── db/
│           │   ├── migrations/0001_reports.sql       ★
│           │   └── schema/
│           │       ├── projects.ts                   (extended)
│           │       └── reports.ts                    ★
│           └── lib/
│               ├── intake-cors.ts                    ★
│               ├── rate-limit.ts                     ★
│               └── storage/
│                   ├── index.ts                      ★ (factory + interface)
│                   ├── local-disk.ts                 ★
│                   └── s3.ts                         ★ (stub)
├── packages/
│   ├── shared/src/
│   │   └── reports.ts                                ★
│   ├── core/                                         ★
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── config.ts
│   │   │   ├── context.ts
│   │   │   ├── screenshot.ts
│   │   │   ├── intake-client.ts
│   │   │   └── context.test.ts
│   │   ├── tsdown.config.ts
│   │   └── package.json
│   └── ui/                                           ★
│       ├── src/
│       │   ├── index.ts
│       │   ├── mount.ts
│       │   ├── shadow.ts
│       │   ├── launcher.tsx
│       │   ├── reporter.tsx
│       │   └── styles.css
│       ├── demo/
│       │   ├── index.html
│       │   └── serve.ts
│       ├── tsdown.config.ts
│       └── package.json
└── docs/superpowers/specs/
    └── 2026-04-17-sdk-core-reporter-design.md        ★ (this file)
```

## 4. Data Model

### 4.1 Additions to `projects`

| Column | Type | Constraints |
| --- | --- | --- |
| `public_key` | `text` | not null, unique; format `ft_pk_` + 24 base62 chars |
| `allowed_origins` | `text[]` | not null default `'{}'::text[]` |
| `public_key_regenerated_at` | `timestamptz` | not null default `now()` |

Unique B-tree index `projects_public_key_idx` on `public_key`. Existing rows are backfilled with random keys in the migration.

### 4.2 `reports`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | pk, default `gen_random_uuid()` |
| `project_id` | `uuid` | not null, FK → `projects.id` on delete cascade |
| `title` | `text` | not null, 1–120 chars (enforced in Zod) |
| `description` | `text` | nullable |
| `context` | `jsonb` | not null default `'{}'::jsonb` |
| `origin` | `text` | the `Origin` header we accepted |
| `ip` | `text` | client IP |
| `created_at` | `timestamptz` | not null default `now()` |

Index `reports_project_created_idx` on `(project_id, created_at DESC)` for paginated list queries.

### 4.3 `report_attachments`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | pk, default `gen_random_uuid()` |
| `report_id` | `uuid` | not null, FK → `reports.id` on delete cascade |
| `kind` | `text` | not null; check constraint `kind IN ('screenshot', 'annotated-screenshot', 'replay', 'logs')` |
| `storage_key` | `text` | not null; adapter-agnostic |
| `content_type` | `text` | not null, e.g. `image/png` |
| `size_bytes` | `integer` | not null |
| `created_at` | `timestamptz` | not null default `now()` |

Index `report_attachments_report_idx` on `report_id`.

### 4.4 `context` JSONB shape (enforced by Zod at the API layer, not at the DB)

```ts
{
  pageUrl: string,
  userAgent: string,
  viewport: { w: number, h: number },
  timestamp: string,                     // ISO-8601 from the client
  reporter?: { userId?: string, email?: string, name?: string },
  metadata?: Record<string, string | number | boolean>
}
```

### 4.5 Invariants (app-enforced)

- Every `report` in v1 has exactly one `report_attachments` row with `kind = 'screenshot'`, written in the same transaction as the report insert, unless the SDK explicitly sent the report without a screenshot (capture failure). In that case, no attachment row exists.
- Deleting a project cascades to reports and attachments. Storage blobs are *not* deleted synchronously; v1 accepts orphaned files (single-tenant self-host; a cleanup job can ship later).
- `context.reporter.email` has no FK relationship to the dashboard's `user` table — it identifies the reporter on the *host* site, not a dashboard account.

## 5. SDK Public API

All APIs are exported from `packages/core` as named exports *and* attached to `window.FeedbackTool` by the IIFE build.

```ts
interface InitOptions {
  projectKey: string                                          // required
  endpoint: string                                            // required; dashboard base URL
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left"  // default "bottom-right"
  launcher?: boolean                                          // default true
  metadata?: Record<string, string | number | boolean>
}

interface Reporter {
  userId?: string
  email?: string
  name?: string
}

function init(options: InitOptions): void                     // idempotent; second call replaces config
function open(): void
function close(): void
function identify(reporter: Reporter | null): void            // null clears
```

Usage examples are in §3 of the architecture presentation; repeated verbatim in the README shipped with the package.

## 6. SDK Internals

### 6.1 Config resolution (`packages/core/src/config.ts`)

`init()` validates options and stores a resolved `Config` in a module-level variable. Throws synchronously on missing `projectKey` or malformed `endpoint` (must be a valid URL). The first `init()` call triggers the widget mount; subsequent calls unmount the existing widget and remount with new config.

### 6.2 Widget mount (`packages/ui/src/shadow.ts`, `mount.ts`)

On first `init()`:

1. Create host div: `<div id="feedback-tool-host">`. Append to `document.body`.
2. Attach closed Shadow DOM: `host.attachShadow({ mode: "closed" })`.
3. Inject bundled CSS string (imported at build time via tsdown CSS-as-string plugin) into a `<style>` element inside the shadow root.
4. Render Preact `<Launcher />` into the shadow root.

The launcher owns an `isOpen` state; when true, it renders `<Reporter />` as an overlay inside the same shadow root.

### 6.3 Screenshot capture (`packages/core/src/screenshot.ts`)

```ts
export async function capture(): Promise<Blob | null> {
  const host = document.getElementById("feedback-tool-host")
  const prevDisplay = host?.style.display
  if (host) host.style.display = "none"                       // hide widget from its own screenshot
  try {
    const { domToBlob } = await import("modern-screenshot")
    return await domToBlob(document.documentElement, {
      scale: window.devicePixelRatio,
      width: window.innerWidth,
      height: window.innerHeight,
    })
  } catch (err) {
    console.warn("[feedback-tool] screenshot capture failed:", err)
    return null
  } finally {
    if (host) host.style.display = prevDisplay ?? ""
  }
}
```

If `capture()` returns `null`, the reporter form shows a non-blocking warning ("Screenshot unavailable") and the submit button remains enabled. The report is sent without a screenshot (no `report_attachments` row created server-side).

### 6.4 Intake client (`packages/core/src/intake-client.ts`)

Builds a `FormData` with two parts:

| Part | Content | Content-Type |
| --- | --- | --- |
| `report` | JSON blob with `{ projectKey, title, description, context, metadata }` | `application/json` |
| `screenshot` | PNG blob (optional — omitted on capture failure) | `image/png` |

POSTs to `${config.endpoint}/api/intake/reports` with:

```ts
fetch(url, {
  method: "POST",
  body: formData,
  credentials: "omit",                // never leak host-site cookies cross-origin
  signal: AbortSignal.timeout(30_000),
})
```

Response handling:
- `201 Created` → emit success UI; close widget after 2 s.
- `4xx` → display the response's `statusMessage` inline; keep form open.
- `5xx` or network error → show "Something went wrong, please try again" inline.

### 6.5 Context gathering (`packages/core/src/context.ts`)

Pure function; no side effects; unit tested.

```ts
export function gatherContext(
  reporter: Reporter | null,
  metadata: Record<string, string | number | boolean> | undefined,
): ReportContext {
  return {
    pageUrl: location.href,
    userAgent: navigator.userAgent,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    timestamp: new Date().toISOString(),
    ...(reporter ? { reporter } : {}),
    ...(metadata ? { metadata } : {}),
  }
}
```

## 7. Intake API

### 7.1 `POST /api/intake/reports`

Public endpoint; never touches the session; no auth middleware.

Pipeline, in order:

1. **CORS preflight** (`OPTIONS`): `intake-cors.ts` reflects the request's `Origin` header as `Access-Control-Allow-Origin`, plus `Access-Control-Allow-Methods: POST` and `Access-Control-Allow-Headers: Content-Type`. Returns 204. Preflight intentionally does not enforce the allowlist — enforcement happens on the actual POST (step 6). Reflecting the origin at preflight is safe because no data has moved yet.
2. **Rate limit** (`rate-limit.ts`): in-memory token buckets keyed by `key:${projectKey}` and `ip:${clientIP}`. Refills continuously; initial capacity = limit. Over limit → 429 with `Retry-After` header.
3. **Payload size cap**: `h3`'s `readMultipartFormData` capped at `INTAKE_MAX_BYTES` (default 5 MB). Overage → 413.
4. **Parse + validate**: Zod-parse the `report` JSON part against `ReportIntakeInput`. Malformed → 400.
5. **Project lookup**: `SELECT ... FROM projects WHERE public_key = $1 AND deleted_at IS NULL`. Missing → 401.
6. **Origin allowlist check**: compare the request's HTTP `Origin` header against `project.allowed_origins`. Dev leniency: if the allowlist is empty *and* the origin is `localhost` or `127.0.0.1`, pass. Otherwise mismatch → 403. The error response still carries `Access-Control-Allow-Origin: <origin>` so the SDK client can read the 403 status message rather than surface a generic CORS error.
7. **Transaction**:
   - Insert `reports` row.
   - If `screenshot` part present: `storage.put(key, bytes, 'image/png')` then insert `report_attachments` row.
8. Return `201` with `{ id: reportId }` and `Access-Control-Allow-Origin: <origin>`.

All responses from this endpoint (2xx and 4xx/5xx) set `Access-Control-Allow-Origin` to the request origin so the SDK can always read the body; this does not weaken the security model because the server still decides whether to do the work.

### 7.2 Storage adapter (`server/lib/storage/`)

```ts
interface StorageAdapter {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<{ key: string }>
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string }>
  delete(key: string): Promise<void>
}
```

- `LocalDiskAdapter` writes to `${STORAGE_LOCAL_ROOT}/${key}`, creating parent directories as needed. `key` convention: `attachments/<reportId>/<kind>.<ext>`. `get` returns buffered bytes (v1 doesn't stream; 5 MB cap makes it fine). `delete` unlinks; missing file is not an error.
- `S3Adapter` implements the same interface but every method throws `Error("S3 storage not implemented in v1")`. Exercised only if `STORAGE_DRIVER=s3` is set.
- Factory in `storage/index.ts` returns one adapter per process based on `STORAGE_DRIVER` (`local` default).

### 7.3 Rate limiter (`server/lib/rate-limit.ts`)

Pure in-process token bucket. Not shared across Nitro workers — Nitro in dev is single-process, and for self-host prod, a single Nitro instance is a reasonable default. Multi-instance deployments will need a Redis-backed limiter; that's a known follow-up, out of scope for B.

Config: `INTAKE_RATE_PER_KEY=60`, `INTAKE_RATE_PER_IP=20`. Buckets auto-expire via a periodic sweep (every 60 s) to bound memory.

### 7.4 Env vars added

```
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=./.data/attachments
INTAKE_RATE_PER_KEY=60
INTAKE_RATE_PER_IP=20
INTAKE_MAX_BYTES=5242880
```

## 8. Dashboard Viewer

### 8.1 Route `/projects/:id/reports` (`app/pages/projects/[id]/reports.vue`)

Access: project `viewer+`. New nav link from the project detail header.

Layout:
- Header: "Reports — {project.name}" with total count.
- Table: sticky header; columns **Thumbnail** (40×40), **Title**, **Reporter**, **Page URL**, **Received** (relative time). Row click opens detail drawer.
- Pagination: 50 per page; offset-based `?page=N`. Shows `[Prev] page N of M [Next]`.
- Empty state: "No reports yet. Embed the SDK in your site — see the Settings tab for your project key."

Detail drawer (right side, 640 px wide, overlay):
- Full-size screenshot (click → opens raw image in new tab).
- Title, description (or "(no description)"), received timestamp.
- Context card: page URL (linked), user agent, viewport, reporter identity (if present), metadata (if present).
- Collapsible raw JSON of the full `context` blob for debugging.

### 8.2 New endpoints

- `GET /api/projects/:id/reports?limit=50&offset=0`
  - Auth: `requireProjectRole(event, id, 'viewer')`.
  - Returns: `{ items: ReportSummaryDTO[], total: number }`.
  - Joins `report_attachments` to pull screenshot `storage_key` → builds a `thumbnailUrl` pointing at the attachment endpoint.

- `GET /api/projects/:id/reports/:reportId/attachment?kind=screenshot`
  - Auth: `requireProjectRole(event, id, 'viewer')` and verifies the report belongs to the project.
  - Streams bytes via `storage.get(...)`; sets `Content-Type` from the attachment row; `Cache-Control: private, max-age=3600`.

### 8.3 Shared DTOs (`packages/shared/src/reports.ts`)

```ts
ReportContext      // matches §4.4 JSONB shape
ReportIntakeInput  // { projectKey, title, description?, context, metadata? }
ReportSummaryDTO   // { id, title, reporterEmail, pageUrl, receivedAt, thumbnailUrl | null }
AttachmentDTO      // { id, kind, url, contentType, sizeBytes }
ReportDetailDTO    // ReportSummaryDTO + { description, context, attachments: AttachmentDTO[] }
```

All three are exported from `packages/shared` and consumed by both the dashboard UI (`useFetch<ReportSummaryDTO[]>(...)`) and — for `ReportIntakeInput` — the SDK's intake client.

## 9. Demo Playground

`packages/ui/demo/`:
- **`index.html`** — a realistic rough page with a hero, card grid, a form with a broken submit, a 404-linking button. Loads the SDK via `<script src="/sdk.iife.js">` and calls `FeedbackTool.init(...)`.
- **`serve.ts`** — `Bun.serve({ port: 4000 })`. Serves `index.html` at `/`, streams `packages/core/dist/feedback-tool.iife.js` at `/sdk.iife.js`. Watches source files and triggers an `sdk:build` child process on change.

Root scripts:

```jsonc
"sdk:build":  "bun --filter @feedback-tool/sdk build && bun --filter @feedback-tool/ui build",
"sdk:watch":  "bun --filter @feedback-tool/sdk build --watch",
"demo":       "bun run sdk:build && bun --filter @feedback-tool/ui demo"
```

## 10. Testing

- **Unit** — `bun test` against pure modules:
  - `packages/core/src/context.test.ts`
  - `packages/core/src/screenshot.test.ts` (mocks `modern-screenshot`)
  - `apps/dashboard/server/lib/rate-limit.test.ts`
  - `apps/dashboard/server/lib/storage/local-disk.test.ts`

- **Integration** — `@nuxt/test-utils` + `bun test`:
  - Intake happy path: create project → curl multipart intake → 201 + DB row + file on disk.
  - Intake origin rejection: wrong origin → 403.
  - Intake rate limit: 21 rapid requests from same IP → last one 429.
  - Intake bad `projectKey` → 401.
  - Intake over 5 MB → 413.
  - Reports list: admin sees all reports for project; non-member gets 404; `viewer` sees ordered list.
  - Attachment stream: returns correct bytes + Content-Type.

- **Browser smoke (manual, documented)** — steps in §11 below.

## 11. Definition of Done

From a fresh clone tagged `v0.1.0-skeleton`:

1. `bun install`, `bun run dev:docker`, `bun run db:migrate`, `bun run dev` brings the dashboard up.
2. Sign in as admin, create a project named "Demo", copy the project's `publicKey`.
3. Add `http://localhost:4000` to the project's `allowedOrigins`.
4. In a second terminal, `bun run demo` starts the playground on `:4000`.
5. Paste `publicKey` into `packages/ui/demo/index.html`'s `FeedbackTool.init({...})` call (or a local `.env` the demo reads).
6. Open `http://localhost:4000` → the launcher bubble appears bottom-right.
7. Click the launcher → reporter form opens → screenshot preview appears within 1 s.
8. Fill title "Test report" + description, submit → form closes with a "Thanks!" confirmation.
9. Return to the dashboard `/projects/:id/reports` → the new report is in the list with a thumbnail.
10. Click the row → drawer shows the full screenshot + context (page URL = `http://localhost:4000/`, viewport, UA, timestamp).
11. `bun run check` passes. `bun test` passes (23 existing + new unit + new integration tests).

On success, tag `v0.2.0-sdk`.

## 12. Risks

- **`modern-screenshot` rendering gaps** — CSS `filter:`, some iframes, and cross-origin images may fail to render. Mitigation: screenshot is best-effort; failure is logged and the report submits without the image. If we repeatedly hit real-world gaps, swap in `html2canvas` behind the same `capture()` wrapper (one-file change).
- **Shadow-DOM + Preact bundle size** — stretch goal is <50 kB gzipped for the core widget. Preact (~3 kB) + modern-screenshot (~12 kB) + our code is tight but feasible. We'll measure during implementation and trim if needed.
- **In-memory rate limiter** — single-process only. If a self-host deploys multiple Nitro instances behind a load balancer, limits are effectively multiplied by N. Documented as a known limitation; Redis-backed limiter is a sub-project F/G follow-up.
- **CORS mistakes silently break intake** — if `Access-Control-Allow-Origin` is missing or wrong on *any* response path, the browser blocks the intake POST and the user sees "something went wrong" with no server-side log explaining why. Mitigation: `intake-cors.ts` is a single chokepoint all responses pass through; integration tests in §10 assert ACAO on 201, 403, and 429 paths.
- **Shadow-DOM accessibility** — screen readers work with shadow DOM but focus management is the developer's responsibility. Launcher + form get explicit `role`, `aria-label`, and focus trap when open. Specific accessibility test cases are out of scope for v1 unit tests; documented as a follow-up.
