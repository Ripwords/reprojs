# Monorepo + Dashboard Skeleton — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable Bun-workspace monorepo with a Nuxt 4 dashboard that authenticates users via better-auth (email+password / GitHub / Google), enforces a two-tier role model (install `admin`/`member` + project `owner`/`developer`/`viewer`), and provides project CRUD, project-member management, install-admin-only user management with invite flow, and email delivery through `nodemailer` (Ethereal in dev, SMTP in prod).

**Architecture:** Single Nuxt 4 fullstack app under `apps/dashboard` mirroring the `ai-trip` layout (`app/` for Vue UI, `server/{api,db,lib,plugins}/` for Nitro). Postgres 17 in Docker via `docker-compose.dev.yml`, accessed through `Bun.sql` + `drizzle-orm/bun-sql`. Shared Zod schemas and inferred types live in `packages/shared`. Workspaces managed by Bun alone (no Turbo). Tooling: `oxlint`, `oxfmt`, `husky` pre-commit, `bun test`.

**Tech Stack:**
- **Runtime/Pkg manager:** Bun
- **Framework:** Nuxt 4 (Vue 3 + Nitro)
- **DB:** PostgreSQL 17 (Docker), `Bun.sql` + `drizzle-orm/bun-sql`, `drizzle-kit` migrations
- **Auth:** `better-auth` + `@better-auth/cli` (email+password + GitHub + Google, email verification)
- **Email:** `nodemailer` (Ethereal dev, SMTP prod)
- **Validation:** Zod
- **Styling:** Tailwind CSS v4
- **Lint/Format:** `oxlint` + `oxfmt`
- **Tests:** `bun test`

**Reference spec:** `docs/superpowers/specs/2026-04-17-monorepo-dashboard-skeleton-design.md`

---

## Phase 1 — Bootstrap

### Task 1: Initialize repo + root workspace config

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/.gitignore`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/package.json`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/bunfig.toml`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/.env.example`

- [ ] **Step 1: Initialize git**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && git init -b main`
Expected: `Initialized empty Git repository`

- [ ] **Step 2: Write `.gitignore`**

```gitignore
# Dependencies
node_modules/
.pnp
.pnp.js

# Build outputs
.nuxt/
.output/
.data/
dist/
build/

# Environment
.env
.env.*
!.env.example

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# IDE
.vscode/*
!.vscode/extensions.json
.idea/

# OS
.DS_Store
Thumbs.db

# Test outputs
coverage/

# Husky install marker
.husky/_
```

- [ ] **Step 3: Write root `package.json`**

```json
{
  "name": "feedback-tool",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun --filter dashboard dev",
    "dev:docker": "docker compose -f apps/dashboard/docker/docker-compose.dev.yml up -d",
    "dev:stop": "docker compose -f apps/dashboard/docker/docker-compose.dev.yml down",
    "build": "bun --filter dashboard build",
    "auth:gen": "cd apps/dashboard && bunx @better-auth/cli generate --config ./server/lib/auth.ts --output ./server/db/schema/auth-schema.ts -y",
    "db:gen": "bun run auth:gen && cd apps/dashboard && bunx drizzle-kit generate",
    "db:push": "bun run auth:gen && cd apps/dashboard && bunx drizzle-kit push",
    "db:migrate": "cd apps/dashboard && bunx drizzle-kit migrate",
    "lint": "oxlint",
    "lint:fix": "oxlint --fix",
    "fmt": "oxfmt --write .",
    "fmt:check": "oxfmt --check .",
    "check": "oxfmt --check . && oxlint",
    "test": "bun test",
    "prepare": "husky"
  },
  "devDependencies": {
    "husky": "^9.1.7",
    "oxfmt": "^0.44.0",
    "oxlint": "^1.59.0"
  }
}
```

- [ ] **Step 4: Write `bunfig.toml`**

```toml
[install]
# Keep dev tooling deterministic in CI
frozenLockfile = false

[test]
# Run tests serially by default so DB-backed integration tests don't stomp on each other
coverage = false
```

- [ ] **Step 5: Write `.env.example`**

```
# Postgres (matches docker-compose.dev.yml; port 5436 avoids clash with host Postgres on 5432)
DATABASE_URL=postgres://postgres:postgres@localhost:5436/feedback_tool

# better-auth
BETTER_AUTH_SECRET=replace-me-with-32-random-bytes
BETTER_AUTH_URL=http://localhost:3000

# OAuth providers (leave blank to hide the button on the sign-in page)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Email
MAIL_PROVIDER=ethereal
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Feedback Tool <no-reply@localhost>"
```

- [ ] **Step 6: Install root dev dependencies**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun install`
Expected: installs husky, oxlint, oxfmt; creates `bun.lock`.

- [ ] **Step 7: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add .gitignore package.json bunfig.toml .env.example bun.lock
git commit -m "chore: bootstrap bun monorepo"
```

---

### Task 2: Configure oxlint, oxfmt, and shared TypeScript config

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/.oxlintrc.json`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/.oxfmtrc.json`

- [ ] **Step 1: Write `.oxlintrc.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "import", "promise"],
  "categories": {
    "correctness": "error",
    "suspicious": "error",
    "perf": "warn",
    "style": "off"
  },
  "rules": {
    "no-console": "off",
    "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "warn"
  },
  "ignorePatterns": [
    "**/.nuxt/**",
    "**/.output/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/db/migrations/**",
    "**/auth-schema.ts"
  ]
}
```

- [ ] **Step 2: Write `.oxfmtrc.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxfmt/configuration_schema.json",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": false,
  "singleQuote": false,
  "trailingComma": "all",
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

- [ ] **Step 3: Verify oxlint runs**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun run lint`
Expected: `Found 0 warnings and 0 errors.` (nothing to lint yet.)

- [ ] **Step 4: Verify oxfmt runs**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun run fmt:check`
Expected: passes — no files to format yet.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add .oxlintrc.json .oxfmtrc.json
git commit -m "chore: configure oxlint and oxfmt"
```

---

### Task 3: Configure husky pre-commit hook

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/.husky/pre-commit`

- [ ] **Step 1: Initialize husky**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bunx husky init`
Expected: creates `.husky/` with a default `pre-commit`.

- [ ] **Step 2: Overwrite `.husky/pre-commit`**

```bash
#!/usr/bin/env sh
bun run fmt:check && bun run lint
```

- [ ] **Step 3: Make the hook executable**

Run: `chmod +x /Users/jiajingteoh/Documents/feedback-tool/.husky/pre-commit`

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add .husky/pre-commit package.json bun.lock
git commit -m "chore: add husky pre-commit hook running oxfmt and oxlint"
```

---

### Task 4: Create `packages/shared` placeholder

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/package.json`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/tsconfig.json`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/src/index.ts`

- [ ] **Step 1: Write `packages/shared/package.json`**

```json
{
  "name": "@feedback-tool/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "dependencies": {
    "zod": "^4.3.6"
  }
}
```

- [ ] **Step 2: Write `packages/shared/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `packages/shared/src/index.ts`**

```ts
// Re-exports go here as packages/shared grows.
// Populated in Task 14 with Zod schemas for Projects, Users, Settings.
export {}
```

- [ ] **Step 4: Install shared deps**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun install`
Expected: resolves workspace and installs `zod`.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/shared bun.lock package.json
git commit -m "chore: add packages/shared placeholder"
```

---

### Task 5: Scaffold Nuxt 4 dashboard

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/package.json`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/nuxt.config.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tsconfig.json`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/app.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/assets/css/tailwind.css`

- [ ] **Step 1: Create directory structure**

Run:
```bash
cd /Users/jiajingteoh/Documents/feedback-tool
mkdir -p apps/dashboard/app/{assets/css,components,composables,layouts,middleware,pages}
mkdir -p apps/dashboard/server/{api,db/schema,db/migrations,emails,lib,plugins}
```

- [ ] **Step 2: Write `apps/dashboard/package.json`**

```json
{
  "name": "dashboard",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nuxt dev --host",
    "build": "nuxt build",
    "preview": "nuxt preview",
    "postinstall": "nuxt prepare"
  },
  "dependencies": {
    "@feedback-tool/shared": "workspace:*",
    "@tailwindcss/vite": "^4.2.1",
    "better-auth": "^1.5.6",
    "drizzle-orm": "^0.45.2",
    "nodemailer": "^6.9.15",
    "nuxt": "^4.4.2",
    "tailwindcss": "^4.2.1",
    "vue": "^3.5.30",
    "vue-router": "^5.0.3",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@better-auth/cli": "^1.4.21",
    "@types/nodemailer": "^6.4.15",
    "drizzle-kit": "^0.31.0"
  }
}
```

- [ ] **Step 3: Write `apps/dashboard/nuxt.config.ts`**

```ts
import tailwindcss from "@tailwindcss/vite"

export default defineNuxtConfig({
  compatibilityDate: "2026-04-17",
  future: { compatibilityVersion: 5 },
  devtools: { enabled: process.env.NODE_ENV !== "production" },
  css: ["~/assets/css/tailwind.css"],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ["better-auth/vue", "better-auth/client/plugins"],
    },
  },
  runtimeConfig: {
    betterAuthSecret: process.env.BETTER_AUTH_SECRET ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
    mail: {
      provider: process.env.MAIL_PROVIDER ?? "ethereal",
      smtp: {
        host: process.env.SMTP_HOST ?? "",
        port: Number(process.env.SMTP_PORT ?? 587),
        user: process.env.SMTP_USER ?? "",
        pass: process.env.SMTP_PASS ?? "",
        from: process.env.SMTP_FROM ?? "Feedback Tool <no-reply@localhost>",
      },
    },
    public: {
      betterAuthUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
      hasGithubOAuth: !!process.env.GITHUB_CLIENT_ID,
      hasGoogleOAuth: !!process.env.GOOGLE_CLIENT_ID,
    },
  },
})
```

- [ ] **Step 4: Write `apps/dashboard/tsconfig.json`**

```json
{
  "extends": "./.nuxt/tsconfig.json"
}
```

- [ ] **Step 5: Write `apps/dashboard/app/app.vue`**

```vue
<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
```

- [ ] **Step 6: Write `apps/dashboard/app/assets/css/tailwind.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 7: Install dashboard deps**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun install`
Expected: resolves workspace, installs Nuxt and friends.

- [ ] **Step 8: Verify Nuxt boots**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && timeout 15 bun --filter dashboard dev --port 3000 || true`
Expected: Nuxt logs `Local: http://localhost:3000` before timeout. `timeout` kills it cleanly.

- [ ] **Step 9: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard package.json bun.lock
git commit -m "feat(dashboard): scaffold Nuxt 4 app with tailwind"
```

---

### Task 6: Postgres in Docker

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/docker/docker-compose.dev.yml`

