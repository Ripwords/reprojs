# Monorepo + Dashboard Skeleton — Design

**Sub-project:** A (foundation) of the feedback-tool platform
**Status:** Design approved, awaiting spec review
**Date:** 2026-04-17

## 1. Purpose & Scope

Sub-project A delivers the foundation that every later sub-project (SDK, annotation, recorder, collectors, tickets, integrations) will build on. When A is done, a developer can clone the repo, boot Postgres in Docker, run migrations, and exercise a working Nuxt dashboard with real authentication, roles, project CRUD, invites, and email delivery.

**In scope:**
- Bun workspace monorepo skeleton (`apps/dashboard`, `packages/shared` placeholder).
- Nuxt 4 dashboard with Vue UI + Nitro server API.
- PostgreSQL 17 via Docker (dev) — `Bun.sql` through `drizzle-orm/bun-sql`.
- Drizzle schema + migrations.
- better-auth with email+password, GitHub OAuth, Google OAuth, email verification.
- Two-tier role model: install `admin`/`member` + project `owner`/`developer`/`viewer`.
- Project CRUD + project-member management.
- Install-admin-only user management with invite flow.
- Email delivery via `nodemailer` (Ethereal in dev, SMTP in prod).
- Lint (`oxlint`), format (`oxfmt`), tests (`bun test`), husky pre-commit.

**Out of scope (deferred to later sub-projects):**
- SDK packages (`core`, `ui`, `annotator`, `recorder`, `collectors`) — B–E.
- Embed keys + public intake API — B.
- Tickets, attachments, blob storage — E/F.
- GitHub Issues sync — G.
- Browser/E2E tests — B onward.
- tsdown config (added when `packages/core` lands in B).

## 2. Decisions (from brainstorming)

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Single workspace per deployment, multiple projects, admin-controlled access | Matches self-host-first product goal |
| 2 | Self-host only; `Bun.sql` + local disk / S3-compatible | Avoids serverless adapter complexity upfront |
| 3 | Skeleton includes auth + project/user model but not intake | Intake contract belongs to sub-project B |
| 4 | Two-tier roles: `users.role` (`admin`\|`member`) + `project_members.role` (`owner`\|`developer`\|`viewer`). Install admin implicitly owns every project. Invite-only signup is a runtime flag. | Expresses the stated "admins control project access" requirement cleanly |
| 5 | Auth providers: email+password, GitHub OAuth, Google OAuth | Covers self-host, devs' GitHub accounts, and work Google logins |
| 6 | Postgres driver: `Bun.sql` via `drizzle-orm/bun-sql` | Honors project CLAUDE.md rule |
| 7 | Bun workspaces alone, no Turbo | Too few packages for caching to matter yet |
| 8 | Email verification on; `nodemailer` + Ethereal dev default | Matches user request; Ethereal keeps dev friction low |

## 3. Repository Layout

