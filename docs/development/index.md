# Development

Contributor guide for working in the `reprojs` monorepo.

## Prereqs

- [Bun](https://bun.sh) 1.3+
- Docker + Docker Compose (for dev Postgres)
- Node is not required — bun is the runtime.

## First-time setup

```bash
git clone https://github.com/Ripwords/reprojs.git
cd reprojs
bun install
cp .env.example .env
# Uncomment the LOCAL DEVELOPMENT line and point DATABASE_URL at the dev Postgres:
# DATABASE_URL=postgres://postgres:postgres@localhost:5436/repro
```

Fill in the four required secrets in `.env` (see [Configuration](/self-hosting/configuration#required)). For local dev, `BETTER_AUTH_URL=http://localhost:3000` and `MAIL_PROVIDER=console` are fine.

## Starting the dev loop

```bash
bun run dev:docker   # starts the dev Postgres on :5436
bun run db:push      # syncs the schema from TS (dev uses push, not migrate)
bun run dev          # starts the dashboard on :3000 with HMR
```

The dashboard runs on `localhost:3000` with hot module reload. Magic-link URLs print to the terminal when `MAIL_PROVIDER=console`.

To stop Postgres without dropping data: `bun run dev:stop`. To reset the DB: `docker compose -f apps/dashboard/docker/docker-compose.dev.yml down -v` then `bun run db:push`.

## SDK development

```bash
bun run sdk:build    # builds packages/core — ESM + IIFE + .d.ts
bun run sdk:watch    # watches for SDK source changes
bun run demo         # runs the demo playground on :4000
```

The demo loads the freshly-built IIFE so you can exercise the widget against a real dashboard. Point it at your dev instance by editing `packages/ui/demo/index.html`'s `Repro.init({...})` call.

## Useful scripts

| Script             | What it does                                                     |
| ------------------ | ---------------------------------------------------------------- |
| `bun run dev`      | Dev server (Nuxt + HMR) on `:3000`                               |
| `bun run build`    | Production Nuxt build → `apps/dashboard/.output/`                |
| `bun run sdk:build`| Build the SDK bundles (ESM + IIFE + `.d.ts`)                     |
| `bun run demo`     | SDK demo playground on `:4000`                                   |
| `bun run check`    | `oxfmt --check` + `oxlint` — runs in CI                          |
| `bun run lint`     | oxlint only                                                       |
| `bun run fmt`      | oxfmt write                                                       |
| `bun run fix`      | `oxfmt --write` + `oxlint --fix`                                  |
| `bun run test`     | Full test suite (SDK + dashboard — needs dev server up)           |
| `bun run test:sdk` | SDK tests only — no Postgres / dev server required                |
| `bun run db:gen`   | Regenerate Drizzle migrations from schema changes                 |
| `bun run db:push`  | Sync schema directly (dev only — prod uses `migrate`)             |
| `bun run docs:dev` | VitePress docs dev server                                         |

## Testing

- **SDK tests** (`packages/*/*.test.ts`) — pure-JS, `bun test packages/`, no DB.
- **Dashboard tests** (`apps/dashboard/tests/`) — integration tests that POST to a real dev server + real Postgres. Start `bun run dev` in another terminal first, then `cd apps/dashboard && bun test tests/`.

The full `bun run test` runs both, so you need the dev server running.

### TDD convention

Write the failing test first, then the implementation. The project uses `bun:test` everywhere — no jest, no vitest for unit tests.

## Project conventions

- **TypeScript strict**. No `any` to silence a type error. `as unknown as X` only when strictly necessary and justified inline.
- **Conventional Commits**: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`. One concern per commit.
- **Contract types single-sourced** from `@reprojs/shared` — the SDK and dashboard UI both import from there rather than redeclaring.
- **No React/Vue/Svelte imports in SDK packages** — the widget is framework-agnostic. Only Preact inside a Shadow DOM.
- **Privacy-first replay** — masking defaults on; `data-repro-mask` / `data-repro-block` attributes on sensitive DOM nodes.

## Monorepo layout

```
reprojs/
├── apps/
│   └── dashboard/              # Nuxt 4 — admin UI + intake API
├── packages/
│   ├── core/                   # @reprojs/core — the published SDK
│   ├── ui/                     # widget UI (Preact + Shadow DOM)
│   ├── recorder/               # 30s rolling DOM replay
│   ├── shared/                 # contract types + Zod schemas
│   └── integrations/
│       └── github/             # GitHub App adapter
├── docs/                       # this site (VitePress)
├── .github/workflows/          # CI + Docker image publishing + docs deploy
└── compose.yaml                # self-host entry point
```

`@reprojs/core` bundles every workspace package at build time. The others stay private and exist as build inputs only — they're never published standalone.

## Releases

Releases are driven by [changelogen](https://github.com/unjs/changelogen) from Conventional Commits.

```bash
bun run release           # patch bump
bun run release:minor
bun run release:major
bun run postrelease       # push tags to GitHub
```

The `prerelease` hook runs lint, format:check, SDK build, and SDK tests. Pushing a `v*.*.*` tag triggers the `publish-docker` workflow which builds the multi-arch image and pushes to `reprojs/dashboard`.

## Where to file bugs / ideas

[github.com/Ripwords/reprojs/issues](https://github.com/Ripwords/reprojs/issues). PRs welcome.