- [ ] **Step 1: Write `apps/dashboard/docker/docker-compose.dev.yml`**

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: feedback_tool
    ports:
      - "5436:5432"
    volumes:
      - feedback_tool_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  feedback_tool_data:
```

- [ ] **Step 2: Start Postgres**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun run dev:docker`
Expected: container `dashboard-postgres-1` (or similar) is created and reports healthy.

- [ ] **Step 3: Verify Postgres is reachable**

Run: `docker exec $(docker ps --filter ancestor=postgres:17 -q) pg_isready -U postgres`
Expected: `/var/run/postgresql:5432 - accepting connections`

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/docker
git commit -m "chore(dashboard): add postgres 17 docker compose for local dev"
```

---

## Phase 2 — Database + Domain Schema

### Task 7: Drizzle client + configuration

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/drizzle.config.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/index.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/index.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/.env`

- [ ] **Step 1: Copy `.env.example` → `.env`**

Run: `cp /Users/jiajingteoh/Documents/feedback-tool/.env.example /Users/jiajingteoh/Documents/feedback-tool/.env`

Edit `.env` to set a real `BETTER_AUTH_SECRET`:

Run: `bun -e 'console.log(crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,"0"),""))'`

Copy the 64-char hex string into `.env` as `BETTER_AUTH_SECRET`.

- [ ] **Step 2: Write `apps/dashboard/drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema",
  out: "./server/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

- [ ] **Step 3: Write `apps/dashboard/server/db/index.ts`**

```ts
import { drizzle } from "drizzle-orm/bun-sql"
import { SQL } from "bun"
import * as schema from "./schema"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is required")

const client = new SQL(url)
export const db = drizzle(client, { schema })
export type DB = typeof db
```

- [ ] **Step 4: Write `apps/dashboard/server/db/schema/index.ts`**

```ts
// Barrel file — extended in Task 8 with projects, project_members, app_settings,
// and in Task 11 with the generated auth-schema.
export * from "./projects"
export * from "./project-members"
export * from "./app-settings"
```

- [ ] **Step 5: Verify Drizzle client boots without hitting DB**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun -e 'import("./apps/dashboard/server/db/index.ts").catch(e => { console.error(e); process.exit(1) })'`
Expected: Fails with `Error: Cannot find module './projects'` — expected because schema files don't exist yet. Confirms the loader is wired.

- [ ] **Step 6: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/drizzle.config.ts apps/dashboard/server/db .env.example
git commit -m "feat(db): add drizzle client using bun-sql"
```

> **Note:** `.env` is in `.gitignore`; it is intentionally NOT committed.

---

### Task 8: Domain schemas (`projects`, `project_members`, `app_settings`)

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/projects.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/project-members.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/db/schema/app-settings.ts`

- [ ] **Step 1: Write `apps/dashboard/server/db/schema/projects.ts`**

```ts
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const projects = pgTable(
  "projects",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    // Slug is unique only among live projects; soft-deleted slugs can be reused.
    slugActiveUnique: uniqueIndex("projects_slug_active_unique")
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  }),
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
```

- [ ] **Step 2: Write `apps/dashboard/server/db/schema/project-members.ts`**

```ts
import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { projects } from "./projects"

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["owner", "developer", "viewer"] }).notNull(),
    invitedBy: text("invited_by"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.userId] }),
  }),
)

export type ProjectMember = typeof projectMembers.$inferSelect
export type NewProjectMember = typeof projectMembers.$inferInsert
export type ProjectRole = ProjectMember["role"]
```

- [ ] **Step 3: Write `apps/dashboard/server/db/schema/app-settings.ts`**

```ts
import { sql } from "drizzle-orm"
import { boolean, check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"

export const appSettings = pgTable(
  "app_settings",
  {
    id: integer("id").primaryKey().default(1),
    signupGated: boolean("signup_gated").notNull().default(false),
    installName: text("install_name").notNull().default("Feedback Tool"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    singleton: check("app_settings_singleton", sql`${table.id} = 1`),
  }),
)

export type AppSettings = typeof appSettings.$inferSelect
```

- [ ] **Step 4: Commit (cannot run migrations yet — auth schema not generated)**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/db/schema
git commit -m "feat(db): add projects, project_members, app_settings schemas"
```

---

### Task 9: better-auth initial config + schema generation

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/auth.ts`

- [ ] **Step 1: Write initial `apps/dashboard/server/lib/auth.ts`**

This is a minimal config sufficient for schema generation. Hooks (bootstrap admin, gated signup) are added in Task 15 after the generated schema exists and helpers are in place.

```ts
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db } from "../db"

const socialProviders: Record<string, unknown> = {}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  }
}
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  socialProviders,
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "member", input: false },
      status: { type: "string", defaultValue: "active", input: false },
      inviteToken: { type: "string", defaultValue: null, input: false },
      inviteTokenExpiresAt: { type: "date", defaultValue: null, input: false },
    },
  },
})

export type Auth = typeof auth
```

- [ ] **Step 2: Temporarily stub schema barrel so generation can read it**

The barrel file imports `./auth-schema` which doesn't exist yet. Remove it temporarily, then restore after generation.

Edit `apps/dashboard/server/db/schema/index.ts` to comment out the future auth line (not present yet — current content has no auth-schema reference). Leave as is for now.

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun run auth:gen`
Expected: creates `apps/dashboard/server/db/schema/auth-schema.ts` with `user`, `session`, `account`, `verification` tables (plus the four additional fields on `user`).

- [ ] **Step 3: Re-export auth schema from barrel**

Edit `apps/dashboard/server/db/schema/index.ts`:

```ts
export * from "./auth-schema"
export * from "./projects"
export * from "./project-members"
export * from "./app-settings"
```

- [ ] **Step 4: Generate the initial migration**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && cd apps/dashboard && bunx drizzle-kit generate --name init`
Expected: writes `server/db/migrations/0000_init.sql` (or similar) and a `meta/_journal.json` entry.

- [ ] **Step 5: Apply the migration**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun run db:migrate`
Expected: applies the migration; Postgres now has the `user`, `session`, `account`, `verification`, `projects`, `project_members`, `app_settings` tables.

- [ ] **Step 6: Verify tables exist**

Run: `docker exec $(docker ps --filter ancestor=postgres:17 -q) psql -U postgres -d feedback_tool -c "\dt"`
Expected output includes `app_settings`, `project_members`, `projects`, `user`, `session`, `account`, `verification`, `__drizzle_migrations`.

- [ ] **Step 7: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/auth.ts apps/dashboard/server/db/schema/auth-schema.ts apps/dashboard/server/db/schema/index.ts apps/dashboard/server/db/migrations
git commit -m "feat(auth): add better-auth config and generate initial schema"
```

---

### Task 10: Nitro plugin to seed `app_settings` singleton

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/plugins/00.seed-settings.ts`

- [ ] **Step 1: Write the plugin**

```ts
import { sql } from "drizzle-orm"
import { db } from "../db"
import { appSettings } from "../db/schema"

export default defineNitroPlugin(async () => {
  // Insert singleton row if missing. ON CONFLICT makes this idempotent.
  await db
    .insert(appSettings)
    .values({ id: 1 })
    .onConflictDoNothing({ target: appSettings.id })
  console.info("[seed-settings] app_settings singleton ensured")
})
```

- [ ] **Step 2: Verify the plugin runs on boot**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && timeout 10 bun --filter dashboard dev --port 3000 || true`
Expected: Nuxt logs `[seed-settings] app_settings singleton ensured` before timing out.

- [ ] **Step 3: Verify the row exists**

Run: `docker exec $(docker ps --filter ancestor=postgres:17 -q) psql -U postgres -d feedback_tool -c "SELECT * FROM app_settings"`
Expected: one row with `id=1, signup_gated=false, install_name='Feedback Tool'`.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/plugins/00.seed-settings.ts
git commit -m "feat(db): seed app_settings singleton on boot"
```

---

## Phase 3 — Helpers (TDD)

### Task 11: `lib/slug.ts` with tests

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/slug.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/slug.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/server/lib/slug.test.ts
import { describe, expect, test } from "bun:test"
import { slugify } from "./slug"

describe("slugify", () => {
  test("lowercases and replaces spaces with dashes", () => {
    expect(slugify("Hello World")).toBe("hello-world")
  })
  test("collapses multiple separators", () => {
    expect(slugify("  Foo   Bar  ")).toBe("foo-bar")
    expect(slugify("foo--bar")).toBe("foo-bar")
  })
  test("strips non-alphanumeric characters", () => {
    expect(slugify("Foo@Bar!")).toBe("foobar")
    expect(slugify("日本語 project")).toBe("project")
  })
  test("truncates to 64 chars at a word boundary", () => {
    const long = "a".repeat(80)
    expect(slugify(long).length).toBeLessThanOrEqual(64)
  })
  test("returns a fallback for empty input", () => {
    expect(slugify("")).toMatch(/^project-[a-z0-9]{6}$/)
    expect(slugify("!!!")).toMatch(/^project-[a-z0-9]{6}$/)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test server/lib/slug.test.ts`
Expected: FAIL — `Cannot find module "./slug"`.

- [ ] **Step 3: Implement `slug.ts`**

```ts
// apps/dashboard/server/lib/slug.ts
const MAX_LEN = 64

export function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  if (!cleaned) {
    const suffix = Math.random().toString(36).slice(2, 8)
    return `project-${suffix}`
  }

  if (cleaned.length <= MAX_LEN) return cleaned

  const truncated = cleaned.slice(0, MAX_LEN)
  const lastDash = truncated.lastIndexOf("-")
  return lastDash > 20 ? truncated.slice(0, lastDash) : truncated
}
```

- [ ] **Step 4: Re-run tests and confirm they pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test server/lib/slug.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/slug.ts apps/dashboard/server/lib/slug.test.ts
git commit -m "feat(lib): add slugify helper with tests"
```

---

### Task 12: `lib/render-template.ts` + email templates + tests

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/render-template.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/render-template.test.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/emails/verify-email.html`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/emails/invite.html`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/server/lib/render-template.test.ts
import { describe, expect, test } from "bun:test"
import { renderTemplate } from "./render-template"

describe("renderTemplate", () => {
  test("substitutes {{var}} placeholders", async () => {
    const out = await renderTemplate("__test_inline", { name: "Alice", url: "https://x/y" }, {
      inline: "<p>Hi {{name}}, click {{url}}</p>",
    })
    expect(out).toBe("<p>Hi Alice, click https://x/y</p>")
  })

  test("leaves unknown placeholders untouched", async () => {
    const out = await renderTemplate("__test_inline", { name: "Bob" }, {
      inline: "<p>{{name}} / {{missing}}</p>",
    })
    expect(out).toBe("<p>Bob / {{missing}}</p>")
  })

  test("escapes HTML in interpolated values", async () => {
    const out = await renderTemplate("__test_inline", { name: "<script>x</script>" }, {
      inline: "<p>{{name}}</p>",
    })
    expect(out).toBe("<p>&lt;script&gt;x&lt;/script&gt;</p>")
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test server/lib/render-template.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `render-template.ts`**

```ts
// apps/dashboard/server/lib/render-template.ts
import { readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "emails")