```
feedback-tool/
├── apps/
│   └── dashboard/
│       ├── app/
│       │   ├── app.vue
│       │   ├── assets/css/tailwind.css
│       │   ├── components/
│       │   │   ├── auth/          # SignInForm, SignUpForm, etc.
│       │   │   ├── projects/      # ProjectCard, ProjectForm, MembersTable
│       │   │   └── settings/      # UsersTable, InviteForm, InstallSettingsForm
│       │   ├── composables/
│       │   │   ├── useSession.ts  # wraps better-auth Vue client
│       │   │   └── useApi.ts      # typed $fetch wrapper
│       │   ├── layouts/
│       │   │   ├── default.vue
│       │   │   └── auth.vue
│       │   ├── middleware/
│       │   │   └── auth.global.ts # redirects unauthenticated users
│       │   └── pages/
│       │       ├── auth/
│       │       │   ├── sign-in.vue
│       │       │   ├── sign-up.vue
│       │       │   ├── accept-invite.vue
│       │       │   └── verify-email.vue
│       │       ├── index.vue
│       │       ├── projects/
│       │       │   └── [id]/
│       │       │       ├── index.vue
│       │       │       ├── members.vue
│       │       │       └── settings.vue
│       │       └── settings/
│       │           ├── account.vue
│       │           ├── users.vue      # admin-only
│       │           └── install.vue    # admin-only
│       ├── server/
│       │   ├── api/
│       │   │   ├── auth/[...].ts
│       │   │   ├── me.get.ts
│       │   │   ├── projects/
│       │   │   │   ├── index.get.ts
│       │   │   │   ├── index.post.ts
│       │   │   │   └── [id]/
│       │   │   │       ├── index.get.ts
│       │   │   │       ├── index.patch.ts
│       │   │   │       ├── index.delete.ts
│       │   │   │       └── members/
│       │   │   │           ├── index.get.ts
│       │   │   │           ├── index.post.ts
│       │   │   │           └── [userId]/
│       │   │   │               ├── index.patch.ts
│       │   │   │               └── index.delete.ts
│       │   │   ├── users/
│       │   │   │   ├── index.get.ts
│       │   │   │   ├── index.post.ts
│       │   │   │   └── [id]/
│       │   │   │       ├── index.patch.ts
│       │   │   │       └── index.delete.ts
│       │   │   ├── invites/
│       │   │   │   └── accept.post.ts
│       │   │   └── settings/
│       │   │       ├── index.get.ts
│       │   │       └── index.patch.ts
│       │   ├── db/
│       │   │   ├── index.ts          # drizzle client over Bun.sql
│       │   │   ├── schema/
│       │   │   │   ├── index.ts
│       │   │   │   ├── auth-schema.ts   # generated by better-auth CLI
│       │   │   │   ├── projects.ts
│       │   │   │   ├── project-members.ts
│       │   │   │   └── app-settings.ts
│       │   │   └── migrations/       # drizzle-kit output
│       │   ├── emails/
│       │   │   ├── verify-email.html
│       │   │   └── invite.html
│       │   ├── lib/
│       │   │   ├── auth.ts           # better-auth config
│       │   │   ├── email.ts          # nodemailer + Ethereal
│       │   │   ├── permissions.ts    # requireSession/requireInstallAdmin/requireProjectRole
│       │   │   ├── slug.ts
│       │   │   └── render-template.ts
│       │   └── plugins/
│       │       └── 00.seed-settings.ts  # ensure singleton app_settings row on boot
│       ├── docker/
│       │   └── docker-compose.dev.yml
│       ├── drizzle.config.ts
│       ├── nuxt.config.ts
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── shared/
│       ├── src/
│       │   └── index.ts              # exports Zod schemas + inferred types
│       ├── package.json
│       └── tsconfig.json
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-04-17-monorepo-dashboard-skeleton-design.md
├── .env.example
├── .gitignore
├── .husky/pre-commit
├── .oxfmtrc.json
├── .oxlintrc.json
├── CLAUDE.md
├── README.md
├── bunfig.toml
└── package.json
```

## 4. Data Model

Schemas live in `apps/dashboard/server/db/schema/`. better-auth generates `auth-schema.ts` via `bun run auth:gen`; never hand-edit that file.

### 4.1 User (via better-auth `additionalFields`)

Extends the generated `user` table with:
- `role: 'admin' | 'member'` — default `member`, not user-input-settable at signup (bootstrap promotes first user to `admin`).
- `status: 'invited' | 'active' | 'disabled'` — default `active`.
- `inviteToken: string | null` — opaque one-time token for invited users; cleared on claim.
- `inviteTokenExpiresAt: timestamptz | null` — invite tokens expire 7 days after issue. Admins can re-issue to refresh.

