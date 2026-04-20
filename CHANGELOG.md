# Changelog

## v0.1.4

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.3...v0.1.4)

### 🚀 Enhancements

- **dashboard:** Encryption foundation — AES-256-GCM helper + encryptedText column ([8f9d128](https://github.com/Ripwords/reprojs/commit/8f9d128))
- **dashboard:** Github_app singleton table + credential resolver with env→db fallback ([82e6f0b](https://github.com/Ripwords/reprojs/commit/82e6f0b))
- **github-integration:** Shared buildGithubAppManifest ([f7dff95](https://github.com/Ripwords/reprojs/commit/f7dff95))
- **dashboard:** GitHub App manifest wizard — start/callback routes, status API, admin UI ([170a2d9](https://github.com/Ripwords/reprojs/commit/170a2d9))

### 💅 Refactors

- **dashboard:** Make github.ts helpers async via credential resolver ([1bc0789](https://github.com/Ripwords/reprojs/commit/1bc0789))

### 📖 Documentation

- **self-hosting:** Document in-app GitHub App manifest wizard ([8dfdfee](https://github.com/Ripwords/reprojs/commit/8dfdfee))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.3

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.2...v0.1.3)

### 🏡 Chore

- **brand:** Rename @reprokit → @reprojs across npm + Docker + GitHub ([cdd9dc7](https://github.com/Ripwords/reprojs/commit/cdd9dc7))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.2

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.1...v0.1.2)

### 🤖 CI

- **docker:** Migrate from GHCR to Docker Hub (ripwords/reprojs-dashboard) ([54ffb9c](https://github.com/Ripwords/reprojs/commit/54ffb9c))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.1

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.0...v0.1.1)

### 🚀 Enhancements

- **dashboard:** Add session environment card to report overview ([83dc70d](https://github.com/Ripwords/reprojs/commit/83dc70d))
- **deploy:** One-file self-host via Docker + GHCR ([fa6adcb](https://github.com/Ripwords/reprojs/commit/fa6adcb))
- **docs:** Logo + flame/mist brand theming ([7253e6d](https://github.com/Ripwords/reprojs/commit/7253e6d))

### 🩹 Fixes

- **deploy:** Ship server/emails/ in the Docker image ([1611933](https://github.com/Ripwords/reprojs/commit/1611933))

### 📖 Documentation

- Update wiki + clone URLs to Ripwords/reprojs ([e9bffbb](https://github.com/Ripwords/reprojs/commit/e9bffbb))
- Update README ([904b78d](https://github.com/Ripwords/reprojs/commit/904b78d))
- VitePress site at ripwords.github.io/reprojs ([35a1eaa](https://github.com/Ripwords/reprojs/commit/35a1eaa))

### 📦 Build

- **sdk:** Make @reprojs/core a self-contained publishable package ([95d8992](https://github.com/Ripwords/reprojs/commit/95d8992))
- **deploy:** Healthcheck script in the image instead of inline shell ([a77a113](https://github.com/Ripwords/reprojs/commit/a77a113))

### 🤖 CI

- Wire dummy GitHub App env vars for webhook signature tests ([c2c5646](https://github.com/Ripwords/reprojs/commit/c2c5646))
- **docs:** Auto-enable Pages on first deploy ([24db132](https://github.com/Ripwords/reprojs/commit/24db132))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.0

Initial public release of Repro — the framework-agnostic embeddable feedback SDK plus self-hostable triage dashboard, published under the `@reprojs/*` npm scope.

### 🚀 Features

- **SDK** (`@reprojs/core`) — framework-agnostic init API, Shadow-DOM-isolated widget, keyboard shortcut, programmatic `open` / `close` / `identify` / `log`.
- **Screenshot capture + annotation canvas** — freehand pen, line, arrow, rectangle, text; undo / redo; flattened to PNG on submit.
- **30s rolling session replay** (`@reprojs/recorder`) — rrweb-compatible event stream, privacy masking (password fields, `data-repro-mask`).
- **Diagnostic context bundle** — console + network logs, cookies (denylisted), system info, custom breadcrumbs.
- **Dashboard** (`apps/dashboard`, Nuxt 4) — project management, ticket inbox with filters + facets, report triage drawer with replay player, assignee + priority + tags + status.
- **Intake API** — multipart upload, per-project origin allowlist, per-key + per-IP rate limits, honeypot + dwell-time anti-abuse, daily report cap.
- **Auth** — better-auth with magic-link + GitHub / Google OAuth; admin signup-gating.
- **GitHub Issues sync** (`@reprojs/integrations-github`) — GitHub App with one-click issue creation, two-way status sync via webhooks, background retry queue.
- **Blob storage** — pluggable adapter: local disk (default) or any S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, Hetzner, MinIO, Garage).
- **CI** — GitHub Actions gate: lint + format check, SDK tests, SDK IIFE build sanity check, dashboard integration tests against a real Postgres.

### 📦 Published packages

- `@reprojs/core` — SDK entry
- `@reprojs/ui` — widget UI (Preact + Shadow DOM)
- `@reprojs/recorder` — 30s rolling DOM replay buffer
- `@reprojs/shared` — contract types + Zod schemas
- `@reprojs/integrations-github` — GitHub Issues adapter

### 🔒 Security posture

- Origin allowlist enforced on every intake request; cross-origin scripts cannot read error bodies as an enumeration oracle for valid project keys.
- Session tokens validated server-side; auth endpoints rate-limited.
- HTTP response headers set via nuxt-security (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`).
- Sensitive-input masking on by default in the recorder.

### 🙏 Contributors

- JJ Teoh