const cache = new Map<string, string>()

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export async function renderTemplate(
  name: string,
  vars: Record<string, string>,
  opts?: { inline?: string },
): Promise<string> {
  let source = opts?.inline
  if (source === undefined) {
    const cached = cache.get(name)
    if (cached !== undefined) {
      source = cached
    } else {
      source = await readFile(join(TEMPLATE_DIR, `${name}.html`), "utf8")
      cache.set(name, source)
    }
  }

  return source.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, key) => {
    const val = vars[key]
    return val === undefined ? match : escapeHtml(val)
  })
}
```

- [ ] **Step 4: Re-run tests and confirm they pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test server/lib/render-template.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Write `server/emails/verify-email.html`**

```html
<!doctype html>
<html>
  <body style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
    <h2>Verify your email</h2>
    <p>Hi {{name}},</p>
    <p>Thanks for signing up. Click the link below to verify your email address:</p>
    <p><a href="{{url}}" style="display:inline-block;padding:12px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Verify email</a></p>
    <p>If you didn't sign up, you can safely ignore this email.</p>
  </body>
</html>
```

- [ ] **Step 6: Write `server/emails/invite.html`**

```html
<!doctype html>
<html>
  <body style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
    <h2>You've been invited to {{installName}}</h2>
    <p>Hi,</p>
    <p>{{inviterName}} invited you to join {{installName}}. Click the link below to complete your account setup:</p>
    <p><a href="{{url}}" style="display:inline-block;padding:12px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Accept invite</a></p>
    <p>This invitation expires on {{expiresAt}}.</p>
  </body>
</html>
```

- [ ] **Step 7: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/render-template.ts apps/dashboard/server/lib/render-template.test.ts apps/dashboard/server/emails
git commit -m "feat(lib): add renderTemplate helper and email templates"
```

---

### Task 13: `lib/email.ts` with nodemailer + ethereal

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/email.ts`

- [ ] **Step 1: Write `email.ts`**

No TDD for this helper — it wraps external I/O (nodemailer + Ethereal) that isn't worth mocking. Smoke-tested live in the manual run.

```ts
// apps/dashboard/server/lib/email.ts
import nodemailer, { type Transporter } from "nodemailer"

type MailProvider = "ethereal" | "smtp"

interface MailConfig {
  provider: MailProvider
  from: string
  smtp?: {
    host: string
    port: number
    user: string
    pass: string
  }
}

let transporter: Transporter | null = null
let resolvedFrom = ""

async function getTransporter(): Promise<Transporter> {
  if (transporter) return transporter

  const cfg = loadConfig()
  resolvedFrom = cfg.from

  if (cfg.provider === "smtp") {
    if (!cfg.smtp) throw new Error("SMTP provider requires SMTP_* env vars")
    transporter = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: cfg.smtp.port === 465,
      auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
    })
    return transporter
  }

  // Ethereal: throwaway account for dev.
  try {
    const account = await nodemailer.createTestAccount()
    transporter = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.user, pass: account.pass },
    })
    console.info(`[email] Ethereal account created: ${account.user}`)
    return transporter
  } catch (err) {
    console.warn(`[email] Ethereal unavailable, falling back to JSON transport:`, err)
    transporter = nodemailer.createTransport({ jsonTransport: true })
    return transporter
  }
}

function loadConfig(): MailConfig {
  const provider = (process.env.MAIL_PROVIDER ?? "ethereal") as MailProvider
  const from = process.env.SMTP_FROM ?? "Feedback Tool <no-reply@localhost>"
  if (provider === "smtp") {
    return {
      provider,
      from,
      smtp: {
        host: process.env.SMTP_HOST ?? "",
        port: Number(process.env.SMTP_PORT ?? 587),
        user: process.env.SMTP_USER ?? "",
        pass: process.env.SMTP_PASS ?? "",
      },
    }
  }
  return { provider: "ethereal", from }
}

export interface SendMailOpts {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendMail(opts: SendMailOpts): Promise<void> {
  const t = await getTransporter()
  const info = await t.sendMail({
    from: resolvedFrom,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text ?? stripHtml(opts.html),
  })

  const preview = nodemailer.getTestMessageUrl(info)
  if (preview) {
    console.info(`[email] preview: ${preview}`)
  } else if ("message" in info && typeof info.message === "string") {
    console.info(`[email] jsonTransport captured:\n${info.message}`)
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
}
```

- [ ] **Step 2: Smoke-test via a one-off script**

Run:
```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun -e 'import("./apps/dashboard/server/lib/email.ts").then(m => m.sendMail({ to: "test@example.com", subject: "Test", html: "<p>Hello</p>" }))'
```
Expected: logs `[email] Ethereal account created: ...` then `[email] preview: https://ethereal.email/message/...`. No errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/email.ts
git commit -m "feat(lib): add sendMail helper with nodemailer + ethereal"
```

---

### Task 14: `lib/permissions.ts` with tests

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/permissions.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/server/lib/permissions.test.ts
import { describe, expect, test } from "bun:test"
import { compareRole, type ProjectRoleName } from "./permissions"

describe("compareRole", () => {
  const roles: ProjectRoleName[] = ["viewer", "developer", "owner"]

  test("owner satisfies all minimums", () => {
    for (const min of roles) {
      expect(compareRole("owner", min)).toBe(true)
    }
  })

  test("developer satisfies developer and viewer, not owner", () => {
    expect(compareRole("developer", "viewer")).toBe(true)
    expect(compareRole("developer", "developer")).toBe(true)
    expect(compareRole("developer", "owner")).toBe(false)
  })

  test("viewer satisfies only viewer", () => {
    expect(compareRole("viewer", "viewer")).toBe(true)
    expect(compareRole("viewer", "developer")).toBe(false)
    expect(compareRole("viewer", "owner")).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test server/lib/permissions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `permissions.ts`**

```ts
// apps/dashboard/server/lib/permissions.ts
import { and, eq } from "drizzle-orm"
import type { H3Event } from "h3"
import { createError } from "h3"
import { db } from "../db"
import { projectMembers, user } from "../db/schema"
import { auth } from "./auth"

export type ProjectRoleName = "viewer" | "developer" | "owner"

const ROLE_RANK: Record<ProjectRoleName, number> = {
  viewer: 1,
  developer: 2,
  owner: 3,
}

export function compareRole(actual: ProjectRoleName, min: ProjectRoleName): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[min]
}

export interface AppSession {
  userId: string
  email: string
  role: "admin" | "member"
  status: "active" | "invited" | "disabled"
}

export async function requireSession(event: H3Event): Promise<AppSession> {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" })
  }
  const u = session.user as AppSession & { id: string }
  if (u.status === "disabled") {
    throw createError({ statusCode: 403, statusMessage: "Account disabled" })
  }
  return {
    userId: u.id,
    email: u.email,
    role: u.role,
    status: u.status,
  }
}

export async function requireInstallAdmin(event: H3Event): Promise<AppSession> {
  const session = await requireSession(event)
  if (session.role !== "admin") {
    throw createError({ statusCode: 403, statusMessage: "Admin only" })
  }
  return session
}

export async function requireProjectRole(
  event: H3Event,
  projectId: string,
  min: ProjectRoleName,
): Promise<{ session: AppSession; effectiveRole: ProjectRoleName }> {
  const session = await requireSession(event)
  if (session.role === "admin") {
    return { session, effectiveRole: "owner" }
  }
  const [member] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, session.userId)))
  if (!member) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" })
  }
  if (!compareRole(member.role as ProjectRoleName, min)) {
    throw createError({ statusCode: 403, statusMessage: "Insufficient role" })
  }
  return { session, effectiveRole: member.role as ProjectRoleName }
}
```

- [ ] **Step 4: Re-run unit tests and confirm they pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test server/lib/permissions.test.ts`
Expected: all 3 `compareRole` tests PASS. (The H3/DB-backed functions are tested via API integration tests in Tasks 16–19.)

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/permissions.ts apps/dashboard/server/lib/permissions.test.ts
git commit -m "feat(lib): add permission helpers with role compare tests"
```

---

## Phase 4 — Auth wiring + shared contracts

### Task 15: Auth handler route + `/api/me` + full hooks

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/auth/[...].ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/me.get.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/lib/auth.ts`

- [ ] **Step 1: Update `auth.ts` with full hooks and email wiring**

Replace the contents of `apps/dashboard/server/lib/auth.ts` with:

```ts
import { and, count, eq } from "drizzle-orm"
import { APIError, betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db } from "../db"
import { appSettings, user } from "../db/schema"
import { renderTemplate } from "./render-template"
import { sendMail } from "./email"

const socialProviders: Record<string, unknown> = {}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  }
}
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user: u, url }) => {
      const html = await renderTemplate("verify-email", {
        name: u.name ?? u.email,
        url,
      })
      await sendMail({
        to: u.email,
        subject: "Verify your email",
        html,
      })
    },
  },
  socialProviders,
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "member", input: false },
      status: { type: "string", defaultValue: "active", input: false },
      inviteToken: { type: "string", defaultValue: null, input: false },
      inviteTokenExpiresAt: { type: "date", defaultValue: null, input: false },
    },
  },
  hooks: {
    before: {
      "sign-up": async (ctx) => {
        const email = ctx.body?.email as string | undefined
        if (!email) return
        const [settings] = await db.select().from(appSettings).limit(1)
        if (!settings?.signupGated) return
        const [invited] = await db
          .select()
          .from(user)
          .where(and(eq(user.email, email), eq(user.status, "invited")))
        if (!invited) {
          throw new APIError("FORBIDDEN", { message: "Signup is invite-only" })
        }
      },
    },
    after: {
      "sign-up": async (ctx) => {
        const newUserId = (ctx.context?.newSession?.user?.id ?? ctx.context?.user?.id) as
          | string
          | undefined
        if (!newUserId) return
        const [{ c }] = await db.select({ c: count() }).from(user)
        await db
          .update(user)
          .set({
            role: c === 1 ? "admin" : undefined,
            status: "active",
            inviteToken: null,
            inviteTokenExpiresAt: null,
          })
          .where(eq(user.id, newUserId))
      },
    },
  },
})

export type Auth = typeof auth
```

- [ ] **Step 2: Write `server/api/auth/[...].ts`**