### 4.2 `projects`

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | `uuid` | primary key, default `uuidv7()` |
| `name` | `text` | not null |
| `slug` | `text` | not null; unique on `deletedAt IS NULL` (partial index) so soft-deleted slugs can be reused |
| `createdBy` | `text` | references `user.id` |
| `createdAt` | `timestamptz` | not null, default `now()` |
| `updatedAt` | `timestamptz` | not null, default `now()` |
| `deletedAt` | `timestamptz` | nullable (soft-delete) |

Slug generated from name at create time; editable later. Soft-delete so later sub-projects can reattach tickets cleanly if a project is restored.

### 4.3 `project_members`

| Column | Type | Constraints |
| --- | --- | --- |
| `projectId` | `uuid` | references `projects.id` on delete cascade |
| `userId` | `text` | references `user.id` on delete cascade |
| `role` | `text` | not null; one of `owner`/`developer`/`viewer` |
| `invitedBy` | `text` | references `user.id` nullable |
| `joinedAt` | `timestamptz` | not null, default `now()` |

Primary key: `(projectId, userId)`.

### 4.4 `app_settings` (singleton)

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | `int` | primary key, default `1`, `check (id = 1)` |
| `signupGated` | `boolean` | not null, default `false` |
| `installName` | `text` | not null, default `'Feedback Tool'` |
| `updatedAt` | `timestamptz` | not null, default `now()` |

A nitro startup plugin inserts the singleton row if missing.

### 4.5 Invariants (enforced in app code)

- Install `admin` implicitly has `owner` role on every project — no `project_members` row required.
- A project must always have ≥ 1 `owner` — last-owner demotion/removal returns `400`.
- The install must always have ≥ 1 `admin` — last-admin demotion/removal/delete returns `400`.
- An install admin cannot demote themselves (prevents accidental lockout; another admin can).
- Deleting a user cascades their `project_members` rows at the DB level.

## 5. Authentication & Permissions

### 5.1 better-auth configuration (`server/lib/auth.ts`)

```ts
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,     // gates password sign-in only
  },
  // OAuth signups (GitHub/Google) skip verification — the provider has already proven the email.
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => sendMail({
      to: user.email,
      subject: 'Verify your email',
      html: await renderTemplate('verify-email', { name: user.name, url }),
    }),
  },
  socialProviders: {
    github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
  },
  user: {
    additionalFields: {
      role:        { type: 'string', defaultValue: 'member',  input: false },
      status:      { type: 'string', defaultValue: 'active',  input: false },
      inviteToken: { type: 'string', defaultValue: null,      input: false },
    },
  },
  hooks: {
    before: {
      'sign-up': async (ctx) => {
        const [settings] = await db.select().from(appSettings).limit(1);
        if (!settings.signupGated) return;
        const invited = await db.select().from(user)
          .where(and(eq(user.email, ctx.email), eq(user.status, 'invited')));
        if (!invited.length) throw new APIError('FORBIDDEN', 'Signup is invite-only');
      },
    },
    after: {
      'sign-up': async (ctx) => {
        const [{ c }] = await db.select({ c: count() }).from(user);
        await db.update(user)
          .set({ role: c === 1 ? 'admin' : user.role, status: 'active', inviteToken: null })
          .where(eq(user.id, ctx.userId));
      },
    },
  },
});
```

### 5.2 Permission helpers (`server/lib/permissions.ts`)

Three primitives:

```ts
requireSession(event): Promise<Session>
requireInstallAdmin(event): Promise<Session>
requireProjectRole(event, projectId, min: 'viewer' | 'developer' | 'owner'):
  Promise<{ session: Session; effectiveRole: 'owner' | 'developer' | 'viewer' }>
```

Role rank: `viewer=1 < developer=2 < owner=3`. Install admins bypass `project_members` lookup — they always receive `owner` effective role.

### 5.3 Frontend session

