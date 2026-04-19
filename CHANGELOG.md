# Changelog

## v0.1.0

Initial public release of Repro — the framework-agnostic embeddable feedback SDK plus self-hostable triage dashboard, published under the `@reprokit/*` npm scope.

### 🚀 Features

- **SDK** (`@reprokit/core`) — framework-agnostic init API, Shadow-DOM-isolated widget, keyboard shortcut, programmatic `open` / `close` / `identify` / `log`.
- **Screenshot capture + annotation canvas** — freehand pen, line, arrow, rectangle, text; undo / redo; flattened to PNG on submit.
- **30s rolling session replay** (`@reprokit/recorder`) — rrweb-compatible event stream, privacy masking (password fields, `data-repro-mask`).
- **Diagnostic context bundle** — console + network logs, cookies (denylisted), system info, custom breadcrumbs.
- **Dashboard** (`apps/dashboard`, Nuxt 4) — project management, ticket inbox with filters + facets, report triage drawer with replay player, assignee + priority + tags + status.
- **Intake API** — multipart upload, per-project origin allowlist, per-key + per-IP rate limits, honeypot + dwell-time anti-abuse, daily report cap.
- **Auth** — better-auth with magic-link + GitHub / Google OAuth; admin signup-gating.
- **GitHub Issues sync** (`@reprokit/integrations-github`) — GitHub App with one-click issue creation, two-way status sync via webhooks, background retry queue.
- **Blob storage** — pluggable adapter: local disk (default) or any S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, Hetzner, MinIO, Garage).
- **CI** — GitHub Actions gate: lint + format check, SDK tests, SDK IIFE build sanity check, dashboard integration tests against a real Postgres.

### 📦 Published packages

- `@reprokit/core` — SDK entry
- `@reprokit/ui` — widget UI (Preact + Shadow DOM)
- `@reprokit/recorder` — 30s rolling DOM replay buffer
- `@reprokit/shared` — contract types + Zod schemas
- `@reprokit/integrations-github` — GitHub Issues adapter

### 🔒 Security posture

- Origin allowlist enforced on every intake request; cross-origin scripts cannot read error bodies as an enumeration oracle for valid project keys.
- Session tokens validated server-side; auth endpoints rate-limited.
- HTTP response headers set via nuxt-security (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`).
- Sensitive-input masking on by default in the recorder.

### 🙏 Contributors

- JJ Teoh