```ts
import { auth } from "../../lib/auth"

export default defineEventHandler(async (event) => {
  return auth.handler(toWebRequest(event))
})
```

- [ ] **Step 3: Write `server/api/me.get.ts`**

```ts
import { requireSession } from "../lib/permissions"

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  return {
    userId: session.userId,
    email: session.email,
    role: session.role,
    status: session.status,
    isAdmin: session.role === "admin",
  }
})
```

- [ ] **Step 4: Start dashboard and hit `/api/me` unauthenticated**

Run in one terminal:
```bash
cd /Users/jiajingteoh/Documents/feedback-tool && bun run dev:docker && bun run dev
```

In another terminal:
```bash
curl -i http://localhost:3000/api/me
```
Expected: HTTP 401 `Unauthenticated`.

- [ ] **Step 5: Sign up a user via the API and confirm verification email is logged**

```bash
curl -i -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"Password123!","name":"Admin"}'
```
Expected: HTTP 200, and the dev server logs `[email] preview: https://ethereal.email/...`.

- [ ] **Step 6: Verify the first user was promoted to admin**

Run: `docker exec $(docker ps --filter ancestor=postgres:17 -q) psql -U postgres -d feedback_tool -c "SELECT email, role, status FROM \"user\""`
Expected: `admin@example.com | admin | active` (plus `email_verified=false` until the link is clicked).

- [ ] **Step 7: Stop dev server. Commit.**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/auth.ts apps/dashboard/server/api/auth apps/dashboard/server/api/me.get.ts
git commit -m "feat(auth): wire better-auth handler, /api/me, hooks, and email verification"
```

---

### Task 16: Shared Zod schemas in `packages/shared`

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/src/projects.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/src/users.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/src/settings.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/src/index.ts`

- [ ] **Step 1: Write `src/projects.ts`**

```ts
// packages/shared/src/projects.ts
import { z } from "zod"

export const ProjectRole = z.enum(["viewer", "developer", "owner"])
export type ProjectRole = z.infer<typeof ProjectRole>

export const ProjectDTO = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  effectiveRole: ProjectRole,
})
export type ProjectDTO = z.infer<typeof ProjectDTO>

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(80),
})
export type CreateProjectInput = z.infer<typeof CreateProjectInput>

export const UpdateProjectInput = z.object({
  name: z.string().min(1).max(80).optional(),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9](-?[a-z0-9])*$/, "Slug must be lowercase alphanumeric with dashes")
    .optional(),
})
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>

export const ProjectMemberDTO = z.object({
  userId: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: ProjectRole,
  joinedAt: z.string(),
})
export type ProjectMemberDTO = z.infer<typeof ProjectMemberDTO>

export const AddProjectMemberInput = z.object({
  email: z.string().email(),
  role: ProjectRole,
})
export type AddProjectMemberInput = z.infer<typeof AddProjectMemberInput>

export const UpdateProjectMemberInput = z.object({
  role: ProjectRole,
})
export type UpdateProjectMemberInput = z.infer<typeof UpdateProjectMemberInput>
```

- [ ] **Step 2: Write `src/users.ts`**

```ts
// packages/shared/src/users.ts
import { z } from "zod"

export const InstallRole = z.enum(["admin", "member"])
export type InstallRole = z.infer<typeof InstallRole>

export const UserStatus = z.enum(["invited", "active", "disabled"])
export type UserStatus = z.infer<typeof UserStatus>

export const UserDTO = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: InstallRole,
  status: UserStatus,
  emailVerified: z.boolean(),
  createdAt: z.string(),
})
export type UserDTO = z.infer<typeof UserDTO>

export const InviteUserInput = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  role: InstallRole.default("member"),
})
export type InviteUserInput = z.infer<typeof InviteUserInput>

export const UpdateUserInput = z.object({
  role: InstallRole.optional(),
  status: UserStatus.optional(),
})
export type UpdateUserInput = z.infer<typeof UpdateUserInput>

export const AcceptInviteInput = z.object({
  token: z.string().min(10),
  password: z.string().min(8).max(120),
})
export type AcceptInviteInput = z.infer<typeof AcceptInviteInput>
```

- [ ] **Step 3: Write `src/settings.ts`**

```ts
// packages/shared/src/settings.ts
import { z } from "zod"

export const AppSettingsDTO = z.object({
  signupGated: z.boolean(),
  installName: z.string(),
  updatedAt: z.string(),
})
export type AppSettingsDTO = z.infer<typeof AppSettingsDTO>

export const UpdateAppSettingsInput = z.object({
  signupGated: z.boolean().optional(),
  installName: z.string().min(1).max(80).optional(),
})
export type UpdateAppSettingsInput = z.infer<typeof UpdateAppSettingsInput>
```

- [ ] **Step 4: Update `src/index.ts`**

```ts
// packages/shared/src/index.ts
export * from "./projects"
export * from "./users"
export * from "./settings"
```

- [ ] **Step 5: Verify TS compiles from dashboard**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun --bun x tsc --noEmit -p tsconfig.json || bunx nuxi prepare`
Expected: no errors referencing `@feedback-tool/shared`.

- [ ] **Step 6: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/shared/src
git commit -m "feat(shared): add zod schemas and DTOs for projects, users, settings"
```

---

## Phase 5 — API endpoints (integration tested)

> **Test strategy for API tasks below:** each endpoint group gets one integration test file under `apps/dashboard/tests/api/<group>.test.ts` using `@nuxt/test-utils`'s `setup` + `$fetch`. Tests hit the real Postgres running in Docker, and each test truncates the affected tables before running. The `happy path`, `auth rejection`, `role rejection`, and critical guards (last-owner, last-admin) get explicit tests; exhaustive validation coverage is deferred.

### Task 17: `/api/projects` CRUD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/index.get.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/index.post.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/index.get.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/index.patch.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/index.delete.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/helpers.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/api/projects.test.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/package.json` (add `@nuxt/test-utils`, `playwright-core`)

- [ ] **Step 1: Add test deps**

Edit `apps/dashboard/package.json` `devDependencies`:

```json
"@nuxt/test-utils": "^3.14.0",
"playwright-core": "^1.47.0"
```

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun install`

- [ ] **Step 2: Write test helpers `tests/helpers.ts`**

```ts
// apps/dashboard/tests/helpers.ts
import { sql } from "drizzle-orm"
import { db } from "../server/db"

export async function truncateDomain() {
  await db.execute(sql`TRUNCATE project_members, projects, "account", "session", "verification", "user" RESTART IDENTITY CASCADE`)
  await db.execute(sql`UPDATE app_settings SET signup_gated = false, install_name = 'Feedback Tool' WHERE id = 1`)
}

export async function createUser(email: string, role: "admin" | "member" = "member"): Promise<string> {
  const res = await $fetch("/api/auth/sign-up/email", {
    method: "POST",
    body: { email, password: "Password123!", name: email.split("@")[0] },
  })
  // Mark verified and set role directly (tests bypass the email click)
  await db.execute(
    sql`UPDATE "user" SET email_verified = true, role = ${role} WHERE email = ${email}`,
  )
  return res.user?.id ?? ""
}

export async function signIn(email: string): Promise<string> {
  const res = await fetch("http://localhost:3000/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  })
  const cookie = res.headers.get("set-cookie") ?? ""
  return cookie
}
```

- [ ] **Step 3: Write the failing test**

```ts
// apps/dashboard/tests/api/projects.test.ts
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { createUser, signIn, truncateDomain } from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })

