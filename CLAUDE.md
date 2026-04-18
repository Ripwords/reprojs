# Feedback Tool

A framework-agnostic, embeddable frontend user feedback SDK (similar in scope to [marker.io](https://marker.io)) **plus** a self-hostable admin dashboard for developers and team admins to triage, manage, and sync tickets.

End users (users of whatever host app embeds the SDK) can report bugs directly from the page, annotate an auto-captured screenshot, and attach rich diagnostic context (session replay, logs, network activity, environment info). Reports can be triaged in the dashboard and/or synced to GitHub Issues.

---

## 1. Product Vision

### 1.1 Goals

- **Framework-agnostic SDK**: drop-in widget that works in any web app regardless of framework (vanilla JS, React, Vue, Svelte, Angular, Nuxt, Next.js, etc.).
- **Zero-config embed**: single `<script>` tag or `import` + `init()` call; no peer-dependency on the host's framework.
- **Low friction for reporters**: a floating widget + keyboard shortcut opens the capture flow in < 1 second.
- **Rich context by default**: every report bundles a screenshot, the last 30s of session replay, console/network logs, cookies, and system info.
- **Actionable for developers**: reports land in the admin dashboard, and can optionally be mirrored to the team's existing issue tracker (GitHub Issues first).
- **Self-hostable**: the full stack (SDK + dashboard + Postgres) runs locally via Docker and can be deployed anywhere Nuxt/Nitro runs.

### 1.2 Non-goals (initial scope)

- Not a full product analytics or heatmap tool.
- Not a customer support chat widget.
- Not a replacement for APM (Datadog, Sentry).
- No native mobile SDKs in v1 (web only).
- No multi-tenant SaaS billing layer in v1 — single-workspace self-host first.

### 1.3 Reference product

[marker.io](https://marker.io) — UX and feature benchmark. Our differentiation: open-source friendly, lightweight SDK bundle, framework-agnostic core, self-hostable backend.

---

## 2. System Overview

Two first-class deliverables in one repo:

| Component | What it is | Who uses it | Built with |
| --- | --- | --- | --- |
| **SDK** | Embeddable JS widget + SDK | End users of host apps | TypeScript lib, Preact + Shadow DOM (tentative), tsdown |
| **Dashboard** | Admin/developer web app + API | Developers, team admins | Nuxt 4 fullstack (Vue + Nitro) |

Data flow:

```
End user clicks widget
    ↓
SDK captures screenshot, annotations, 30s replay, logs, system info
    ↓
SDK POSTs report → Dashboard intake API (Nuxt /server/api/intake/*)
    ↓
Dashboard stores in Postgres (Drizzle), uploads attachments to blob storage
    ↓
Dashboard optionally forwards to GitHub Issues (configured per project)
    ↓
Admins/developers triage tickets in the dashboard UI
```

---

## 3. Core Features

### 3.1 SDK — Bug Reporter Widget

- Floating launcher button (configurable position, theme, z-index).
- Programmatic API: `feedback.init({...})`, `feedback.open()`, `feedback.close()`, `feedback.identify(user)`, `feedback.log(event, data)`.
- Keyboard shortcut support (configurable, e.g. `Ctrl+Shift+B`).
- Form fields: title, description, severity/type, reporter identity (optional).
- All UI rendered inside a **Shadow DOM root** to isolate from host app styles.

### 3.2 SDK — Screenshot Capture & Annotation

- **Auto-capture** of the current viewport (and optionally full page) when the reporter is opened.
- **Annotation canvas** overlaying the screenshot with tools:
  - Freehand pen, straight line, arrow, rectangle/highlight, text label
  - Color picker + stroke width
  - Undo / redo / clear
- Final annotated image is flattened to PNG before upload.

### 3.3 SDK — Session Recording (Last 30 Seconds)

- Rolling in-memory buffer continuously overwriting so only the **most recent 30 seconds** are retained.
- When a report is submitted, the buffered clip is flushed and attached.
- Implementation direction: DOM-level replay (rrweb-style event recording) rather than raw video — smaller payload, respects privacy redaction, replays as interactive DOM.
- Privacy: masking rules for inputs, password fields, and nodes tagged `data-feedback-mask`.

### 3.4 SDK — Diagnostic Context Bundle

Automatically collected with each report:

- **Console logs** — buffered `log / info / warn / error` with timestamps and stack traces.
- **Network logs** — `fetch` + `XMLHttpRequest` intercepts: method, URL, status, duration, request/response size. Bodies optional and redactable.
- **Session logs** — custom breadcrumbs via `feedback.log(event, data)`.
- **Cookies** — readable cookies at report time (with denylist for sensitive keys).
- **System info** — user agent, OS, browser + version, viewport size, device pixel ratio, language, timezone, page URL, referrer, host-provided metadata.

### 3.5 Dashboard — Admin / Developer UI

- **Auth**: better-auth (email + OAuth providers). Roles: `owner`, `admin`, `developer`, `viewer`.
- **Projects**: multiple projects per workspace. Each project has its own embed key, GitHub repo mapping, and settings.
- **Ticket inbox**: list, filter, search, assign, tag, change status (open / in-progress / resolved / closed).
- **Ticket detail**: render annotated screenshot, play back 30s session replay, browse console/network logs, inspect system info and cookies.
- **GitHub sync**: one-click "create issue" or auto-create on new ticket; two-way status sync (issue closed → ticket closed).
- **Settings**: project config, team members, integration tokens, embed-key rotation, data retention policy.

### 3.6 Dashboard — Intake API

- `POST /api/intake/reports` — SDK submits a report. Auth via public project key + origin allowlist.
- `POST /api/intake/attachments` — direct upload of screenshot + replay blob (or presigned URL flow to blob storage).
- Rate-limited per project key and per origin.
- Input validation with Zod.

### 3.7 Integrations

- **GitHub Issues** (v1): create issue with markdown body, embedded screenshot, and links to replay + logs. Labels / assignees / milestones configurable per project. Auth via GitHub App.
- Extensible adapter interface so Linear / Jira / Slack can slot in later.

---

## 4. Repository Layout

Monorepo with Bun workspaces. Mirrors the ai-trip project's `server/{api,db,lib}` layout for the Nuxt app.

```
feedback-tool/
├── apps/
│   └── dashboard/              # Nuxt 4 fullstack — admin UI + intake API
│       ├── app/                # Vue UI (pages, components, composables, layouts)
│       ├── server/
│       │   ├── api/
│       │   │   ├── intake/     # SDK → API: reports, attachments
│       │   │   ├── tickets/    # admin CRUD
│       │   │   ├── projects/
│       │   │   ├── auth/       # better-auth handler
│       │   │   └── integrations/github/
│       │   ├── db/
│       │   │   ├── schema/     # Drizzle schemas (auth, projects, tickets, attachments)
│       │   │   ├── migrations/
│       │   │   └── index.ts    # Drizzle client
│       │   ├── lib/
│       │   │   ├── auth.ts     # better-auth config
│       │   │   ├── github.ts   # GitHub App client
│       │   │   └── storage/    # blob storage adapter (index.ts, local-disk.ts, s3.ts)
│       │   └── plugins/
│       ├── docker/
│       │   └── docker-compose.dev.yml   # Postgres 17
│       ├── drizzle.config.ts
│       └── nuxt.config.ts
│
├── packages/
│   ├── core/                   # framework-agnostic SDK entry (init, public API)
│   ├── ui/                     # widget UI (Preact + Shadow DOM)
│   │   └── src/
│   │       ├── annotation/     # annotation canvas (pen, arrow, text, etc.) — was packages/annotator
│   │       └── collectors/     # console, network, cookies, system-info — was packages/collectors
│   ├── recorder/               # 30s rolling DOM replay buffer (pending — sub-project E)
│   ├── integrations/
│   │   └── github/             # GitHub Issues adapter (runs server-side)
│   └── shared/                 # shared types: Report, Attachment, API contracts
│
├── docs/
└── package.json                # root workspaces
```

**Why this shape:**
- SDK packages are published npm artifacts; they must stay framework-agnostic and tiny.
- Dashboard is a single Nuxt app (Vue UI + Nitro server) — no separate backend service needed.
- `packages/shared` is consumed by both SDK (for report types) and dashboard (for API contract validation) so the contract is single-sourced.
- GitHub integration adapter lives in `packages/integrations/github` so it could be reused by a standalone worker later, but the dashboard imports and runs it server-side today.

---

## 5. Tech Stack

### 5.1 SDK (packages/*)

| Concern | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript (strict) | No `any` escape hatches |
| UI runtime | **Preact + Shadow DOM** (tentative) | Tiny (~3kb), React-like DX, Shadow DOM isolates host styles |
| Bundler | **tsdown** | ESM + CJS + d.ts for every package |
| Session replay | rrweb-style DOM events | Decision pending — see §8 open questions |
| Annotation | Canvas 2D API | Flatten to PNG on submit |

**Bundle budget (stretch, measure in v1):** core widget < 50kb gzipped.

### 5.2 Dashboard (apps/dashboard)

Mirrors the ai-trip stack:

| Concern | Choice |
| --- | --- |
| Framework | **Nuxt 4** (Vue 3, Nitro server) |
| Database | **PostgreSQL 17** via Docker (local dev) |
| ORM | **Drizzle ORM** + `drizzle-kit` migrations |
| Auth | **better-auth** (email + OAuth) via `@better-auth/cli` schema gen |
| Validation | **Zod** at API boundaries |
| Styling | Tailwind CSS v4 |
| Blob storage | Pluggable adapter — local-disk (default) + S3Adapter via @aws-sdk/client-s3 against any S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, Hetzner, MinIO, etc.) |

### 5.3 Shared Tooling

| Concern | Choice |
| --- | --- |
| Runtime / package manager | **Bun** (see §6) |
| Lint | **oxlint** |
| Format | **oxfmt** |
| Unit tests | `bun test` |
| Browser tests | TBD (Playwright candidate) |
| Git hooks | husky (mirror ai-trip) |

**Do not introduce** ESLint or Prettier unless a required rule isn't supported by the oxc toolchain — document the gap if so.

### 5.4 Scripts (target shape, mirror ai-trip)

```jsonc
{
  "dev": "nuxt dev --host",                    // dashboard
  "dev:docker": "docker compose -f apps/dashboard/docker/docker-compose.dev.yml up -d",
  "build:sdk": "tsdown --config packages/core/tsdown.config.ts",  // per-package
  "auth:gen":  "better-auth generate --config ./apps/dashboard/server/lib/auth.ts --output ./apps/dashboard/server/db/schema/auth-schema.ts -y",
  "db:gen":    "bun run auth:gen && drizzle-kit generate",
  "db:push":   "bun run auth:gen && drizzle-kit push",
  "db:migrate":"drizzle-kit migrate",
  "lint":      "oxlint",
  "lint:fix":  "oxlint --fix",
  "fmt":       "oxfmt --write .",
  "check":     "oxfmt --check . && oxlint",
  "test":      "bun test"
}
```

---

## 6. Bun Conventions

Default to Bun for runtime and tooling. **Build-tool exception:** published SDK packages build with **tsdown**; the dashboard builds with **Nuxt**. `bun build` is fine only for quick one-off bundling, not for shipping artifacts.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install` / `yarn install` / `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` / `yarn run <script>` / `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads `.env`, so don't use `dotenv`.

### 6.1 Bun APIs to prefer

- `Bun.serve()` for any standalone HTTP service (e.g. local dev tooling). The dashboard uses Nitro, which already handles this.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- **Postgres driver — dashboard uses `pg` (node-postgres), not `Bun.sql`.** Nuxt/Nitro's dev and prod servers run under Node.js, not Bun, so Bun's native `bun:*` modules can't resolve inside Nitro workers. The dashboard uses `drizzle-orm/node-postgres` with `pg` + `@types/pg`. `Bun.sql` remains the preference for any standalone Bun scripts (seeds, one-offs) outside the Nitro runtime.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s `readFile` / `writeFile`.
- `` Bun.$`ls` `` instead of `execa`.

### 6.2 Testing

```ts
// report.test.ts
import { test, expect } from "bun:test";

test("report serialization roundtrip", () => {
  expect(1).toBe(1);
});
```

---

## 7. Project Conventions

Pulled from the global CLAUDE.md and the ai-trip reference project.

### 7.1 Git

- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`).
- One concern per commit.

### 7.2 TypeScript

- Strict mode everywhere.
- Never use `any` to silence a type error.
- `as unknown as X` only when strictly necessary and justified in-line.
- API response types on the dashboard side are the source of truth — the SDK and dashboard UI import contract types from `packages/shared` rather than redeclaring them.

### 7.3 React/Vue Data Fetching

- Vue/Nuxt: use Nuxt's `useFetch` / `$fetch` — never `fetch` + raw `onMounted`.
- The SDK widget UI is Preact — any async state uses TanStack Query patterns or plain signals; no `fetch` in `useEffect` without a dedicated fetching layer.

### 7.4 Testing Discipline

- **TDD**: write the failing test first for any feature or bugfix, then implement.
- Unit tests live next to source (`foo.ts` + `foo.test.ts`).
- Dashboard integration tests hit a real Postgres (Docker), not a mock.

### 7.5 Framework-agnosticism (SDK)

- `packages/core`, `packages/ui`, `packages/annotator`, `packages/recorder`, `packages/collectors` MUST NOT import React, Vue, Svelte, or any host-facing framework.
- UI renders inside a Shadow DOM root so the host app's CSS can't leak in and the widget's CSS can't leak out.
- Optional thin wrappers (`@feedback/react`, `@feedback/vue`) may exist later as ergonomic shims — core must stay standalone.

### 7.6 Privacy & Security

- Sensitive-input masking on by default in the recorder.
- Configurable denylists for cookies, request headers, and response bodies.
- Intake API validates project key + origin; rate-limited per project.
- SDK interceptors (console/network) must be removable and fail-open — never break the host app.

---

## 8. Open Questions (Resolve Before Writing the Plan)

### SDK
1. **Preact vs Solid vs vanilla** — leaning Preact for DX. Lock it?
2. **Recorder format** — rrweb events, custom schema, or raw WebM via `MediaRecorder`?
3. **Bundle target** — does the 50kb gzipped goal hold once annotation + recorder ship?

### Dashboard
4. **Postgres driver in production** — **Resolved:** `pg` (node-postgres) via `drizzle-orm/node-postgres`. Nitro runs under Node.js, so Bun's native `bun:*` modules aren't available inside the dashboard server. Dev + prod both use `pg`.
5. **Blob storage adapter** — **Resolved:** local-disk + S3-compatible BYO are both shipped. No bundled S3 service — operators point `S3_ENDPOINT` at whatever they run (AWS S3, Cloudflare R2, Backblaze B2, Hetzner, MinIO, Garage, etc.). See `docs/superpowers/specs/2026-04-18-garage-s3-storage-design.md` for the pivot rationale.
6. **Multi-tenancy** — single workspace per deployment (simpler) or multi-workspace from day one?

### Cross-cutting
7. **Monorepo tool** — Bun workspaces alone, or add `turbo`/`nx` for task caching?
8. **Release strategy** — single version across SDK packages, or independent semver per package (changesets)?
9. **GitHub auth** — **Resolved:** GitHub App (via @octokit/auth-app) is shipped. See sub-project G (v0.6.0-github-sync).
10. **Direct-to-GitHub mode** — support SDK → GitHub without the dashboard in between? (Requires threat-model review.)

---

## 9. Next Steps

1. Resolve the open questions in §8 (brainstorming pass).
2. Write the implementation plan using `superpowers:writing-plans`. Sequence the highest-risk unknowns first:
   - Annotation canvas (design risk)
   - 30s DOM replay recorder (perf + privacy risk)
   - Intake API contract between SDK and dashboard (ripple risk)
3. Scaffold the monorepo end-to-end with a single trivial round-trip (`core` → `dashboard` intake → Postgres row → dashboard UI) before adding features. This proves the build + lint + test + migrate loop works across both worlds.