- `app/middleware/auth.global.ts` redirects unauthenticated users to `/auth/sign-in` except on `/auth/*` routes.
- `app/composables/useSession.ts` wraps better-auth's Vue client; exposes `session`, `isAdmin`, `signIn`, `signOut`.
- Admin-only UI (`/settings/users`, `/settings/install`) is hidden when `!isAdmin`; server always re-enforces.

### 5.4 Bootstrap

The first user to complete signup is auto-promoted to install `admin` (via the `after: sign-up` hook). This avoids a chicken-and-egg moment on fresh installs.

## 6. Email Delivery

`server/lib/email.ts` exposes a single helper:

```ts
export async function sendMail(opts: { to: string; subject: string; html: string; text?: string }): Promise<void>
```

Transporter selected at boot by `MAIL_PROVIDER`:

- `ethereal` (dev default): `nodemailer.createTestAccount()` on startup, credentials cached in memory for the process lifetime. After each send, the resulting preview URL is logged via `console.info` so developers can click from the terminal.
- `smtp` (prod): `nodemailer.createTransport({ host, port, auth, from })` from `SMTP_*` env vars.

Templates live under `server/emails/*.html` and are rendered by a trivial `renderTemplate(name, vars)` helper using string interpolation (`{{var}}`). MJML/react-email is explicitly out of scope.

## 7. API Surface

All endpoints under `apps/dashboard/server/api/`. All inputs validated with Zod; inferred response types exported from `packages/shared`.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `ALL` | `/api/auth/[...]` | public | better-auth handler |
| `GET` | `/api/me` | session | returns `{ user, isAdmin }` |
| `GET` | `/api/projects` | session | admin → all; member → joined only |
| `POST` | `/api/projects` | session | creator becomes `owner` |
| `GET` | `/api/projects/:id` | project `viewer+` | |
| `PATCH` | `/api/projects/:id` | project `owner` | rename, re-slug |
| `DELETE` | `/api/projects/:id` | project `owner` | soft-delete |
| `GET` | `/api/projects/:id/members` | project `viewer+` | |
| `POST` | `/api/projects/:id/members` | project `owner` | add existing user by email + role |
| `PATCH` | `/api/projects/:id/members/:userId` | project `owner` | change role; last-owner guard |
| `DELETE` | `/api/projects/:id/members/:userId` | project `owner` | last-owner guard |
| `GET` | `/api/users` | install `admin` | list install users |
| `POST` | `/api/users` | install `admin` | create invited user + send invite email |
| `PATCH` | `/api/users/:id` | install `admin` | change role/status; last-admin + self-demote guards |
| `DELETE` | `/api/users/:id` | install `admin` | soft-delete; last-admin guard |
| `POST` | `/api/invites/accept` | public + token | claim invite, set password |
| `GET` | `/api/settings` | install `admin` | read `app_settings` |
| `PATCH` | `/api/settings` | install `admin` | toggle `signupGated`, rename install |

## 8. UI Pages

| Path | Access | Purpose |
| --- | --- | --- |
| `/auth/sign-in` | public | email+password + GitHub + Google |
| `/auth/sign-up` | public (disabled when `signupGated`) | |
| `/auth/accept-invite?token=...` | public + token | set password / or continue with OAuth |
| `/auth/verify-email?token=...` | public + token | landed from verification mail |
| `/` | session | project list |
| `/projects/:id` | project `viewer+` | overview placeholder |
| `/projects/:id/members` | project `viewer+` (mutations `owner`) | members table |
| `/projects/:id/settings` | project `owner` | rename, soft-delete |
| `/settings/account` | session | change password, sign out |
| `/settings/users` | install `admin` | user list + invite |
| `/settings/install` | install `admin` | install name, `signupGated` toggle |

Data fetching uses `useFetch` + shared response types. No `fetch` in `onMounted`.

## 9. Tooling

### 9.1 Root `package.json` scripts