describe("projects API", () => {
  afterEach(async () => { await truncateDomain() })

  test("POST /api/projects requires auth", async () => {
    const res = await fetch("http://localhost:3000/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    })
    expect(res.status).toBe(401)
  })

  test("admin can create, list, and delete a project", async () => {
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    const created = await $fetch("/api/projects", {
      method: "POST",
      body: { name: "My Project" },
      headers: { cookie },
    })
    expect(created.name).toBe("My Project")
    expect(created.slug).toBe("my-project")
    expect(created.effectiveRole).toBe("owner")

    const list = await $fetch("/api/projects", { headers: { cookie } })
    expect(list.length).toBe(1)

    await $fetch(`/api/projects/${created.id}`, { method: "DELETE", headers: { cookie } })

    const afterDelete = await $fetch("/api/projects", { headers: { cookie } })
    expect(afterDelete.length).toBe(0)
  })

  test("non-admin member only sees projects they belong to", async () => {
    await createUser("admin@example.com", "admin")
    await createUser("member@example.com", "member")
    const adminCookie = await signIn("admin@example.com")
    const memberCookie = await signIn("member@example.com")

    await $fetch("/api/projects", {
      method: "POST",
      body: { name: "Admin Only" },
      headers: { cookie: adminCookie },
    })

    const memberList = await $fetch("/api/projects", { headers: { cookie: memberCookie } })
    expect(memberList.length).toBe(0)
  })
})
```

- [ ] **Step 4: Run test and confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/projects.test.ts`
Expected: FAIL — endpoints not implemented yet.

- [ ] **Step 5: Implement `server/api/projects/index.get.ts`**

```ts
import { and, desc, eq, isNull } from "drizzle-orm"
import type { ProjectDTO } from "@feedback-tool/shared"
import { db } from "../../db"
import { projectMembers, projects } from "../../db/schema"
import { requireSession } from "../../lib/permissions"

export default defineEventHandler(async (event): Promise<ProjectDTO[]> => {
  const session = await requireSession(event)

  const rows = session.role === "admin"
    ? await db
        .select({
          id: projects.id,
          name: projects.name,
          slug: projects.slug,
          createdBy: projects.createdBy,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          role: projects.id, // placeholder — overwritten below
        })
        .from(projects)
        .where(isNull(projects.deletedAt))
        .orderBy(desc(projects.createdAt))
    : await db
        .select({
          id: projects.id,
          name: projects.name,
          slug: projects.slug,
          createdBy: projects.createdBy,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          role: projectMembers.role,
        })
        .from(projects)
        .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
        .where(and(eq(projectMembers.userId, session.userId), isNull(projects.deletedAt)))
        .orderBy(desc(projects.createdAt))

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    effectiveRole: (session.role === "admin" ? "owner" : (r.role as "viewer" | "developer" | "owner")),
  }))
})
```

- [ ] **Step 6: Implement `server/api/projects/index.post.ts`**

```ts
import { CreateProjectInput } from "@feedback-tool/shared"
import { db } from "../../db"
import { projectMembers, projects } from "../../db/schema"
import { requireSession } from "../../lib/permissions"
import { slugify } from "../../lib/slug"

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const body = await readValidatedBody(event, (b) => CreateProjectInput.parse(b))

  const baseSlug = slugify(body.name)
  let slug = baseSlug
  let suffix = 1
  while (
    (
      await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).limit(1)
    ).length > 0
  ) {
    slug = `${baseSlug}-${suffix++}`
  }

  const [created] = await db
    .insert(projects)
    .values({ name: body.name, slug, createdBy: session.userId })
    .returning()

  // Admin users are implicit owners. Only non-admin creators get a project_members row.
  if (session.role !== "admin") {
    await db.insert(projectMembers).values({
      projectId: created.id,
      userId: session.userId,
      role: "owner",
    })
  }

  return {
    id: created.id,
    name: created.name,
    slug: created.slug,
    createdBy: created.createdBy,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    effectiveRole: "owner" as const,
  }
})
```

At top of file, also add:

```ts
import { eq } from "drizzle-orm"
```

- [ ] **Step 7: Implement `server/api/projects/[id]/index.get.ts`**

```ts
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { projects } from "../../../db/schema"
import { requireProjectRole } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!
  const { effectiveRole } = await requireProjectRole(event, id, "viewer")

  const [p] = await db.select().from(projects).where(eq(projects.id, id))
  if (!p || p.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" })
  }

  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    effectiveRole,
  }
})
```

- [ ] **Step 8: Implement `server/api/projects/[id]/index.patch.ts`**

```ts
import { eq } from "drizzle-orm"
import { UpdateProjectInput } from "@feedback-tool/shared"
import { db } from "../../../db"
import { projects } from "../../../db/schema"
import { requireProjectRole } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!
  await requireProjectRole(event, id, "owner")
  const body = await readValidatedBody(event, (b) => UpdateProjectInput.parse(b))

  const [updated] = await db
    .update(projects)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning()

  return {
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    createdBy: updated.createdBy,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    effectiveRole: "owner" as const,
  }
})
```

- [ ] **Step 9: Implement `server/api/projects/[id]/index.delete.ts`**

```ts
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { projects } from "../../../db/schema"
import { requireProjectRole } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!
  await requireProjectRole(event, id, "owner")

  await db
    .update(projects)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(projects.id, id))

  return { ok: true }
})
```

- [ ] **Step 10: Re-run tests and confirm they pass**

Run:
```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/projects.test.ts
```
Expected: all 3 tests PASS.

- [ ] **Step 11: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/projects apps/dashboard/tests apps/dashboard/package.json bun.lock
git commit -m "feat(api): add projects CRUD with role enforcement and integration tests"
```

---

### Task 18: `/api/projects/:id/members` CRUD + last-owner guard

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/members/index.get.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/members/index.post.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/members/[userId]/index.patch.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/projects/[id]/members/[userId]/index.delete.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/api/project-members.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/tests/api/project-members.test.ts
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { afterEach, describe, expect, test } from "bun:test"
import { createUser, signIn, truncateDomain } from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })

describe("project members API", () => {
  afterEach(async () => { await truncateDomain() })

  test("owner can add, change role, and remove members", async () => {
    await createUser("admin@example.com", "admin")
    await createUser("bob@example.com", "member")
    const cookie = await signIn("admin@example.com")

    const project = await $fetch("/api/projects", {
      method: "POST",
      body: { name: "Test" },
      headers: { cookie },
    })

    const added = await $fetch(`/api/projects/${project.id}/members`, {
      method: "POST",
      body: { email: "bob@example.com", role: "developer" },
      headers: { cookie },
    })
    expect(added.role).toBe("developer")

    await $fetch(`/api/projects/${project.id}/members/${added.userId}`, {
      method: "PATCH",
      body: { role: "viewer" },
      headers: { cookie },
    })

    const members = await $fetch(`/api/projects/${project.id}/members`, { headers: { cookie } })
    expect(members.find((m) => m.email === "bob@example.com")?.role).toBe("viewer")

    await $fetch(`/api/projects/${project.id}/members/${added.userId}`, {
      method: "DELETE",
      headers: { cookie },
    })
    const afterDelete = await $fetch(`/api/projects/${project.id}/members`, { headers: { cookie } })
    expect(afterDelete.find((m) => m.email === "bob@example.com")).toBeUndefined()
  })

  test("cannot demote or remove the last owner (non-admin)", async () => {
    await createUser("admin@example.com", "admin")
    await createUser("owner@example.com", "member")
    const adminCookie = await signIn("admin@example.com")
    const ownerCookie = await signIn("owner@example.com")

    // Admin creates project + makes owner@ an owner so owner is non-admin only.
    const project = await $fetch("/api/projects", {
      method: "POST",
      body: { name: "LastOwner" },
      headers: { cookie: adminCookie },
    })
    const owner = await $fetch(`/api/projects/${project.id}/members`, {
      method: "POST",
      body: { email: "owner@example.com", role: "owner" },
      headers: { cookie: adminCookie },
    })

    // Now owner@ tries to demote themselves — should fail (last non-admin owner).
    const res = await fetch(
      `http://localhost:3000/api/projects/${project.id}/members/${owner.userId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ role: "viewer" }),
      },
    )
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test and confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/project-members.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `server/api/projects/[id]/members/index.get.ts`**

```ts
import { eq } from "drizzle-orm"
import { db } from "../../../../db"
import { projectMembers, user } from "../../../../db/schema"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!
  await requireProjectRole(event, id, "viewer")

  const rows = await db
    .select({
      userId: projectMembers.userId,
      email: user.email,
      name: user.name,
      role: projectMembers.role,
      joinedAt: projectMembers.joinedAt,
    })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, id))

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    role: r.role as "viewer" | "developer" | "owner",
    joinedAt: r.joinedAt.toISOString(),
  }))
})
```

- [ ] **Step 4: Implement `server/api/projects/[id]/members/index.post.ts`**

```ts
import { and, eq } from "drizzle-orm"
import { AddProjectMemberInput } from "@feedback-tool/shared"
import { db } from "../../../../db"
import { projectMembers, user } from "../../../../db/schema"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")!
  await requireProjectRole(event, id, "owner")
  const body = await readValidatedBody(event, (b) => AddProjectMemberInput.parse(b))

  const [u] = await db.select().from(user).where(eq(user.email, body.email))
  if (!u) {
    throw createError({ statusCode: 404, statusMessage: "User not found" })
  }

  const [existing] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, u.id)))
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: "Already a member" })
  }

  await db.insert(projectMembers).values({
    projectId: id,
    userId: u.id,
    role: body.role,
  })

  return {
    userId: u.id,
    email: u.email,
    name: u.name ?? null,
    role: body.role,
    joinedAt: new Date().toISOString(),
  }
})
```

- [ ] **Step 5: Implement `server/api/projects/[id]/members/[userId]/index.patch.ts`**

```ts
import { and, count, eq, ne } from "drizzle-orm"
import { UpdateProjectMemberInput } from "@feedback-tool/shared"
import { db } from "../../../../../db"
import { projectMembers } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")!
  const userId = getRouterParam(event, "userId")!
  await requireProjectRole(event, projectId, "owner")
  const body = await readValidatedBody(event, (b) => UpdateProjectMemberInput.parse(b))

  const [current] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
  if (!current) {
    throw createError({ statusCode: 404, statusMessage: "Member not found" })
  }

  if (current.role === "owner" && body.role !== "owner") {
    const [{ c }] = await db
      .select({ c: count() })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, "owner")))
    if (c <= 1) {
      throw createError({
        statusCode: 400,
        statusMessage: "Cannot demote the last owner",
      })
    }
  }

  await db
    .update(projectMembers)
    .set({ role: body.role })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))

  return { userId, role: body.role }
})
```

- [ ] **Step 6: Implement `server/api/projects/[id]/members/[userId]/index.delete.ts`**

```ts
import { and, count, eq } from "drizzle-orm"
import { db } from "../../../../../db"
import { projectMembers } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")!
  const userId = getRouterParam(event, "userId")!
  await requireProjectRole(event, projectId, "owner")

  const [current] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
  if (!current) return { ok: true }

  if (current.role === "owner") {
    const [{ c }] = await db
      .select({ c: count() })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, "owner")))
    if (c <= 1) {
      throw createError({
        statusCode: 400,
        statusMessage: "Cannot remove the last owner",
      })
    }
  }

  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))

  return { ok: true }
})
```

- [ ] **Step 7: Re-run tests and confirm they pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/project-members.test.ts`
Expected: both tests PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/projects/\[id\]/members apps/dashboard/tests/api/project-members.test.ts
git commit -m "feat(api): add project members CRUD with last-owner guard"
```

---

### Task 19: Admin users API + invites + last-admin guard

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/users/index.get.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/users/index.post.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/users/[id]/index.patch.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/users/[id]/index.delete.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/invites/accept.post.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/api/users.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/tests/api/users.test.ts
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { createUser, signIn, truncateDomain } from "../helpers"
import { db } from "../../server/db"
import { user } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })

