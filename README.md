<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/dashboard/public/icon-dark.svg">
    <img src="apps/dashboard/public/icon-light.svg" alt="Repro logo" width="128">
  </picture>

  <h1>Repro</h1>

  <p><strong>Framework-agnostic embeddable feedback SDK + self-hostable triage dashboard.</strong></p>

  <p>
    <a href="https://ripwords.github.io/reprokit/"><strong>Docs</strong></a> ·
    <a href="https://ripwords.github.io/reprokit/self-hosting/"><strong>Self-host</strong></a> ·
    <a href="https://ripwords.github.io/reprokit/guide/sdk"><strong>SDK</strong></a>
  </p>
</div>

---

Repro gives end users of any web app a one-click way to report bugs from the page — with an annotated screenshot, the last 30 seconds of session replay, and rich diagnostic context (console, network, cookies, system info) attached. Reports land in a self-hostable Nuxt dashboard where your team triages them, and optionally syncs them to GitHub Issues.

---

## Why Repro

- **Framework-agnostic SDK** — drop-in widget for vanilla JS, React, Vue, Svelte, Angular, Nuxt, Next.js. No peer-dependency on the host's framework.
- **Zero-config embed** — single `<script>` tag or `import { init } from "@reprokit/core"`. UI renders inside a Shadow DOM root so host styles can't leak in and vice-versa.
- **Rich context, collected automatically** — every report bundles an annotated screenshot, rrweb-style DOM replay of the last 30s, console + network logs, cookies, and system info.
- **Self-hostable end to end** — SDK, dashboard, and Postgres all run locally via Docker. Blob storage is a pluggable adapter (local disk by default; S3-compatible for AWS S3, R2, B2, Hetzner, MinIO, etc.).
- **GitHub-Issues sync** — one-click "create issue" on a report, with two-way status sync via GitHub App webhooks.

---

## Architecture

```
┌──────────────────────┐                 ┌────────────────────────────────┐
│   Host web app       │                 │   Repro Dashboard              │
│                      │   POST report   │   (Nuxt 4: Vue UI + Nitro API) │
│  ┌────────────────┐  │ ──────────────► │                                │
│  │ @reprokit/core │  │    multipart    │  /api/intake/*   (SDK ingress) │
│  │   SDK widget   │  │                 │  /api/tickets/*  (triage)      │
│  └────────────────┘  │                 │  /api/auth/*     (better-auth) │
└──────────────────────┘                 │  /api/integrations/github/*    │
                                         │                                │
                                         │  Postgres 17 ── Drizzle ORM    │
                                         │  Blob storage (local / S3)     │
                                         └────────────────────────────────┘
                                                         │
                                                         ▼
                                              GitHub Issues (optional)
```

Two first-class deliverables in one repo:

| Component | What it is | Who uses it |
| --- | --- | --- |
| **SDK** (`packages/*`) | Embeddable widget + framework-agnostic SDK | End users of whatever web app embeds Repro |
| **Dashboard** (`apps/dashboard`) | Admin / triage UI + intake API | Your team |

---

## Quick start (SDK)

> **Note**: packages are not yet published to npm. The examples below reflect the intended v0.1.0 install path.

### `<script>` tag

```html
<script src="https://your-dashboard.example.com/sdk/repro.iife.js" async></script>
<script>
  Repro.init({
    projectKey: "rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx",
    endpoint: "https://your-dashboard.example.com",
  })
</script>
```

### ESM / bundler

```bash
npm install @reprokit/core
```

```ts
import { init } from "@reprokit/core"

init({
  projectKey: "rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx",
  endpoint: "https://your-dashboard.example.com",
})
```

### Optional: identify the reporter

```ts
import { identify } from "@reprokit/core"

identify({
  userId: "user_123",
  email: "alex@example.com",
  name: "Alex Example",
})
```

Project keys are issued from the dashboard's project settings page. Each project has an origin allowlist — requests from any other origin are rejected and no CORS oracle is leaked.

---

## Quick start (self-host)

Prerequisites: Bun, Docker.

```bash
git clone https://github.com/Ripwords/reprokit.git
cd repro
bun install

# 1. Copy env template
cp .env.example .env
# Edit .env — at minimum set BETTER_AUTH_SECRET and ATTACHMENT_URL_SECRET
# (generate with `openssl rand -hex 32`)

# 2. Start Postgres
bun run dev:docker

# 3. Push the schema
bun run db:push

# 4. Start the dashboard
bun run dev
```

Dashboard is now at `http://localhost:3000`. Sign in with a magic link (prints to stdout when `MAIL_PROVIDER=console`), create a project, and you'll see a project key + embed snippets in **Project → Settings**.

For production deployment (Docker Compose with Caddy / Nginx reverse proxy, S3-compatible storage), see `docs/self-hosting/`.

---

## Monorepo layout

```
repro/
├── apps/
│   └── dashboard/              # Nuxt 4 — admin UI + intake API
├── packages/
│   ├── core/                   # @reprokit/core — SDK entry (init / open / identify)
│   ├── ui/                     # @reprokit/ui — widget UI (Preact + Shadow DOM)
│   ├── recorder/               # @reprokit/recorder — 30s rolling DOM replay
│   ├── shared/                 # @reprokit/shared — contract types + Zod schemas
│   └── integrations/
│       └── github/             # @reprokit/integrations-github — GitHub App adapter
├── scripts/
├── docs/
└── .github/workflows/          # CI
```

---

## Tech stack

| Concern | Choice |
| --- | --- |
| SDK runtime | TypeScript + Preact (tiny, React-like DX) inside Shadow DOM |
| SDK bundler | [tsdown](https://tsdown.dev) (ESM + IIFE) |
| Session replay | Hand-written rrweb-compatible event subset; dashboard replays via `rrweb-player` |
| Dashboard | Nuxt 4 (Vue 3 + Nitro server) |
| Database | PostgreSQL 17 + [Drizzle ORM](https://orm.drizzle.team) |
| Auth | [better-auth](https://better-auth.com) with magic-link + GitHub / Google OAuth |
| Blob storage | Pluggable — local disk (default) or any S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, Hetzner, MinIO, Garage) |
| Runtime / package manager | [Bun](https://bun.sh) |
| Lint + format | [oxlint](https://oxc.rs) + [oxfmt](https://oxc.rs) |

---

## Development

```bash
bun install               # install workspace
bun run dev:docker        # start Postgres
bun run db:push           # create schema
bun run dev               # start dashboard on :3000
bun run sdk:build         # build @reprokit/core IIFE + ESM bundles
bun run demo              # run the SDK demo playground on :4000
bun run check             # oxfmt --check + oxlint
bun run test              # run all tests (SDK + dashboard)
bun run test:sdk          # SDK tests only (no Postgres required)
```

### Releasing

Releases are driven by [changelogen](https://github.com/unjs/changelogen) from Conventional Commits.

```bash
bun run release           # patch (default)
bun run release:minor     # minor
bun run release:major     # major
bun run postrelease       # push tags to GitHub
```

The `prerelease` hook runs lint, format:check, SDK build, and SDK tests. CI runs the full gate (including the dashboard integration tests against a real Postgres) on every PR and push to `main`.

---

## Status

Repro is pre-1.0 and under active development. v0.1.0 marks the initial cut of the rebranded monorepo with a working end-to-end flow: SDK → intake API → dashboard triage → (optional) GitHub Issues sync.

No deployed production instance yet; the packages are not yet published on npm.

---

## License

MIT — see [LICENSE](./LICENSE).
