# Architecture

```
┌──────────────────────┐                 ┌────────────────────────────────┐
│   Host web app       │                 │   Repro Dashboard              │
│                      │   POST report   │   (Nuxt 4: Vue UI + Nitro API) │
│  ┌────────────────┐  │ ──────────────► │                                │
│  │ @reprojs/core │  │    multipart    │  /api/intake/*   (SDK ingress) │
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

## The two deliverables

| Component        | What it is                                  | Built with                                 |
| ---------------- | ------------------------------------------- | ------------------------------------------ |
| **SDK**          | Embeddable widget + framework-agnostic SDK  | TypeScript, Preact, Shadow DOM, tsdown     |
| **Dashboard**    | Admin / triage UI + intake API              | Nuxt 4 (Vue 3 + Nitro), Drizzle, Postgres |

## Runtime flow

1. End user clicks the floating launcher (or hits the shortcut) in your app.
2. SDK captures the viewport screenshot, flushes the 30-second replay buffer, and collects the diagnostic bundle (console logs, network logs, cookies, system info, custom breadcrumbs).
3. End user annotates the screenshot, writes a title/description, submits.
4. SDK POSTs a multipart `report` + `screenshot` + `logs` + `replay` to `/api/intake/reports` on the dashboard.
5. Dashboard validates the project key against the origin allowlist, stores the report in Postgres, uploads attachments to blob storage, and (if configured) enqueues a GitHub Issues sync.
6. Your team triages in the dashboard. Optional GitHub App bi-directionally syncs issue status.

## Tech stack

### SDK (`packages/*`)

| Concern         | Choice                                                    |
| --------------- | --------------------------------------------------------- |
| UI              | [Preact](https://preactjs.com) inside a Shadow DOM root  |
| Bundler         | [tsdown](https://tsdown.dev) — emits ESM + IIFE + types  |
| Session replay  | Hand-written rrweb-compatible event subset                |
| Screenshot      | `modern-screenshot` (dom-to-image derivative)             |
| Annotation      | Canvas 2D API, flattened to PNG on submit                 |

### Dashboard (`apps/dashboard`)

| Concern         | Choice                                                    |
| --------------- | --------------------------------------------------------- |
| Framework       | [Nuxt 4](https://nuxt.com) (Vue 3 + Nitro)                |
| Database        | PostgreSQL 17 + [Drizzle ORM](https://orm.drizzle.team)   |
| Auth            | [better-auth](https://better-auth.com) — magic-link + OAuth |
| Validation      | [Zod](https://zod.dev) at API boundaries                  |
| Styling         | [Tailwind CSS v4](https://tailwindcss.com) + [Nuxt UI](https://ui.nuxt.com) |
| Blob storage    | Pluggable adapter — local disk or any S3-compatible       |

### Shared tooling

- Runtime + package manager: [Bun](https://bun.sh)
- Lint + format: [oxlint](https://oxc.rs) + [oxfmt](https://oxc.rs)
- Unit tests: `bun test`
- Release: [changelogen](https://github.com/unjs/changelogen)

## Monorepo layout

```
reprojs/
├── apps/
│   └── dashboard/              # Nuxt 4 — admin UI + intake API
├── packages/
│   ├── core/                   # @reprojs/core — published SDK
│   ├── ui/                     # widget UI (Preact, Shadow DOM) — workspace-only
│   ├── recorder/               # 30s rolling DOM replay      — workspace-only
│   ├── shared/                 # contract types + Zod schemas — workspace-only
│   └── integrations/
│       └── github/             # GitHub App adapter           — workspace-only
├── docs/                       # this site
└── compose.yaml                # one-file self-host
```

The sub-packages under `packages/` are bundled into `@reprojs/core` at build time — consumers install one package and get the full SDK.