describe("admin users API", () => {
  afterEach(async () => { await truncateDomain() })

  test("admin can invite a user; invite token can be claimed", async () => {
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    await $fetch("/api/users", {
      method: "POST",
      body: { email: "invitee@example.com", role: "member" },
      headers: { cookie },
    })

    // Fetch the generated invite token from the DB (email would normally carry it).
    const rows = await db.execute(sql`SELECT invite_token FROM "user" WHERE email = 'invitee@example.com'`)
    const token = (rows as any[])[0].invite_token as string
    expect(token.length).toBeGreaterThan(10)

    await $fetch("/api/invites/accept", {
      method: "POST",
      body: { token, password: "Password123!" },
    })

    const after = await db.execute(sql`SELECT status, invite_token FROM "user" WHERE email = 'invitee@example.com'`)
    expect((after as any[])[0].status).toBe("active")
    expect((after as any[])[0].invite_token).toBeNull()
  })

  test("cannot demote the last admin", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    const res = await fetch(`http://localhost:3000/api/users/${adminId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ role: "member" }),
    })
    expect(res.status).toBe(400)
  })

  test("non-admin cannot list users", async () => {
    await createUser("admin@example.com", "admin")
    await createUser("member@example.com", "member")
    const cookie = await signIn("member@example.com")

    const res = await fetch("http://localhost:3000/api/users", { headers: { cookie } })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run test and confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/users.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `server/api/users/index.get.ts`**

```ts
import { desc } from "drizzle-orm"
import { db } from "../../db"
import { user } from "../../db/schema"
import { requireInstallAdmin } from "../../lib/permissions"

export default defineEventHandler(async (event) => {
  await requireInstallAdmin(event)
  const rows = await db.select().from(user).orderBy(desc(user.createdAt))
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role as "admin" | "member",
    status: u.status as "invited" | "active" | "disabled",
    emailVerified: u.emailVerified,
    createdAt: u.createdAt.toISOString(),
  }))
})
```

- [ ] **Step 4: Implement `server/api/users/index.post.ts`**

```ts
import { eq } from "drizzle-orm"
import { InviteUserInput } from "@feedback-tool/shared"
import { db } from "../../db"
import { appSettings, user } from "../../db/schema"
import { sendMail } from "../../lib/email"
import { requireInstallAdmin } from "../../lib/permissions"
import { renderTemplate } from "../../lib/render-template"

function randomToken(len = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export default defineEventHandler(async (event) => {
  const session = await requireInstallAdmin(event)
  const body = await readValidatedBody(event, (b) => InviteUserInput.parse(b))

  const [existing] = await db.select().from(user).where(eq(user.email, body.email))
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: "Email already in use" })
  }

  const token = randomToken()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const id = crypto.randomUUID()

  await db.insert(user).values({
    id,
    email: body.email,
    name: body.name ?? null,
    emailVerified: false,
    role: body.role,
    status: "invited",
    inviteToken: token,
    inviteTokenExpiresAt: expiresAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  const [settings] = await db.select().from(appSettings).limit(1)
  const inviter = session.email
  const url = `${process.env.BETTER_AUTH_URL}/auth/accept-invite?token=${token}`
  const html = await renderTemplate("invite", {
    installName: settings?.installName ?? "Feedback Tool",
    inviterName: inviter,
    url,
    expiresAt: expiresAt.toISOString().slice(0, 10),
  })
  await sendMail({ to: body.email, subject: `You're invited to ${settings?.installName}`, html })

  return { id, email: body.email, role: body.role, status: "invited" as const }
})
```

- [ ] **Step 5: Implement `server/api/users/[id]/index.patch.ts`**

```ts
import { and, count, eq, ne } from "drizzle-orm"
import { UpdateUserInput } from "@feedback-tool/shared"
import { db } from "../../../db"
import { user } from "../../../db/schema"
import { requireInstallAdmin } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const session = await requireInstallAdmin(event)
  const id = getRouterParam(event, "id")!
  const body = await readValidatedBody(event, (b) => UpdateUserInput.parse(b))

  const [target] = await db.select().from(user).where(eq(user.id, id))
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: "User not found" })
  }

  if (body.role && body.role !== target.role) {
    if (target.role === "admin" && body.role === "member") {
      if (session.userId === id) {
        throw createError({ statusCode: 400, statusMessage: "Admins cannot demote themselves" })
      }
      const [{ c }] = await db
        .select({ c: count() })
        .from(user)
        .where(and(eq(user.role, "admin"), ne(user.status, "disabled")))
      if (c <= 1) {
        throw createError({ statusCode: 400, statusMessage: "Cannot demote the last admin" })
      }
    }
  }

  await db.update(user).set({ ...body, updatedAt: new Date() }).where(eq(user.id, id))

  const [updated] = await db.select().from(user).where(eq(user.id, id))
  return {
    id: updated.id,
    email: updated.email,
    role: updated.role as "admin" | "member",
    status: updated.status as "invited" | "active" | "disabled",
  }
})
```

- [ ] **Step 6: Implement `server/api/users/[id]/index.delete.ts`**

```ts
import { and, count, eq, ne } from "drizzle-orm"
import { db } from "../../../db"
import { user } from "../../../db/schema"
import { requireInstallAdmin } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const session = await requireInstallAdmin(event)
  const id = getRouterParam(event, "id")!

  const [target] = await db.select().from(user).where(eq(user.id, id))
  if (!target) return { ok: true }

  if (target.role === "admin") {
    if (session.userId === id) {
      throw createError({ statusCode: 400, statusMessage: "Admins cannot delete themselves" })
    }
    const [{ c }] = await db
      .select({ c: count() })
      .from(user)
      .where(and(eq(user.role, "admin"), ne(user.status, "disabled")))
    if (c <= 1) {
      throw createError({ statusCode: 400, statusMessage: "Cannot delete the last admin" })
    }
  }

  await db.update(user).set({ status: "disabled", updatedAt: new Date() }).where(eq(user.id, id))
  return { ok: true }
})
```

- [ ] **Step 7: Implement `server/api/invites/accept.post.ts`**

```ts
import { and, eq, gt } from "drizzle-orm"
import { AcceptInviteInput } from "@feedback-tool/shared"
import { db } from "../../db"
import { account, user } from "../../db/schema"

async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 })
}

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (b) => AcceptInviteInput.parse(b))

  const [invited] = await db
    .select()
    .from(user)
    .where(
      and(
        eq(user.inviteToken, body.token),
        eq(user.status, "invited"),
        gt(user.inviteTokenExpiresAt, new Date()),
      ),
    )
  if (!invited) {
    throw createError({ statusCode: 400, statusMessage: "Invalid or expired invite" })
  }

  const hashed = await hashPassword(body.password)

  await db.insert(account).values({
    id: crypto.randomUUID(),
    userId: invited.id,
    accountId: invited.id,
    providerId: "credential",
    password: hashed,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await db
    .update(user)
    .set({
      status: "active",
      emailVerified: true,
      inviteToken: null,
      inviteTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(user.id, invited.id))

  return { ok: true, email: invited.email }
})
```

- [ ] **Step 8: Re-run tests and confirm they pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/users.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/users apps/dashboard/server/api/invites apps/dashboard/tests/api/users.test.ts
git commit -m "feat(api): add admin users CRUD with invite flow and last-admin guard"
```

---

### Task 20: `/api/settings` GET + PATCH

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/settings/index.get.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/settings/index.patch.ts`
- Test: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/api/settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/tests/api/settings.test.ts
import { setup, $fetch } from "@nuxt/test-utils/e2e"
import { afterEach, describe, expect, test } from "bun:test"
import { createUser, signIn, truncateDomain } from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })

describe("settings API", () => {
  afterEach(async () => { await truncateDomain() })

  test("admin can toggle signupGated; gated signup returns 403 for new emails", async () => {
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    await $fetch("/api/settings", {
      method: "PATCH",
      body: { signupGated: true },
      headers: { cookie },
    })

    const res = await fetch("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "random@example.com", password: "Password123!", name: "X" }),
    })
    expect(res.status).toBe(403)
  })

  test("non-admin cannot read settings", async () => {
    await createUser("member@example.com", "member")
    const cookie = await signIn("member@example.com")
    const res = await fetch("http://localhost:3000/api/settings", { headers: { cookie } })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/settings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `server/api/settings/index.get.ts`**

```ts
import { db } from "../../db"
import { appSettings } from "../../db/schema"
import { requireInstallAdmin } from "../../lib/permissions"

export default defineEventHandler(async (event) => {
  await requireInstallAdmin(event)
  const [s] = await db.select().from(appSettings).limit(1)
  return {
    signupGated: s.signupGated,
    installName: s.installName,
    updatedAt: s.updatedAt.toISOString(),
  }
})
```

- [ ] **Step 4: Implement `server/api/settings/index.patch.ts`**

```ts
import { eq } from "drizzle-orm"
import { UpdateAppSettingsInput } from "@feedback-tool/shared"
import { db } from "../../db"
import { appSettings } from "../../db/schema"
import { requireInstallAdmin } from "../../lib/permissions"

export default defineEventHandler(async (event) => {
  await requireInstallAdmin(event)
  const body = await readValidatedBody(event, (b) => UpdateAppSettingsInput.parse(b))

  const [updated] = await db
    .update(appSettings)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(appSettings.id, 1))
    .returning()

  return {
    signupGated: updated.signupGated,
    installName: updated.installName,
    updatedAt: updated.updatedAt.toISOString(),
  }
})
```

- [ ] **Step 5: Re-run and confirm pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard && bun test tests/api/settings.test.ts`
Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/settings apps/dashboard/tests/api/settings.test.ts
git commit -m "feat(api): add app settings endpoints with gated-signup enforcement"
```

---

## Phase 6 — Frontend

### Task 21: Auth pages + composables + middleware + layouts

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/composables/useSession.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/composables/useApi.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/layouts/default.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/layouts/auth.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/middleware/auth.global.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/auth/sign-in.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/auth/sign-up.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/auth/verify-email.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/auth/accept-invite.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/lib/auth-client.ts`

- [ ] **Step 1: Write `app/lib/auth-client.ts`**

```ts
import { createAuthClient } from "better-auth/vue"

export const authClient = createAuthClient({
  baseURL: useRuntimeConfig().public.betterAuthUrl,
})
```

- [ ] **Step 2: Write `app/composables/useSession.ts`**

```ts
import { authClient } from "../lib/auth-client"

export const useSession = () => {
  const session = authClient.useSession()
  const isAdmin = computed(() => session.value.data?.user?.role === "admin")
  return {
    session,
    isAdmin,
    signIn: authClient.signIn,
    signOut: authClient.signOut,
    signUp: authClient.signUp,
  }
}
```

- [ ] **Step 3: Write `app/composables/useApi.ts`**

```ts
export const useApi = <T>(path: string, opts: Parameters<typeof useFetch<T>>[1] = {}) =>
  useFetch<T>(path, { baseURL: useRuntimeConfig().public.betterAuthUrl, credentials: "include", ...opts })
```

- [ ] **Step 4: Write `app/middleware/auth.global.ts`**

```ts
import { authClient } from "../lib/auth-client"

export default defineNuxtRouteMiddleware(async (to) => {
  const publicPaths = ["/auth/sign-in", "/auth/sign-up", "/auth/verify-email", "/auth/accept-invite"]
  if (publicPaths.some((p) => to.path.startsWith(p))) return

  const { data } = await authClient.getSession()
  if (!data?.user) {
    return navigateTo(`/auth/sign-in?next=${encodeURIComponent(to.fullPath)}`)
  }
})
```

- [ ] **Step 5: Write `app/layouts/default.vue`**

```vue
<script setup lang="ts">
const { session, isAdmin, signOut } = useSession()
</script>

<template>
  <div class="min-h-screen bg-neutral-50 text-neutral-900">
    <header class="border-b bg-white">
      <div class="max-w-6xl mx-auto flex items-center justify-between px-6 h-14">
        <NuxtLink to="/" class="font-semibold">Feedback Tool</NuxtLink>
        <nav class="flex gap-4 text-sm">
          <NuxtLink to="/">Projects</NuxtLink>
          <NuxtLink v-if="isAdmin" to="/settings/users">Users</NuxtLink>
          <NuxtLink v-if="isAdmin" to="/settings/install">Install</NuxtLink>
          <NuxtLink to="/settings/account">{{ session.data?.user?.email }}</NuxtLink>
          <button class="text-neutral-500" @click="signOut()">Sign out</button>
        </nav>
      </div>
    </header>
    <main class="max-w-6xl mx-auto p-6">
      <slot />
    </main>
  </div>
</template>
```

- [ ] **Step 6: Write `app/layouts/auth.vue`**