```jsonc
{
  "dev":         "bun --filter dashboard dev",
  "dev:docker":  "docker compose -f apps/dashboard/docker/docker-compose.dev.yml up -d",
  "dev:stop":    "docker compose -f apps/dashboard/docker/docker-compose.dev.yml down",
  "auth:gen":    "cd apps/dashboard && bunx @better-auth/cli generate --config ./server/lib/auth.ts --output ./server/db/schema/auth-schema.ts -y",
  "db:gen":      "bun run auth:gen && cd apps/dashboard && bunx drizzle-kit generate",
  "db:push":     "bun run auth:gen && cd apps/dashboard && bunx drizzle-kit push",
  "db:migrate":  "cd apps/dashboard && bunx drizzle-kit migrate",
  "lint":        "oxlint",
  "lint:fix":    "oxlint --fix",
  "fmt":         "oxfmt --write .",
  "fmt:check":   "oxfmt --check .",
  "check":       "oxfmt --check . && oxlint",
  "test":        "bun test",
  "prepare":     "husky"
}
```

### 9.2 Docker (`apps/dashboard/docker/docker-compose.dev.yml`)

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

### 9.3 Husky pre-commit

Runs `oxfmt --check` + `oxlint` on staged files.

### 9.4 `.env.example`

```
DATABASE_URL=postgres://postgres:postgres@localhost:5436/feedback_tool
BETTER_AUTH_SECRET=replace-me
BETTER_AUTH_URL=http://localhost:3000
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MAIL_PROVIDER=ethereal
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Feedback Tool <no-reply@localhost>"
```

## 10. Testing

- **Unit** — `bun test` for permission rank compare, slug generation, template rendering.
- **Integration** — `bun test` hitting real Postgres. Each test creates a disposable schema, runs migrations, seeds minimal fixtures, drops on teardown. No mocks for the database.
- **API contract** — per endpoint: auth rejected, role rejected, happy path, validation errors, last-owner/last-admin guardrails.
- **Browser/E2E** — deferred to sub-project B.

## 11. Definition of Done

From a fresh clone:

```bash
bun install
bun run dev:docker
bun run db:push
bun run dev
```

Then, via browser, the following all hold:

1. `http://localhost:3000` redirects to `/auth/sign-in` when signed out.
2. First user signup auto-promotes to `admin`; verification email appears in the Ethereal preview URL; clicking verifies and signs in.
3. Creating a project lands on `/projects/:id` placeholder page.
4. From `/settings/users`, admin invites a second user by email → invite email appears in Ethereal; second user claims, sets password, lands as `member`.
5. Admin adds the second user to the project with `developer` role; a third (non-member) user cannot see the project.
6. Toggling `signupGated=true` on `/settings/install` causes `/auth/sign-up` to return 403 for new emails, while invited users can still claim.
7. Attempting to demote/remove the last `owner` of a project, or the last install `admin`, returns 400 with a readable error.
8. `bun run check` passes. `bun test` passes. Migrations are deterministic on fresh DB.

All eight → sub-project A is done.

## 12. Deferred Decisions

These come up in later sub-projects, not here:

- Blob storage adapter (local disk / S3-compatible) — E/F.
- Embed-key format + origin allowlist — B.
- Preact vs Solid for SDK UI — B.
- Recorder event format (rrweb vs custom) — E.
- changesets for package release — first published package in B.
- tsdown config — B.

## 13. Risks

- **better-auth schema generation drift** — the generated `auth-schema.ts` shape can change across minor versions. Mitigation: commit the generated file, regenerate on better-auth upgrades, review the migration before applying.
- **Ethereal availability** — `nodemailer.createTestAccount()` depends on an external service. Mitigation: fall back to logging emails to disk in `server/emails/outbox/` if account creation fails at boot.
- **Drizzle `bun-sql` adapter immaturity** — if we hit a blocker, fallback is `drizzle-orm/node-postgres` with `pg`, documented in a follow-up. No code changes beyond the driver import.
- **Husky + Bun compatibility** — ai-trip uses husky successfully; we follow the same setup.
