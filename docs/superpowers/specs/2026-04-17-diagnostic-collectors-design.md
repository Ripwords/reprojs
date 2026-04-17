# Diagnostic Collectors — Design

**Sub-project:** D (fourth slice of the feedback-tool platform)
**Status:** Design approved, awaiting spec review
**Date:** 2026-04-17
**Depends on:** `v0.3.0-annotation` (sub-project C)

## 1. Purpose & Scope

Sub-project D attaches rich diagnostic context to every report: console logs, network requests, cookies, custom breadcrumbs via `feedback.log()`, and an expanded system-info snapshot. Collectors start buffering at `init()` and flush at submit time into a new `logs` attachment served lazily by the dashboard drawer's tabbed UI. D also addresses a shipped `javascript:` URI XSS bug in the existing reports drawer.

**In scope:**
- Five diagnostic streams: console, network (fetch + XHR), cookies, breadcrumbs, system info.
- Shared ring buffer + safe-serialize + redaction infrastructure.
- `feedback.log(event, data?, level?)` public API (previously deferred from sub-project B).
- Privacy-first defaults: allowlist headers, denylist cookie names, URL query-param scrubbing, string-pattern redaction (JWTs, GitHub PATs, Slack, AWS, Bearer tokens), truncation caps.
- `beforeSend` hook for host-app last-mile scrubbing, sandboxed with fail-open semantics.
- Dashboard drawer redesign as tabs (Overview / Console · N / Network · N · N✗ / Cookies).
- Attachment-based storage (`kind='logs'`) reusing sub-project B's infrastructure.
- `safeHref()` utility for protocol-filtering any rendered URL (fixes existing `javascript:` URI XSS in the report drawer's pageUrl binding).

**Out of scope (deferred):**
- 30-second DOM session replay (E).
- Ticket inbox enhancements — filters, status transitions, assignees, comments (F).
- GitHub sync (G).
- Vue component tests for the tab bodies (no Vitest harness in the project yet; defer to a dedicated test-infra sub-project).
- Real-browser cross-engine drift tests for the network wrapper (happy-dom coverage only).
- Property-based fuzz for the serializer.
- PII retention / right-to-delete UI (a separate compliance sub-project).

## 2. Decisions (from brainstorming)

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Ship all four collectors + expand system info in v1 | Collectors share almost all infrastructure; 1.3× the cost of shipping one |
| 2 | Hybrid storage: light fields in `context` JSONB, heavy logs as `kind='logs'` attachment | Keeps list-page bandwidth tiny; reuses B's attachment path |
| 3 | Conservative-by-default capture with opt-in escalation | Matches Sentry / Datadog norms; safest foot forward |
| 4 | Tabbed drawer (Overview / Console / Network / Cookies) with lazy attachment fetch | Matches DevTools mental model; costs nothing until user clicks a tab |
| 5 | Default string redactors for common token patterns (JWT, PAT, Slack, AWS, Bearer) | Defense in depth on top of the allow/denylist model |
| 6 | `beforeSend` runs synchronously, wrapped in try/catch, fail-open on throw | One bad hook shouldn't black-hole the entire reporting pipeline |

## 3. Architecture

New directories marked ★. Existing structure unchanged unless noted.

```
packages/ui/src/
├── collectors/                            ★ new
│   ├── index.ts                              # registerAllCollectors + orchestration
│   ├── console.ts                            # wraps console.log/info/warn/error/debug
│   ├── network.ts                            # fetch + XMLHttpRequest interception
│   ├── cookies.ts                            # document.cookie snapshot + redaction
│   ├── breadcrumbs.ts                        # feedback.log(event, data?, level?)
│   ├── system-info.ts                        # navigator/timezone/locale/connection
│   ├── ring-buffer.ts                        # shared bounded FIFO
│   ├── redact.ts                             # cookie denylist + header allowlist + URL + string scrubbers
│   ├── serialize.ts                          # safe structured-clone with truncation + string-scrubbers
│   └── *.test.ts                             # per-module unit tests
│
packages/core/src/
├── config.ts                              # EXTEND InitOptions with `collectors`
├── index.ts                               # wire registerAllCollectors + snapshotAll on submit
└── intake-client.ts                       # add optional `logs` multipart part

packages/shared/src/
└── reports.ts                             # EXTEND ReportContext (+ systemInfo, cookies)
                                           # + new LogsAttachment / ConsoleEntry / NetworkEntry / Breadcrumb

apps/dashboard/server/
├── api/intake/reports.ts                  # accept + persist `logs` attachment
└── routes/sdk/feedback-tool.iife.js.get.ts  # unchanged

apps/dashboard/app/
├── composables/use-safe-href.ts           ★ new — safeHref() utility
└── pages/projects/[id]/reports.vue        # REPLACE drawer body with tabbed component
    └── components/report-drawer/           ★ new
        ├── drawer.vue
        ├── tabs.vue
        ├── overview-tab.vue
        ├── console-tab.vue
        ├── network-tab.vue
        └── cookies-tab.vue

docs/superpowers/security/                  ★ new
└── threat-model.md                         # documents public-key + origin + content-type invariants
```

**Invariants:**
1. Collectors start on `init()`, not on launcher click. Data is buffered from page load onward.
2. Redaction runs at **capture time**, not at snapshot time. Unredacted data is never held past a single synchronous callback.
3. `beforeSend` runs **synchronously**, **sandboxed**, **fail-open**.
4. Attachment `contentType` is set server-side per `kind`. Client-supplied MIME types are ignored.
5. `context.systemInfo` and `context.cookies` are optional — reports from v0.2.0-sdk (no D) still parse.

## 4. Data model

### 4.1 `ReportContext` JSONB extensions

```ts
export const SystemInfo = z.object({
  userAgent: z.string(),
  platform: z.string(),
  language: z.string(),
  timezone: z.string(),
  timezoneOffset: z.number(),
  viewport: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  screen: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  dpr: z.number().positive(),
  online: z.boolean(),
  connection: z
    .object({ effectiveType: z.string().optional(), rtt: z.number().optional(), downlink: z.number().optional() })
    .optional(),
  pageUrl: z.string().url(),
  referrer: z.string().optional(),
  documentReferrer: z.string().optional(),
  timestamp: z.string(),
})

export const CookieEntry = z.object({
  name: z.string(),
  value: z.string(),   // "<redacted>" for denylist hits
})

// Existing ReportContext gains two optional fields:
//   systemInfo: SystemInfo | undefined
//   cookies:    CookieEntry[] | undefined
```

### 4.2 `LogsAttachment` JSON (stored as `kind='logs'` in `report_attachments`)

```ts
export const ConsoleEntry = z.object({
  level: z.enum(["log", "info", "warn", "error", "debug"]),
  ts: z.number().int(),
  args: z.array(z.string()),
  stack: z.string().optional(),   // present for warn + error
})

export const NetworkEntry = z.object({
  id: z.string(),
  ts: z.number().int(),
  method: z.string(),
  url: z.string(),
  status: z.number().int().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  size: z.number().int().nullable(),
  initiator: z.enum(["fetch", "xhr"]),
  requestHeaders: z.record(z.string()).optional(),
  responseHeaders: z.record(z.string()).optional(),
  requestBody: z.string().optional(),
  responseBody: z.string().optional(),
  error: z.string().optional(),
})

export const Breadcrumb = z.object({
  ts: z.number().int(),
  event: z.string().max(200),
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  data: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})

export const LogsAttachment = z.object({
  version: z.literal(1),
  console: z.array(ConsoleEntry),
  network: z.array(NetworkEntry),
  breadcrumbs: z.array(Breadcrumb),
  config: z.object({
    consoleMax: z.number(),
    networkMax: z.number(),
    breadcrumbsMax: z.number(),
    capturesBodies: z.boolean(),
    capturesAllHeaders: z.boolean(),
  }),
})
```

### 4.3 No migration

`report_attachments.kind` enum already includes `'logs'` (reserved in sub-project B). Intake endpoint inserts a new row when a `logs` multipart part is present.

## 5. Collector interface + modules

### 5.1 `Collector` + `CollectorConfig`

```ts
export interface Collector<TSnapshot> {
  start(config: CollectorConfig): void
  snapshot(): TSnapshot
  stop(): void
}

export interface CollectorConfig {
  console?: { maxEntries?: number; maxArgBytes?: number; maxEntryBytes?: number; enabled?: boolean }
  network?: {
    maxEntries?: number
    requestBody?: boolean
    responseBody?: boolean
    maxBodyBytes?: number
    allowedHeaders?: string[]
    allHeaders?: boolean
    redactQueryParams?: boolean
    enabled?: boolean
  }
  cookies?: { maskNames?: string[]; allowNames?: string[]; enabled?: boolean }
  breadcrumbs?: { maxEntries?: number; maxDataBytes?: number; enabled?: boolean }
  stringRedactors?: RegExp[]
  beforeSend?: (report: PendingReport) => PendingReport | null
}

export function registerAllCollectors(config: CollectorConfig): {
  snapshotAll: () => { systemInfo: SystemInfo; cookies: CookieEntry[]; logs: LogsAttachment }
  stopAll: () => void
  breadcrumb: (event: string, data?: Record<string, string | number | boolean | null>, level?: Breadcrumb["level"]) => void
}
```

### 5.2 Per-collector details

- **ring-buffer.ts** — bounded FIFO with O(1) push + O(N) drain; used by console + network + breadcrumbs. Defaults: console = 100, network = 50, breadcrumbs = 50.
- **console.ts** — wraps `log/info/warn/error/debug`; captures timestamp + level + serialized args; `warn`/`error` also capture `new Error().stack`; restores originals on `stop()`.
- **network.ts** — monkeypatches `window.fetch` + `XMLHttpRequest`; captures method, URL (after `redactUrl()`), status, duration, size, initiator, optional headers/bodies per config. Cloning wrapped in try/catch; failure sets `error: "body-capture-failed"` and preserves the host's request/response flow.
- **cookies.ts** — pure snapshot at `snapshot()` time; reads `document.cookie`, applies `redactCookies()`.
- **breadcrumbs.ts** — exposes a single `breadcrumb(event, data, level)` fn pushed to a ring buffer; mounted on `window.FeedbackTool.log` for IIFE consumers.
- **system-info.ts** — pure snapshot; calls `Intl.DateTimeFormat().resolvedOptions().timeZone`, `navigator.*`, `window.screen`, `navigator.connection?`.
- **serialize.ts** — `serializeArg(v, maxBytes)` safely stringifies primitives / objects / errors / DOM-like nodes / circular refs / typed arrays, truncates to `maxBytes`, then applies `scrubString(..., stringRedactors)`.

## 6. Redaction engine

### 6.1 Public surface (`collectors/redact.ts`)

```ts
export const DEFAULT_SENSITIVE_COOKIE_NAMES: readonly string[]
export const DEFAULT_ALLOWED_REQUEST_HEADERS: readonly string[]
export const DEFAULT_ALLOWED_RESPONSE_HEADERS: readonly string[]
export const DEFAULT_REDACTED_QUERY_PARAMS: readonly string[]
export const DEFAULT_STRING_REDACTORS: readonly RegExp[]

export function redactCookies(raw: CookieEntry[], opts?: CookieConfig): CookieEntry[]
export function redactHeaders(headers: Record<string, string>, kind: "request" | "response", opts?: { allowed?: string[]; all?: boolean }): Record<string, string>
export function redactBody(body: string | null, opts: { maxBytes: number }): string | null
export function redactUrl(url: string, redactKeys?: readonly string[]): string
export function truncate(s: string, maxBytes: number): string
export function scrubString(s: string, patterns: readonly RegExp[]): string
```

### 6.2 Defaults

**Sensitive cookie names** (case-insensitive, substring match with `__Secure-` / `__Host-` prefix stripping):

```
session, sid, auth, token, csrf, jwt, api_key, access_token, refresh_token,
_session, connect.sid, laravel_session, PHPSESSID, JSESSIONID
```

**Allowed request headers**:

```
content-type, content-length, accept, accept-language, cache-control, x-request-id, x-correlation-id
```

**Allowed response headers**:

```
content-type, content-length, cache-control, etag, x-request-id, x-correlation-id, retry-after
```

**Redacted query params** (case-insensitive, exact-match):

```
api_key, apikey, access_token, refresh_token, token, password, secret,
code, state, sig, signature, authorization
```

**String redactors** (applied to every serialized string after truncation):

```js
/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.?[A-Za-z0-9_.+/=-]*/g  // JWT
/gh[ps]_[A-Za-z0-9]{36,}/g                                  // GitHub PAT
/xox[abp]-[A-Za-z0-9-]+/g                                   // Slack token
/AKIA[0-9A-Z]{16}/g                                         // AWS access key ID
/Bearer\s+[A-Za-z0-9._~+/=-]+/gi                            // "Bearer <value>"
```

### 6.3 `beforeSend` sandbox

```ts
let finalReport: PendingReport | null = pendingReport
const hook = _config.collectors?.beforeSend
if (hook) {
  try {
    finalReport = hook(pendingReport)
  } catch (err) {
    console.warn("[feedback-tool] collectors.beforeSend threw; proceeding with original report", err)
    finalReport = pendingReport
  }
}
if (finalReport === null) return { ok: false, message: "aborted by beforeSend" }
```

A throw → warn + fall back to the unmodified pending report. An explicit `null` return → silent cancel (widget closes without the "Thanks!" flash; no network call). Documented as fail-open in the SDK docs.

### 6.4 Redaction ordering

All per-entry redaction runs at **capture time** before the push to the ring buffer. `beforeSend` runs at **snapshot/send time** as the final host-controlled mutator.

## 7. Intake API

### 7.1 `POST /api/intake/reports` extension

Pipeline is unchanged through step 6 (from sub-project B). At step 7 (the transaction), after the screenshot branch:

```ts
const logsPart = parts.find((p) => p.name === "logs")
if (logsPart?.data && logsPart.data.length > 0) {
  let parsedLogs: LogsAttachment
  try {
    parsedLogs = LogsAttachment.parse(JSON.parse(logsPart.data.toString("utf8")))
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid logs payload" })
  }
  const key = `${report.id}/logs.json`
  await storage.put(key, new Uint8Array(logsPart.data), "application/json")
  await db.insert(reportAttachments).values({
    reportId: report.id,
    kind: "logs",
    storageKey: key,
    contentType: "application/json",   // server-set; invariant
    sizeBytes: logsPart.data.length,
  })
}
```

### 7.2 Content-Type invariant

The intake handler always hardcodes `contentType` on insert — `image/png` for screenshots (shipped), `application/json` for logs (new). Client-supplied MIME types via `Blob.type` are ignored. Regression-tested in §9.

### 7.3 5 MB cap unchanged

The existing `INTAKE_MAX_BYTES` total-payload cap covers screenshot + logs combined. No new env var.

## 8. Dashboard — tabbed drawer

Replaces the current `reports.vue` drawer body. List-page behavior is unchanged.

### 8.1 Drawer shell

```
┌───────────────────────────────────────────────────────────┐
│  Broken save button                                  ✕   │
├───────────────────────────────────────────────────────────┤
│  Overview   Console · 47   Network · 12 · 3✗   Cookies   │
├───────────────────────────────────────────────────────────┤
│                                                            │
│   [ active tab body scrolls here ]                        │
│                                                            │
└───────────────────────────────────────────────────────────┘
```

- **Overview** — default tab. Annotated screenshot + title + description + reporter + full systemInfo block + metadata + raw `context` JSON collapsible. Any rendered URL (pageUrl, referrer, documentReferrer) goes through `safeHref()`.
- **Console · N** — log list with level-filter checkboxes (log/info/warn/error/debug) + substring search. Warn/error rows get a left stripe + stack on expand. Below the console list, a "App events" section renders breadcrumbs with the same row shape.
- **Network · N · N✗** — table with Method / URL / Status / Duration / Size. Click a row to expand headers + bodies + error inline. Red text for status ≥ 400.
- **Cookies · N** — table with Name / Value. Redacted cells show `<redacted>` in italic gray. Substring filter on name.

### 8.2 Lazy fetch

The `logs` attachment is only fetched when the user clicks a tab that needs it (Console, Network, Cookies). A single `useFetch` hits `/api/projects/:id/reports/:reportId/attachment?kind=logs`; the JSON is parsed once and cached for the drawer's lifetime. Overview tab never triggers the fetch.

### 8.3 `safeHref(url)` utility

New composable `apps/dashboard/app/composables/use-safe-href.ts`:

```ts
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"])

export function safeHref(url: string | null | undefined): string {
  if (!url) return "#"
  try {
    const u = new URL(url, window.location.origin)
    return SAFE_PROTOCOLS.has(u.protocol) ? u.toString() : "#"
  } catch {
    return "#"
  }
}
```

Applied in:
- `overview-tab.vue` for `pageUrl`, `referrer`, `documentReferrer`.
- `reports.vue` (existing) replaces its bare `:href="selected.pageUrl"` binding.
- `network-tab.vue` — URLs shown as text, no link, but guard applied defensively in case we ever make them clickable.

### 8.4 Keyboard shortcuts

`1` / `2` / `3` / `4` switches tabs when the drawer has focus. `Esc` closes the drawer (already wired). No new shortcut config needed; handled inline by the drawer component.

## 9. Testing

### 9.1 Unit tests (`packages/ui/src/collectors/**/*.test.ts`) — ≈ 35 new

- `ring-buffer.test.ts` — capacity bounds, FIFO order, drain immutability, clear, edge cases (cap 0, cap 1, overflow by 1).
- `serialize.test.ts` — primitives, null/undefined, strings with quotes, numbers/Infinity/NaN, Dates, Errors with truncated stack, circular refs, functions, DOM-like nodes, typed arrays, deeply nested objects, multi-byte UTF-8 preserved at truncation boundary, stringRedactors applied post-truncation.
- `redact.test.ts` —
  - Cookie denylist (case-insensitive, `__Secure-`/`__Host-` prefix strip, `maskNames` extends, `allowNames` overrides).
  - Request/response header allowlists + `allHeaders: true` kill switch.
  - `redactBody` truncation at byte boundary, UTF-8 safe.
  - `redactUrl` scrubs default params, preserves key + `REDACTED` value, leaves non-URLs untouched on parse failure.
  - `scrubString` applies each pattern; empty patterns array is a no-op; patterns handle overlapping matches correctly.
- `system-info.test.ts` — mock `navigator`, `Intl`, `screen`, `location`; shape assertions; optional `connection` included/omitted based on presence.
- `console.test.ts` — `start()` wraps all five methods; `log` pushes with `level: "log"`, `error` includes stack, `stop()` restores originals (identity check), buffer eviction.
- `network.test.ts` — fetch wrapper success + failure; request/response body capture when opted in; clone-failure guard sets `error: "body-capture-failed"` without breaking the response; XHR lifecycle events.
- `cookies.test.ts` — empty/missing `document.cookie`, single + multiple cookies, redaction applied.
- `breadcrumbs.test.ts` — push with default level, explicit level, eviction at capacity, large data truncated.
- `index.test.ts` (orchestration) — `registerAllCollectors` wires enabled collectors, `snapshotAll` shape, `stopAll` detaches all, `beforeSend` throw → fail-open, `beforeSend` null → abort.

### 9.2 Integration tests — 4 new

`apps/dashboard/tests/api/logs-intake.test.ts`:

1. **Happy path** — POST `report` + `screenshot` + `logs` → 201, two attachment rows, GET logs streams identical bytes, parses against `LogsAttachment`.
2. **Backward compat** — POST without `logs` → still 201, single attachment row (the screenshot), no behavior change vs sub-project B.
3. **Malformed logs** — invalid JSON or failed schema → 400, **transaction rolls back** (no orphan report row).
4. **Server-set content-type** — Blob typed `text/html` / `application/javascript` on the wire. Stored content-type is `image/png` + `application/json` respectively. GET responses confirm hardcoded MIME.

Running `bun test` at repo root after D: **≈ 154 tests total** (45 dashboard + ~95 SDK UI + 10 SDK core + 4 new integration).

### 9.3 Deliberately deferred

- Vue component tests for tab bodies — no Vitest harness in project. Manual smoke in §10 covers render paths.
- Cross-browser network wrapper behavior — happy-dom drives coverage; real-browser drift is treated as a bug report.
- Property-based fuzzing on serialize — case-based coverage is sufficient.
- Performance/throughput benchmarks — bundle-size CI catches regressions; runtime regressions trigger manual investigation.

## 10. Definition of done

All checks from §7 of the brainstorm summary plus the commit + tag below.

### 10.1 Gate

- `bun run check` at repo root → 0 errors.
- `bun run sdk:build` → IIFE gzipped ≤ 32 KB.
- `bun test` at repo root → passes existing 115 + ~39 new = ~154 total.

### 10.2 Laptop smoke (Chrome)

Ten steps walking the reporter end-to-end on the Nuxt demo at `:3002`:

1. Embed SDK with default `collectors: {}`.
2. Generate console noise, clicks, and the broken-button `throw`.
3. Trigger a fetch from DevTools.
4. Call `FeedbackTool.log("demo.clicked", { id: 42 })`.
5. Launcher → annotate → Next → fill title/description → Send.
6. Dashboard Reports tab → open drawer.
7. **Overview**: metadata block + raw JSON.
8. **Console**: levels + stacks + breadcrumbs section.
9. **Network**: request row with expand-inline detail; header allowlist enforced; bodies absent by default.
10. **Cookies**: redacted values show `<redacted>`.

### 10.3 Redaction smoke

Opt into aggressive capture; verify scrubbers still sanitize JWTs, query params, Bearer tokens.

### 10.4 `javascript:` URI regression

Manually POST a report with `context.pageUrl = "javascript:alert(document.cookie)//"`. Drawer's link resolves to `#`; click does nothing.

### 10.5 `beforeSend` fail-open

Init with a throwing `beforeSend` → report still submits unmodified, warning logged to the page console.

### 10.6 Sub-project C regression

Annotation wizard unchanged; reports without `logs` part submit cleanly.

### 10.7 Tag

```bash
git tag -a v0.4.0-collectors -m "Sub-project D complete: diagnostic collectors"
```

## 11. Risks

- **Console wrapper interacts with other instrumented libraries.** Sentry and friends also wrap `console.*`. Installation order matters; whoever wraps second sees the earlier wrapper's writes but the original host behavior is preserved. Documented as "install FeedbackTool last if you use multiple console-instrumenting tools."
- **Large host apps produce very large serialized args.** Truncation at 1 KB/arg + 10 KB/entry bounds worst case, but the CPU cost of `JSON.stringify` on a deeply nested object is real. Acceptable for v1; if profiling shows a hot loop, we add a time budget to the serializer.
- **iOS Safari `fetch` cloning edge cases.** `response.clone()` occasionally throws on certain streaming bodies. Wrapped in try/catch per §5.2; body-capture failure is recorded but non-fatal to the host request.
- **`Intl.DateTimeFormat` availability.** Present on all modern browsers; fallback to `undefined` timezone if the throw path triggers. Non-blocking.
- **Default string redactors produce false positives.** A legitimate use of the substring `eyJ...` in a non-JWT context would be replaced with `REDACTED`. The patterns are narrow enough that this is rare; power users set `stringRedactors: []` or override the defaults.
- **`beforeSend` throw can still cost time.** If the hook spins for 10 seconds, the submit sits spinning. We don't impose a timeout in v1 — host apps that need this can `setTimeout`-race their own logic.

## 12. Threat model (new doc)

A one-page file lives at `docs/superpowers/security/threat-model.md` documenting:

- The public key is not a secret; rate limit + rotation are the abuse controls.
- The `Origin` header check is browser-enforced, not server-enforced; leaked key + curl bypasses it.
- `contentType` is set server-side per `kind`; the client cannot smuggle MIME.
- Host-app-originated secrets in `console.log` / `feedback.log` / network bodies are the host's responsibility; default string-redactors are best-effort defense-in-depth, not a guarantee.
- PII retention: project deletion cascades to reports + attachments; dedicated deletion-on-request UI is a future sub-project.