```vue
<template>
  <div class="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
    <div class="w-full max-w-sm bg-white border rounded-lg p-6 shadow-sm">
      <slot />
    </div>
  </div>
</template>
```

- [ ] **Step 7: Write `app/pages/auth/sign-in.vue`**

```vue
<script setup lang="ts">
definePageMeta({ layout: "auth" })
const { signIn } = useSession()
const config = useRuntimeConfig()
const email = ref("")
const password = ref("")
const error = ref<string | null>(null)

async function submit() {
  error.value = null
  const { error: err } = await signIn.email({ email: email.value, password: password.value })
  if (err) { error.value = err.message ?? "Sign in failed"; return }
  await navigateTo(useRoute().query.next as string || "/")
}

async function oauth(provider: "github" | "google") {
  await signIn.social({ provider, callbackURL: "/" })
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-semibold">Sign in</h1>
    <form class="space-y-3" @submit.prevent="submit">
      <input v-model="email" type="email" placeholder="Email" class="w-full border rounded px-3 py-2" required />
      <input v-model="password" type="password" placeholder="Password" class="w-full border rounded px-3 py-2" required />
      <button class="w-full bg-neutral-900 text-white rounded py-2">Sign in</button>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </form>
    <div v-if="config.public.hasGithubOAuth || config.public.hasGoogleOAuth" class="space-y-2">
      <div class="text-xs text-neutral-500 text-center">or</div>
      <button v-if="config.public.hasGithubOAuth" class="w-full border rounded py-2" @click="oauth('github')">Continue with GitHub</button>
      <button v-if="config.public.hasGoogleOAuth" class="w-full border rounded py-2" @click="oauth('google')">Continue with Google</button>
    </div>
    <p class="text-sm text-neutral-500 text-center">
      No account? <NuxtLink to="/auth/sign-up" class="underline">Sign up</NuxtLink>
    </p>
  </div>
</template>
```

- [ ] **Step 8: Write `app/pages/auth/sign-up.vue`**

```vue
<script setup lang="ts">
definePageMeta({ layout: "auth" })
const { signUp } = useSession()
const email = ref("")
const password = ref("")
const name = ref("")
const sent = ref(false)
const error = ref<string | null>(null)

async function submit() {
  error.value = null
  const { error: err } = await signUp.email({ email: email.value, password: password.value, name: name.value })
  if (err) { error.value = err.message ?? "Sign up failed"; return }
  sent.value = true
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-semibold">Sign up</h1>
    <div v-if="sent" class="text-sm">
      Check your email for a verification link.
    </div>
    <form v-else class="space-y-3" @submit.prevent="submit">
      <input v-model="name" placeholder="Name" class="w-full border rounded px-3 py-2" />
      <input v-model="email" type="email" placeholder="Email" class="w-full border rounded px-3 py-2" required />
      <input v-model="password" type="password" placeholder="Password" class="w-full border rounded px-3 py-2" required />
      <button class="w-full bg-neutral-900 text-white rounded py-2">Sign up</button>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </form>
    <p class="text-sm text-neutral-500 text-center">
      Have an account? <NuxtLink to="/auth/sign-in" class="underline">Sign in</NuxtLink>
    </p>
  </div>
</template>
```

- [ ] **Step 9: Write `app/pages/auth/verify-email.vue`**

```vue
<script setup lang="ts">
definePageMeta({ layout: "auth" })
const route = useRoute()
const status = ref<"verifying" | "ok" | "error">("verifying")

onMounted(async () => {
  const token = route.query.token as string
  if (!token) { status.value = "error"; return }
  try {
    await $fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, { credentials: "include" })
    status.value = "ok"
    setTimeout(() => navigateTo("/"), 1500)
  } catch { status.value = "error" }
})
</script>

<template>
  <div class="space-y-2 text-center">
    <h1 class="text-lg font-semibold">Email verification</h1>
    <p v-if="status === 'verifying'">Verifying…</p>
    <p v-else-if="status === 'ok'" class="text-green-700">Verified! Redirecting…</p>
    <p v-else class="text-red-600">Verification failed or link expired.</p>
  </div>
</template>
```

- [ ] **Step 10: Write `app/pages/auth/accept-invite.vue`**

```vue
<script setup lang="ts">
definePageMeta({ layout: "auth" })
const route = useRoute()
const password = ref("")
const done = ref(false)
const error = ref<string | null>(null)

async function submit() {
  error.value = null
  try {
    await $fetch("/api/invites/accept", {
      method: "POST",
      body: { token: route.query.token, password: password.value },
    })
    done.value = true
    setTimeout(() => navigateTo("/auth/sign-in"), 1500)
  } catch (e: any) {
    error.value = e?.statusMessage ?? "Invite expired or invalid"
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-semibold">Accept invitation</h1>
    <div v-if="done" class="text-green-700 text-sm">Done! Redirecting to sign in…</div>
    <form v-else class="space-y-3" @submit.prevent="submit">
      <input v-model="password" type="password" placeholder="Set a password" class="w-full border rounded px-3 py-2" required />
      <button class="w-full bg-neutral-900 text-white rounded py-2">Accept invite</button>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </form>
  </div>
</template>
```

- [ ] **Step 11: Start dev server and smoke-test sign-in + sign-up pages render**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun run dev`
Visit `http://localhost:3000/auth/sign-in` — renders form, no console errors.
Visit `http://localhost:3000/auth/sign-up` — renders form.
Visit `http://localhost:3000/` signed out — redirects to sign-in.

Stop server.

- [ ] **Step 12: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app
git commit -m "feat(dashboard): add auth pages, layouts, middleware, and session composable"
```

---

### Task 22: Project list + project detail + members + project settings pages

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/index.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/projects/[id]/index.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/projects/[id]/members.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/projects/[id]/settings.vue`

- [ ] **Step 1: Write `app/pages/index.vue`**

```vue
<script setup lang="ts">
import type { ProjectDTO } from "@feedback-tool/shared"

const { data, refresh } = await useApi<ProjectDTO[]>("/api/projects")
const newName = ref("")

async function create() {
  if (!newName.value.trim()) return
  await $fetch("/api/projects", {
    method: "POST",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { name: newName.value },
  })
  newName.value = ""
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Projects</h1>
      <form class="flex gap-2" @submit.prevent="create">
        <input v-model="newName" placeholder="New project name" class="border rounded px-3 py-2" />
        <button class="bg-neutral-900 text-white rounded px-4 py-2">Create</button>
      </form>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <NuxtLink
        v-for="p in data"
        :key="p.id"
        :to="`/projects/${p.id}`"
        class="block border rounded-lg p-4 bg-white hover:bg-neutral-50"
      >
        <div class="font-semibold">{{ p.name }}</div>
        <div class="text-xs text-neutral-500">/{{ p.slug }} · {{ p.effectiveRole }}</div>
      </NuxtLink>
      <div v-if="data?.length === 0" class="text-neutral-500 col-span-full">No projects yet.</div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Write `app/pages/projects/[id]/index.vue`**

```vue
<script setup lang="ts">
import type { ProjectDTO } from "@feedback-tool/shared"
const route = useRoute()
const { data: project } = await useApi<ProjectDTO>(`/api/projects/${route.params.id}`)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">{{ project?.name }}</h1>
        <div class="text-xs text-neutral-500">/{{ project?.slug }} · role: {{ project?.effectiveRole }}</div>
      </div>
      <div class="flex gap-3 text-sm">
        <NuxtLink :to="`/projects/${project?.id}/members`" class="underline">Members</NuxtLink>
        <NuxtLink v-if="project?.effectiveRole === 'owner'" :to="`/projects/${project?.id}/settings`" class="underline">Settings</NuxtLink>
      </div>
    </div>
    <div class="border rounded-lg p-6 bg-white text-neutral-500 text-sm">
      Tickets will appear here once the SDK intake lands (sub-project B).
    </div>
  </div>
</template>
```

- [ ] **Step 3: Write `app/pages/projects/[id]/members.vue`**

```vue
<script setup lang="ts">
import type { ProjectDTO, ProjectMemberDTO, ProjectRole } from "@feedback-tool/shared"
const route = useRoute()
const { data: project } = await useApi<ProjectDTO>(`/api/projects/${route.params.id}`)
const { data: members, refresh } = await useApi<ProjectMemberDTO[]>(`/api/projects/${route.params.id}/members`)
const email = ref("")
const role = ref<ProjectRole>("developer")

async function add() {
  await $fetch(`/api/projects/${route.params.id}/members`, {
    method: "POST",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { email: email.value, role: role.value },
  })
  email.value = ""
  await refresh()
}

async function changeRole(userId: string, r: ProjectRole) {
  await $fetch(`/api/projects/${route.params.id}/members/${userId}`, {
    method: "PATCH",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { role: r },
  })
  await refresh()
}

async function remove(userId: string) {
  await $fetch(`/api/projects/${route.params.id}/members/${userId}`, {
    method: "DELETE",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
  })
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">{{ project?.name }} — Members</h1>
    <form v-if="project?.effectiveRole === 'owner'" class="flex gap-2" @submit.prevent="add">
      <input v-model="email" type="email" placeholder="user@example.com" class="border rounded px-3 py-2 flex-1" required />
      <select v-model="role" class="border rounded px-3 py-2">
        <option value="viewer">Viewer</option>
        <option value="developer">Developer</option>
        <option value="owner">Owner</option>
      </select>
      <button class="bg-neutral-900 text-white rounded px-4 py-2">Add</button>
    </form>
    <table class="w-full bg-white border rounded">
      <thead class="bg-neutral-100 text-left text-sm">
        <tr>
          <th class="p-3">Email</th><th class="p-3">Role</th><th class="p-3"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in members" :key="m.userId" class="border-t">
          <td class="p-3">{{ m.email }}</td>
          <td class="p-3">
            <select
              :value="m.role"
              :disabled="project?.effectiveRole !== 'owner'"
              class="border rounded px-2 py-1"
              @change="changeRole(m.userId, ($event.target as HTMLSelectElement).value as ProjectRole)"
            >
              <option value="viewer">viewer</option>
              <option value="developer">developer</option>
              <option value="owner">owner</option>
            </select>
          </td>
          <td class="p-3 text-right">
            <button
              v-if="project?.effectiveRole === 'owner'"
              class="text-red-600"
              @click="remove(m.userId)"
            >Remove</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 4: Write `app/pages/projects/[id]/settings.vue`**

```vue
<script setup lang="ts">
import type { ProjectDTO } from "@feedback-tool/shared"
const route = useRoute()
const { data: project, refresh } = await useApi<ProjectDTO>(`/api/projects/${route.params.id}`)
const name = ref(project.value?.name ?? "")
const slug = ref(project.value?.slug ?? "")

async function save() {
  await $fetch(`/api/projects/${route.params.id}`, {
    method: "PATCH",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { name: name.value, slug: slug.value },
  })
  await refresh()
}

async function softDelete() {
  if (!confirm("Delete this project?")) return
  await $fetch(`/api/projects/${route.params.id}`, {
    method: "DELETE",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
  })
  await navigateTo("/")
}
</script>

<template>
  <div class="space-y-6 max-w-lg">
    <h1 class="text-2xl font-semibold">Project settings</h1>
    <form class="space-y-3" @submit.prevent="save">
      <label class="block">
        <span class="text-sm">Name</span>
        <input v-model="name" class="w-full border rounded px-3 py-2" />
      </label>
      <label class="block">
        <span class="text-sm">Slug</span>
        <input v-model="slug" class="w-full border rounded px-3 py-2" />
      </label>
      <button class="bg-neutral-900 text-white rounded px-4 py-2">Save</button>
    </form>
    <div class="border-t pt-4">
      <button class="text-red-600" @click="softDelete">Delete project</button>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Smoke-test — sign in, create a project, add member, change role**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun run dev`
- Sign in as admin.
- Create "My Project" — appears on home page.
- Invite a second user (via `/settings/users`, next task), add them to the project, change their role.

Stop server.

- [ ] **Step 6: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/pages/index.vue "apps/dashboard/app/pages/projects"
git commit -m "feat(dashboard): add project list, detail, members, and settings pages"
```

---

### Task 23: Admin pages (users, install) + account page

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/settings/account.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/settings/users.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/settings/install.vue`

- [ ] **Step 1: Write `app/pages/settings/account.vue`**

```vue
<script setup lang="ts">
const { session, signOut } = useSession()
</script>

<template>
  <div class="space-y-4 max-w-md">
    <h1 class="text-2xl font-semibold">Account</h1>
    <div class="border rounded-lg bg-white p-4 space-y-2 text-sm">
      <div><span class="text-neutral-500">Email:</span> {{ session.data?.user?.email }}</div>
      <div><span class="text-neutral-500">Role:</span> {{ session.data?.user?.role }}</div>
    </div>
    <button class="border rounded px-4 py-2" @click="signOut()">Sign out</button>
  </div>
</template>
```

- [ ] **Step 2: Write `app/pages/settings/users.vue`**

```vue
<script setup lang="ts">
import type { InstallRole, UserDTO } from "@feedback-tool/shared"

definePageMeta({ middleware: "admin-only" })

const { data: users, refresh } = await useApi<UserDTO[]>("/api/users")
const inviteEmail = ref("")
const inviteRole = ref<InstallRole>("member")

async function invite() {
  await $fetch("/api/users", {
    method: "POST",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { email: inviteEmail.value, role: inviteRole.value },
  })
  inviteEmail.value = ""
  await refresh()
}

async function updateRole(id: string, role: InstallRole) {
  await $fetch(`/api/users/${id}`, {
    method: "PATCH",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { role },
  })
  await refresh()
}

async function disable(id: string) {
  await $fetch(`/api/users/${id}`, {
    method: "DELETE",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
  })
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Users</h1>
    <form class="flex gap-2" @submit.prevent="invite">
      <input v-model="inviteEmail" type="email" placeholder="user@example.com" class="border rounded px-3 py-2 flex-1" required />
      <select v-model="inviteRole" class="border rounded px-3 py-2">
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <button class="bg-neutral-900 text-white rounded px-4 py-2">Invite</button>
    </form>
    <table class="w-full bg-white border rounded">
      <thead class="bg-neutral-100 text-left text-sm">
        <tr>
          <th class="p-3">Email</th><th class="p-3">Role</th><th class="p-3">Status</th><th class="p-3"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.id" class="border-t">
          <td class="p-3">{{ u.email }}</td>
          <td class="p-3">
            <select :value="u.role" class="border rounded px-2 py-1" @change="updateRole(u.id, ($event.target as HTMLSelectElement).value as InstallRole)">
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </td>
          <td class="p-3">{{ u.status }}</td>
          <td class="p-3 text-right">
            <button class="text-red-600" @click="disable(u.id)">Disable</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 3: Write `app/pages/settings/install.vue`**

```vue
<script setup lang="ts">
import type { AppSettingsDTO } from "@feedback-tool/shared"

definePageMeta({ middleware: "admin-only" })

const { data: settings, refresh } = await useApi<AppSettingsDTO>("/api/settings")
const name = ref(settings.value?.installName ?? "")
const gated = ref(settings.value?.signupGated ?? false)

async function save() {
  await $fetch("/api/settings", {
    method: "PATCH",
    baseURL: useRuntimeConfig().public.betterAuthUrl,
    credentials: "include",
    body: { installName: name.value, signupGated: gated.value },
  })
  await refresh()
}
</script>

<template>
  <div class="space-y-6 max-w-lg">
    <h1 class="text-2xl font-semibold">Install settings</h1>
    <form class="space-y-3" @submit.prevent="save">
      <label class="block">
        <span class="text-sm">Install name</span>
        <input v-model="name" class="w-full border rounded px-3 py-2" />
      </label>
      <label class="flex items-center gap-2">
        <input v-model="gated" type="checkbox" />
        <span class="text-sm">Require invite to sign up</span>
      </label>
      <button class="bg-neutral-900 text-white rounded px-4 py-2">Save</button>
    </form>
  </div>
</template>
```

- [ ] **Step 4: Add `admin-only` route middleware**

Create `apps/dashboard/app/middleware/admin-only.ts`:

```ts
import { authClient } from "../lib/auth-client"

export default defineNuxtRouteMiddleware(async () => {
  const { data } = await authClient.getSession()
  if (data?.user?.role !== "admin") {
    return navigateTo("/")
  }
})
```

- [ ] **Step 5: Smoke-test admin pages render and non-admin is redirected**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool && bun run dev`
- Signed in as admin → `/settings/users` and `/settings/install` render.
- Sign out, sign in as a non-admin → visiting `/settings/users` redirects to `/`.

Stop server.

- [ ] **Step 6: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add "apps/dashboard/app/pages/settings" apps/dashboard/app/middleware/admin-only.ts
git commit -m "feat(dashboard): add account, admin users, and install settings pages"
```

---

## Phase 7 — Verification

### Task 24: End-to-end smoke test against done-criteria

**Files:** none (manual verification pass).

- [ ] **Step 1: Fresh environment**

Run:
```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run dev:stop
docker volume rm feedback-tool_feedback_tool_data 2>/dev/null || true
rm -rf apps/dashboard/.nuxt apps/dashboard/.output
bun install
bun run dev:docker
# wait a few seconds for postgres to be ready
bun run db:migrate
bun run dev
```

- [ ] **Step 2: Criterion 1 — unauthenticated redirect**

Visit `http://localhost:3000/`.
Expected: redirected to `/auth/sign-in`.

- [ ] **Step 3: Criterion 2 — first signup promoted to admin + Ethereal verification**

Sign up at `/auth/sign-up` as `admin@example.com`.
Check terminal for `[email] preview: https://ethereal.email/message/...`. Open the URL, copy the verify link, paste into browser → `/auth/verify-email` renders "Verified!" and redirects to `/`.
Run `docker exec $(docker ps --filter ancestor=postgres:17 -q) psql -U postgres -d feedback_tool -c "SELECT email, role, email_verified FROM \"user\""`.
Expected: `admin@example.com | admin | true`.

- [ ] **Step 4: Criterion 3 — create project**

From `/`, type "My Project" → Create. Click the new card → `/projects/:id` renders overview placeholder.

- [ ] **Step 5: Criterion 4 — invite second user**

Go to `/settings/users` → invite `dev@example.com` as `member`. Open Ethereal preview, click invite link → `/auth/accept-invite?token=...` → set password → redirected to `/auth/sign-in`.
Sign in as `dev@example.com`. Run `psql` check — `status='active'`, `invite_token IS NULL`.

- [ ] **Step 6: Criterion 5 — project membership visibility**

Sign out. Sign in as `admin@example.com`. From the project, go to Members → add `dev@example.com` as `developer`.
Sign out, sign in as `dev@example.com` → the project appears on their `/`. A third fresh user (invite + accept + sign in) does not see the project.

- [ ] **Step 7: Criterion 6 — gated signup**

Signed in as admin, go to `/settings/install` → toggle "Require invite" → Save.
In a separate incognito window, go to `/auth/sign-up`, try `random@example.com` → sign-up returns "Signup is invite-only".

- [ ] **Step 8: Criterion 7 — last-owner / last-admin guards**

`curl -i -X PATCH http://localhost:3000/api/users/<admin-id> -H "cookie: <admin-cookie>" -H "Content-Type: application/json" -d '{"role":"member"}'`
Expected: HTTP 400 with "Admins cannot demote themselves" or "Cannot demote the last admin".

For project last-owner: create a project as a non-admin, then `PATCH /api/projects/:id/members/:self --body '{"role":"viewer"}'` → HTTP 400.

- [ ] **Step 9: Criterion 8 — `bun run check` and `bun test` pass**

Run:
```bash
cd /Users/jiajingteoh/Documents/feedback-tool && bun run check && bun test
```
Expected: no lint / format / test failures.

- [ ] **Step 10: Tag the skeleton release**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git tag -a v0.1.0-skeleton -m "Sub-project A complete: monorepo + dashboard skeleton"
```

---

## Self-Review

**Spec coverage:**
- §3 scope items (monorepo, Nuxt, docker Postgres, drizzle, better-auth, two-tier roles, projects + members + admin users + invites + email) — all covered by Tasks 1–23.
- §4 data model (user additions, projects, project_members, app_settings) — Tasks 8–9.
- §5 auth helpers and hooks — Tasks 14–15.
- §6 email via nodemailer/ethereal — Task 13.
- §7 every API endpoint — Tasks 15, 17–20.
- §8 every UI page — Tasks 21–23.
- §9 tooling scripts + docker + .env.example — Tasks 1, 6.
- §10 unit tests for permissions/slug/templates — Tasks 11–14. Integration tests for projects/members/users/settings — Tasks 17–20.
- §11 eight done-criteria — Task 24.

**Placeholder scan:** No "TBD", "implement later", "similar to", or silent steps. Each step either describes one operation or contains the full code.

**Type consistency:** `ProjectRole` exported from `packages/shared/projects.ts` and re-used in `permissions.ts` via local type `ProjectRoleName`; both use the same string union (`viewer | developer | owner`). `InstallRole` / `UserStatus` share naming with DB fields. `ProjectDTO`, `ProjectMemberDTO`, `UserDTO`, `AppSettingsDTO` are consumed consistently across API handlers and Vue pages.
