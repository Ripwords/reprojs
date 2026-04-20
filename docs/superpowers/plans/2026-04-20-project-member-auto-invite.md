# Project member auto-invite implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project owner invite any email to a project — existing install user or not — by creating a `project_invitations` row, pre-creating the `user` row (`status=invited`) if the email is brand-new, and emailing a signed link that lands on an accept page after sign-in.

**Architecture:** New `project_invitations` Drizzle table. Six new endpoints under `/api/projects/:id/invitations/*` (owner-only) and `/api/invitations/:token/*` (session-bound). New Vue page at `/invitations/[token]`. Reuses the existing magic-link + `promoteInvitedOrFirstUser` hook in `server/lib/auth.ts` — no better-auth plugin changes.

**Tech Stack:** Nuxt 4 (Nitro server + Vue UI), Drizzle ORM + `pg`, better-auth magic-link, Zod (via `@reprojs/shared`), Bun test runner.

**Reference spec:** `docs/superpowers/specs/2026-04-20-project-member-auto-invite-design.md`

---

## Task 1: Shared types for project invitations

**Files:**
- Create: `packages/shared/src/project-invitations.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create the shared types module**

Create `packages/shared/src/project-invitations.ts`:

```ts
import { z } from "zod"
import { ProjectRole } from "./projects"

export const InvitationStatus = z.enum(["pending", "accepted", "revoked", "expired"])
export type InvitationStatus = z.infer<typeof InvitationStatus>

export const CreateProjectInvitationInput = z.object({
  email: z.email(),
  role: ProjectRole,
})
export type CreateProjectInvitationInput = z.infer<typeof CreateProjectInvitationInput>

export const ProjectInvitationDTO = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  email: z.email(),
  role: ProjectRole,
  status: InvitationStatus,
  invitedByUserId: z.string(),
  invitedByEmail: z.email().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
})
export type ProjectInvitationDTO = z.infer<typeof ProjectInvitationDTO>

export const InvitationDetailDTO = z.object({
  token: z.string(),
  projectId: z.uuid(),
  projectName: z.string(),
  role: ProjectRole,
  email: z.email(),
  inviterName: z.string().nullable(),
  inviterEmail: z.email(),
  expiresAt: z.string(),
})
export type InvitationDetailDTO = z.infer<typeof InvitationDetailDTO>
```

- [ ] **Step 2: Re-export from the shared index**

In `packages/shared/src/index.ts`, add the new line so it reads:

```ts
export * from "./projects"
export * from "./project-invitations"
export * from "./users"
export * from "./settings"
export * from "./reports"
export * from "./github"
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/jiajingteoh/Documents/reprojs && bun --cwd packages/shared run build` (or the repo's equivalent build script — check `packages/shared/package.json` first).

Expected: clean build, `.d.ts` for `project-invitations` present in the dist dir.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/project-invitations.ts packages/shared/src/index.ts
git commit -m "feat(shared): project invitation DTOs and inputs"
```

---

## Task 2: Drizzle schema + migration for `project_invitations`

**Files:**
- Create: `apps/dashboard/server/db/schema/project-invitations.ts`
- Modify: `apps/dashboard/server/db/schema/index.ts`
- Create (generated): `apps/dashboard/server/db/migrations/0002_project_invitations.sql`

- [ ] **Step 1: Write the Drizzle schema**

Create `apps/dashboard/server/db/schema/project-invitations.ts`:

```ts
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { projects } from "./projects"

export const projectInvitations = pgTable(
  "project_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["owner", "developer", "viewer"] }).notNull(),
    token: text("token").notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "revoked", "expired"],
    })
      .notNull()
      .default("pending"),
    invitedBy: text("invited_by").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at"),
    acceptedBy: text("accepted_by"),
  },
  (t) => ({
    tokenIdx: uniqueIndex("project_invitations_token_idx").on(t.token),
    projectEmailIdx: index("project_invitations_project_email_idx").on(
      t.projectId,
      t.email,
    ),
  }),
)

export type ProjectInvitation = typeof projectInvitations.$inferSelect
export type NewProjectInvitation = typeof projectInvitations.$inferInsert
```

- [ ] **Step 2: Re-export from the schema barrel**

Edit `apps/dashboard/server/db/schema/index.ts` to add:

```ts
export * from "./project-invitations"
```

(Insert alphabetically alongside `project-members`.)

- [ ] **Step 3: Generate the migration**

Run: `cd /Users/jiajingteoh/Documents/reprojs/apps/dashboard && bun run db:gen`

Expected: a new file `server/db/migrations/0002_<random_name>.sql` is created describing `CREATE TABLE "project_invitations" ...`. Rename it to `0002_project_invitations.sql` for clarity and update `server/db/migrations/meta/_journal.json` accordingly.

- [ ] **Step 4: Add the truncate target to the test helper**

In `apps/dashboard/tests/helpers.ts:9`, edit the `TRUNCATE` statement so the new table is wiped between tests. Change:

```ts
await db.execute(
  sql`TRUNCATE project_members, projects, "account", "session", "verification", "user" RESTART IDENTITY CASCADE`,
)
```

to:

```ts
await db.execute(
  sql`TRUNCATE project_invitations, project_members, projects, "account", "session", "verification", "user" RESTART IDENTITY CASCADE`,
)
```

- [ ] **Step 5: Apply the migration locally**

Run: `bun run db:push` from `apps/dashboard`.

Expected: `project_invitations` table exists in the dev database. Verify with `db-inspect` skill or:

```bash
psql "$DATABASE_URL" -c "\d project_invitations"
```

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/server/db/schema/project-invitations.ts \
        apps/dashboard/server/db/schema/index.ts \
        apps/dashboard/server/db/migrations/0002_project_invitations.sql \
        apps/dashboard/server/db/migrations/meta \
        apps/dashboard/tests/helpers.ts
git commit -m "feat(dashboard): project_invitations table and migration"
```

---

## Task 3: Email template for project invites

**Files:**
- Create: `apps/dashboard/server/emails/project-invite.html`

- [ ] **Step 1: Author the template**

Create `apps/dashboard/server/emails/project-invite.html`, modeled on `invite.html`:

```html
<!doctype html>
<html>
  <body style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px">
    <h2>You've been invited to {{projectName}}</h2>
    <p>Hi,</p>
    <p>
      <strong>{{inviterName}}</strong> ({{inviterEmail}}) invited you to the
      <strong>{{projectName}}</strong> project on Repro as <strong>{{role}}</strong>.
    </p>
    <p>
      <a
        href="{{acceptUrl}}"
        style="
          display: inline-block;
          padding: 12px 18px;
          background: #111;
          color: #fff;
          text-decoration: none;
          border-radius: 6px;
        "
        >Accept invitation</a
      >
    </p>
    <p>
      This link expires in {{expiresDays}} days. If you don't already have a
      Repro account, you'll be prompted to sign in with a one-time email link
      first and then shown the invitation.
    </p>
  </body>
</html>
```

The template engine is the simple `renderTemplate` helper already in use — confirm the key names match `renderTemplate`'s expectation by reading `apps/dashboard/server/lib/render-template.ts` before proceeding.

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/server/emails/project-invite.html
git commit -m "feat(dashboard): project invite email template"
```

---

## Task 4: `POST /api/projects/:id/invitations` — create invite

**Files:**
- Create: `apps/dashboard/server/api/projects/[id]/invitations/index.post.ts`
- Create: `apps/dashboard/tests/api/project-invitations.test.ts`

- [ ] **Step 1: Write the failing happy-path test**

Create `apps/dashboard/tests/api/project-invitations.test.ts`:

```ts
import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test"
import type { ProjectDTO, ProjectInvitationDTO } from "@reprojs/shared"
import { eq, sql } from "drizzle-orm"
import { db } from "../../server/db"
import { projectInvitations, user } from "../../server/db/schema"
import { apiFetch, createUser, signIn, truncateDomain } from "../helpers"

setDefaultTimeout(30000)

describe("project invitations API", () => {
  afterEach(async () => {
    await truncateDomain()
  })

  test("owner can invite a brand-new email — creates invited user row and pending invite", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    const { status, body } = await apiFetch<ProjectInvitationDTO>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "new@example.com", role: "developer" }),
      },
    )

    expect(status).toBe(201)
    const invite = body as ProjectInvitationDTO
    expect(invite.email).toBe("new@example.com")
    expect(invite.role).toBe("developer")
    expect(invite.status).toBe("pending")

    const [invitedUser] = await db.select().from(user).where(eq(user.email, "new@example.com"))
    expect(invitedUser?.status).toBe("invited")

    const rows = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "new@example.com"))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.token).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 2: Run it — expect 404 (route does not exist yet)**

Run: `cd /Users/jiajingteoh/Documents/reprojs/apps/dashboard && bun test tests/api/project-invitations.test.ts -t "brand-new email"`

Expected: FAIL — `status` is 404 because the route file doesn't exist.

- [ ] **Step 3: Implement the endpoint**

Create `apps/dashboard/server/api/projects/[id]/invitations/index.post.ts`:

```ts
import { randomBytes } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from "h3"
import { CreateProjectInvitationInput } from "@reprojs/shared"
import { db } from "../../../../db"
import {
  appSettings,
  projectInvitations,
  projectMembers,
  projects,
  user,
} from "../../../../db/schema"
import { env } from "../../../../lib/env"
import { requireProjectRole } from "../../../../lib/permissions"
import { getInviteLimiter } from "../../../../lib/rate-limit"
import { sendMail } from "../../../../lib/email"
import { renderTemplate } from "../../../../lib/render-template"

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })

  const { session } = await requireProjectRole(event, projectId, "owner")
  const body = await readValidatedBody(event, (b: unknown) =>
    CreateProjectInvitationInput.parse(b),
  )
  const email = body.email.toLowerCase()

  const inviteLimiter = await getInviteLimiter()
  const take = await inviteLimiter.take(`invite:${session.userId}`)
  if (!take.allowed) {
    event.node.res.setHeader("Retry-After", Math.ceil(take.retryAfterMs / 1000).toString())
    throw createError({ statusCode: 429, statusMessage: "Too many invites — slow down" })
  }

  const [settings] = await db.select().from(appSettings).limit(1)
  if (settings?.signupGated && settings.allowedEmailDomains.length > 0) {
    const domain = email.split("@")[1]?.toLowerCase() ?? ""
    if (!settings.allowedEmailDomains.includes(domain)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Email domain "${domain}" is not on this install's allowlist`,
      })
    }
  }

  let [targetUser] = await db.select().from(user).where(eq(user.email, email))
  if (targetUser) {
    const [alreadyMember] = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, targetUser.id),
        ),
      )
    if (alreadyMember) {
      throw createError({ statusCode: 409, statusMessage: "User is already a member" })
    }
  } else {
    // Pre-create invited user row so the magic-link sign-in path works for a
    // brand-new email; the existing after-hook flips status → active on first
    // successful sign-in.
    const [inserted] = await db
      .insert(user)
      .values({
        id: randomBytes(16).toString("hex"),
        email,
        name: email.split("@")[0] ?? email,
        emailVerified: false,
        role: "member",
        status: "invited",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
    if (!inserted) {
      throw createError({ statusCode: 500, statusMessage: "Failed to create user" })
    }
    targetUser = inserted
  }

  const [existingPending] = await db
    .select()
    .from(projectInvitations)
    .where(
      and(
        eq(projectInvitations.projectId, projectId),
        eq(projectInvitations.email, email),
        eq(projectInvitations.status, "pending"),
      ),
    )
  if (existingPending) {
    throw createError({
      statusCode: 409,
      statusMessage: "An invitation is already pending for this email — resend it instead",
    })
  }

  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
  const [created] = await db
    .insert(projectInvitations)
    .values({
      projectId,
      email,
      role: body.role,
      token,
      status: "pending",
      invitedBy: session.userId,
      expiresAt,
    })
    .returning()
  if (!created) {
    throw createError({ statusCode: 500, statusMessage: "Failed to create invitation" })
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId))

  const acceptUrl = `${env.BETTER_AUTH_URL}/invitations/${token}`
  const html = await renderTemplate("project-invite", {
    projectName: project?.name ?? "a Repro project",
    inviterName: session.email,
    inviterEmail: session.email,
    role: body.role,
    acceptUrl,
    expiresDays: "7",
  })
  void sendMail({ to: email, subject: `You've been invited to ${project?.name ?? "Repro"}`, html }).catch(
    (err: unknown) => {
      console.error(`[project-invite] email delivery failed for ${email}:`, err)
    },
  )

  event.node.res.statusCode = 201
  return {
    id: created.id,
    projectId,
    email,
    role: created.role,
    status: created.status,
    invitedByUserId: session.userId,
    invitedByEmail: session.email,
    createdAt: created.createdAt.toISOString(),
    expiresAt: created.expiresAt.toISOString(),
  }
})
```

- [ ] **Step 4: Run the test — expect pass**

Run: `bun test tests/api/project-invitations.test.ts -t "brand-new email"`

Expected: PASS.

- [ ] **Step 5: Add the remaining POST behavior tests**

Append to `tests/api/project-invitations.test.ts`:

```ts
  test("inviting an already-active user does not create a new user row", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("alice@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "alice@example.com", role: "viewer" }),
    })
    expect(status).toBe(201)

    const rows = await db.select().from(user).where(eq(user.email, "alice@example.com"))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe("active") // untouched
  })

  test("duplicate pending invite for same project+email returns 409", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "bob@example.com", role: "developer" }),
    })
    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "bob@example.com", role: "developer" }),
    })
    expect(status).toBe(409)
  })

  test("inviting an email that is already a project member returns 409", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("member@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    // Add directly via legacy endpoint to prime membership.
    await apiFetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "member@example.com", role: "viewer" }),
    })

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "member@example.com", role: "developer" }),
    })
    expect(status).toBe(409)
  })

  test("domain allowlist blocks invites to off-allowlist domains", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await db.execute(
      sql`UPDATE app_settings SET signup_gated = true, allowed_email_domains = '{"example.com"}'::text[] WHERE id = 1`,
    )

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "outsider@other.com", role: "developer" }),
    })
    expect(status).toBe(400)
  })

  test("non-owner cannot create an invitation", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("viewer@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")
    const viewerCookie = await signIn("viewer@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "viewer@example.com", role: "viewer" }),
    })

    const { status } = await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ email: "x@example.com", role: "developer" }),
    })
    expect(status).toBe(403)
  })
```

- [ ] **Step 6: Run all POST tests — expect pass**

Run: `bun test tests/api/project-invitations.test.ts`

Expected: all 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/server/api/projects/\[id\]/invitations/index.post.ts \
        apps/dashboard/tests/api/project-invitations.test.ts
git commit -m "feat(dashboard): POST /api/projects/:id/invitations"
```

---

## Task 5: `GET /api/projects/:id/invitations` — list pending

**Files:**
- Create: `apps/dashboard/server/api/projects/[id]/invitations/index.get.ts`
- Modify: `apps/dashboard/tests/api/project-invitations.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```ts
  test("owner can list only pending invitations for a project", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")

    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "a@example.com", role: "viewer" }),
    })
    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "b@example.com", role: "developer" }),
    })

    const { status, body } = await apiFetch<ProjectInvitationDTO[]>(
      `/api/projects/${projectId}/invitations`,
      { headers: { cookie: ownerCookie } },
    )
    expect(status).toBe(200)
    const list = body as ProjectInvitationDTO[]
    expect(list).toHaveLength(2)
    expect(list.map((i) => i.email).sort()).toEqual(["a@example.com", "b@example.com"])
    expect(list.every((i) => i.status === "pending")).toBe(true)
  })
```

- [ ] **Step 2: Run — expect fail**

Run: `bun test tests/api/project-invitations.test.ts -t "list only pending"`

Expected: FAIL (GET route doesn't exist).

- [ ] **Step 3: Implement**

Create `apps/dashboard/server/api/projects/[id]/invitations/index.get.ts`:

```ts
import { and, eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../../db"
import { projectInvitations, user } from "../../../../db/schema"
import { requireProjectRole } from "../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "missing project id" })
  await requireProjectRole(event, projectId, "owner")

  const rows = await db
    .select({
      id: projectInvitations.id,
      projectId: projectInvitations.projectId,
      email: projectInvitations.email,
      role: projectInvitations.role,
      status: projectInvitations.status,
      invitedByUserId: projectInvitations.invitedBy,
      invitedByEmail: user.email,
      createdAt: projectInvitations.createdAt,
      expiresAt: projectInvitations.expiresAt,
    })
    .from(projectInvitations)
    .leftJoin(user, eq(user.id, projectInvitations.invitedBy))
    .where(
      and(
        eq(projectInvitations.projectId, projectId),
        eq(projectInvitations.status, "pending"),
      ),
    )
    .orderBy(projectInvitations.createdAt)

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
  }))
})
```

- [ ] **Step 4: Run — expect pass**

Run: `bun test tests/api/project-invitations.test.ts -t "list only pending"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/api/projects/\[id\]/invitations/index.get.ts \
        apps/dashboard/tests/api/project-invitations.test.ts
git commit -m "feat(dashboard): GET /api/projects/:id/invitations"
```

---

## Task 6: `DELETE /api/projects/:id/invitations/:invitationId` — revoke

**Files:**
- Create: `apps/dashboard/server/api/projects/[id]/invitations/[invitationId]/index.delete.ts`
- Modify: `apps/dashboard/tests/api/project-invitations.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
  test("owner can revoke a pending invitation", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    const { body: created } = await apiFetch<ProjectInvitationDTO>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "x@example.com", role: "developer" }),
      },
    )
    const invitationId = (created as ProjectInvitationDTO).id

    const { status } = await apiFetch(
      `/api/projects/${projectId}/invitations/${invitationId}`,
      { method: "DELETE", headers: { cookie: ownerCookie } },
    )
    expect(status).toBe(200)

    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, invitationId))
    expect(row?.status).toBe("revoked")
  })
```

Add `projectInvitations` to the existing import line at the top of the file if not already present.

- [ ] **Step 2: Run — expect fail**

Run: `bun test tests/api/project-invitations.test.ts -t "revoke"`

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/dashboard/server/api/projects/[id]/invitations/[invitationId]/index.delete.ts`:

```ts
import { and, eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../../../db"
import { projectInvitations } from "../../../../../db/schema"
import { requireProjectRole } from "../../../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const invitationId = getRouterParam(event, "invitationId")
  if (!projectId || !invitationId)
    throw createError({ statusCode: 400, statusMessage: "missing id" })

  await requireProjectRole(event, projectId, "owner")

  const [existing] = await db
    .select()
    .from(projectInvitations)
    .where(
      and(
        eq(projectInvitations.id, invitationId),
        eq(projectInvitations.projectId, projectId),
      ),
    )
  if (!existing) throw createError({ statusCode: 404, statusMessage: "Invitation not found" })
  if (existing.status !== "pending") {
    throw createError({
      statusCode: 409,
      statusMessage: `Invitation is ${existing.status}`,
    })
  }

  await db
    .update(projectInvitations)
    .set({ status: "revoked" })
    .where(eq(projectInvitations.id, invitationId))

  return { ok: true }
})
```

- [ ] **Step 4: Run — expect pass**

Run: `bun test tests/api/project-invitations.test.ts -t "revoke"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/api/projects/\[id\]/invitations/\[invitationId\]/index.delete.ts \
        apps/dashboard/tests/api/project-invitations.test.ts
git commit -m "feat(dashboard): revoke pending project invitation"
```

---

## Task 7: `POST /api/projects/:id/invitations/:invitationId/resend`

**Files:**
- Create: `apps/dashboard/server/api/projects/[id]/invitations/[invitationId]/resend.post.ts`
- Modify: `apps/dashboard/tests/api/project-invitations.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
  test("owner can resend a pending invitation — bumps expiresAt", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    const { body: created } = await apiFetch<ProjectInvitationDTO>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "resend@example.com", role: "developer" }),
      },
    )
    const invitationId = (created as ProjectInvitationDTO).id
    const originalExpiry = new Date((created as ProjectInvitationDTO).expiresAt).getTime()

    // Wait a tick so the bumped timestamp differs.
    await new Promise((r) => setTimeout(r, 25))

    const { status } = await apiFetch(
      `/api/projects/${projectId}/invitations/${invitationId}/resend`,
      { method: "POST", headers: { cookie: ownerCookie } },
    )
    expect(status).toBe(200)

    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, invitationId))
    expect(row?.expiresAt.getTime()).toBeGreaterThan(originalExpiry)
  })

  test("resending a non-pending invitation returns 409", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Test Project" }),
    })
    const projectId = (project as ProjectDTO).id

    const { body: created } = await apiFetch<ProjectInvitationDTO>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "revoke@example.com", role: "developer" }),
      },
    )
    const invitationId = (created as ProjectInvitationDTO).id
    await apiFetch(`/api/projects/${projectId}/invitations/${invitationId}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    })
    const { status } = await apiFetch(
      `/api/projects/${projectId}/invitations/${invitationId}/resend`,
      { method: "POST", headers: { cookie: ownerCookie } },
    )
    expect(status).toBe(409)
  })
```

- [ ] **Step 2: Run — expect fail**

Run: `bun test tests/api/project-invitations.test.ts -t "resend"`

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/dashboard/server/api/projects/[id]/invitations/[invitationId]/resend.post.ts`:

```ts
import { and, eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../../../db"
import { projectInvitations, projects } from "../../../../../db/schema"
import { env } from "../../../../../lib/env"
import { requireProjectRole } from "../../../../../lib/permissions"
import { getInviteLimiter } from "../../../../../lib/rate-limit"
import { sendMail } from "../../../../../lib/email"
import { renderTemplate } from "../../../../../lib/render-template"

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, "id")
  const invitationId = getRouterParam(event, "invitationId")
  if (!projectId || !invitationId)
    throw createError({ statusCode: 400, statusMessage: "missing id" })

  const { session } = await requireProjectRole(event, projectId, "owner")

  const inviteLimiter = await getInviteLimiter()
  const take = await inviteLimiter.take(`invite:${session.userId}`)
  if (!take.allowed) {
    event.node.res.setHeader("Retry-After", Math.ceil(take.retryAfterMs / 1000).toString())
    throw createError({ statusCode: 429, statusMessage: "Too many invites — slow down" })
  }

  const [existing] = await db
    .select()
    .from(projectInvitations)
    .where(
      and(
        eq(projectInvitations.id, invitationId),
        eq(projectInvitations.projectId, projectId),
      ),
    )
  if (!existing) throw createError({ statusCode: 404, statusMessage: "Invitation not found" })
  if (existing.status !== "pending") {
    throw createError({
      statusCode: 409,
      statusMessage: `Invitation is ${existing.status}`,
    })
  }

  const newExpiresAt = new Date(Date.now() + INVITE_TTL_MS)
  await db
    .update(projectInvitations)
    .set({ expiresAt: newExpiresAt })
    .where(eq(projectInvitations.id, invitationId))

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
  const acceptUrl = `${env.BETTER_AUTH_URL}/invitations/${existing.token}`
  const html = await renderTemplate("project-invite", {
    projectName: project?.name ?? "a Repro project",
    inviterName: session.email,
    inviterEmail: session.email,
    role: existing.role,
    acceptUrl,
    expiresDays: "7",
  })
  void sendMail({
    to: existing.email,
    subject: `You've been invited to ${project?.name ?? "Repro"}`,
    html,
  }).catch((err: unknown) => {
    console.error(`[project-invite] resend failed for ${existing.email}:`, err)
  })

  return { ok: true, expiresAt: newExpiresAt.toISOString() }
})
```

- [ ] **Step 4: Run — expect pass**

Run: `bun test tests/api/project-invitations.test.ts -t "resend"`

Expected: both resend tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/api/projects/\[id\]/invitations/\[invitationId\]/resend.post.ts \
        apps/dashboard/tests/api/project-invitations.test.ts
git commit -m "feat(dashboard): resend project invitation"
```

---

## Task 8: `GET /api/invitations/:token` — read invite detail

**Files:**
- Create: `apps/dashboard/server/api/invitations/[token]/index.get.ts`
- Modify: `apps/dashboard/tests/api/project-invitations.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
  test("authenticated invitee can fetch invitation detail by token", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Detail Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "detail@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "detail@example.com"))
    const token = row!.token

    // Brand-new user was pre-created; sign them in.
    const inviteeCookie = await signIn("detail@example.com")

    const { status, body } = await apiFetch<{
      token: string
      projectName: string
      role: string
      email: string
    }>(`/api/invitations/${token}`, { headers: { cookie: inviteeCookie } })

    expect(status).toBe(200)
    expect(body).toMatchObject({
      token,
      projectName: "Detail Project",
      role: "viewer",
      email: "detail@example.com",
    })
  })

  test("unauthenticated request to invitation detail returns 401", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id
    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "anon@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "anon@example.com"))
    const { status } = await apiFetch(`/api/invitations/${row!.token}`)
    expect(status).toBe(401)
  })
```

- [ ] **Step 2: Run — expect fail**

Run: `bun test tests/api/project-invitations.test.ts -t "invitation detail"`

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/dashboard/server/api/invitations/[token]/index.get.ts`:

```ts
import { eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../db"
import { projectInvitations, projects, user } from "../../../db/schema"
import { requireSession } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token")
  if (!token) throw createError({ statusCode: 400, statusMessage: "missing token" })
  await requireSession(event)

  const [invite] = await db
    .select()
    .from(projectInvitations)
    .where(eq(projectInvitations.token, token))
  if (!invite) throw createError({ statusCode: 404, statusMessage: "Invitation not found" })

  const [project] = await db.select().from(projects).where(eq(projects.id, invite.projectId))
  const [inviter] = await db.select().from(user).where(eq(user.id, invite.invitedBy))

  return {
    token,
    projectId: invite.projectId,
    projectName: project?.name ?? "",
    role: invite.role,
    email: invite.email,
    inviterName: inviter?.name ?? null,
    inviterEmail: inviter?.email ?? "",
    expiresAt: invite.expiresAt.toISOString(),
  }
})
```

- [ ] **Step 4: Run — expect pass**

Run: `bun test tests/api/project-invitations.test.ts -t "invitation detail"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/api/invitations/\[token\]/index.get.ts \
        apps/dashboard/tests/api/project-invitations.test.ts
git commit -m "feat(dashboard): GET /api/invitations/:token"
```

---

## Task 9: `POST /api/invitations/:token/accept`

**Files:**
- Create: `apps/dashboard/server/api/invitations/[token]/accept.post.ts`
- Modify: `apps/dashboard/tests/api/project-invitations.test.ts`

- [ ] **Step 1: Write the failing tests**

Append:

```ts
  test("accepting a valid invitation inserts into project_members and marks accepted", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "Accept Project" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "joiner@example.com", role: "developer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "joiner@example.com"))
    const token = row!.token
    const inviteeCookie = await signIn("joiner@example.com")

    const { status, body } = await apiFetch<{ projectId: string; role: string }>(
      `/api/invitations/${token}/accept`,
      { method: "POST", headers: { cookie: inviteeCookie } },
    )
    expect(status).toBe(200)
    expect(body).toMatchObject({ projectId, role: "developer" })

    const [updated] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.token, token))
    expect(updated?.status).toBe("accepted")
    expect(updated?.acceptedAt).toBeInstanceOf(Date)
  })

  test("accepting with a mismatched session email returns 403", async () => {
    await createUser("owner@example.com", "admin")
    await createUser("other@example.com", "member")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "target@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "target@example.com"))
    const token = row!.token

    const otherCookie = await signIn("other@example.com")
    const { status } = await apiFetch(`/api/invitations/${token}/accept`, {
      method: "POST",
      headers: { cookie: otherCookie },
    })
    expect(status).toBe(403)
  })

  test("accepting a revoked invitation returns 409", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id

    const { body: created } = await apiFetch<ProjectInvitationDTO>(
      `/api/projects/${projectId}/invitations`,
      {
        method: "POST",
        headers: { cookie: ownerCookie },
        body: JSON.stringify({ email: "revoked@example.com", role: "viewer" }),
      },
    )
    const invitationId = (created as ProjectInvitationDTO).id
    await apiFetch(`/api/projects/${projectId}/invitations/${invitationId}`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    })

    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, invitationId))
    const inviteeCookie = await signIn("revoked@example.com")

    const { status } = await apiFetch(`/api/invitations/${row!.token}/accept`, {
      method: "POST",
      headers: { cookie: inviteeCookie },
    })
    expect(status).toBe(409)
  })

  test("accepting an expired invitation flips status to expired and returns 409", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "expired@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "expired@example.com"))

    // Backdate expiresAt to force an expired condition.
    await db
      .update(projectInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(projectInvitations.id, row!.id))

    const inviteeCookie = await signIn("expired@example.com")
    const { status } = await apiFetch(`/api/invitations/${row!.token}/accept`, {
      method: "POST",
      headers: { cookie: inviteeCookie },
    })
    expect(status).toBe(409)

    const [after] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, row!.id))
    expect(after?.status).toBe("expired")
  })

  test("accepting twice is idempotent — second call is a no-op 200", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "dup@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "dup@example.com"))
    const cookie = await signIn("dup@example.com")

    const first = await apiFetch(`/api/invitations/${row!.token}/accept`, {
      method: "POST",
      headers: { cookie },
    })
    expect(first.status).toBe(200)
    const second = await apiFetch(`/api/invitations/${row!.token}/accept`, {
      method: "POST",
      headers: { cookie },
    })
    expect(second.status).toBe(200)
  })
```

- [ ] **Step 2: Run — expect fail**

Run: `bun test tests/api/project-invitations.test.ts -t "accept"`

Expected: all accept tests FAIL.

- [ ] **Step 3: Implement**

Create `apps/dashboard/server/api/invitations/[token]/accept.post.ts`:

```ts
import { and, eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../db"
import { projectInvitations, projectMembers } from "../../../db/schema"
import { requireSession } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token")
  if (!token) throw createError({ statusCode: 400, statusMessage: "missing token" })
  const session = await requireSession(event)

  const [invite] = await db
    .select()
    .from(projectInvitations)
    .where(eq(projectInvitations.token, token))
  if (!invite) throw createError({ statusCode: 404, statusMessage: "Invitation not found" })

  if (session.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw createError({ statusCode: 403, statusMessage: "email_mismatch" })
  }

  if (invite.status === "accepted") {
    // Idempotent replay — same payload as a fresh success.
    return { projectId: invite.projectId, role: invite.role }
  }
  if (invite.status === "revoked") {
    throw createError({ statusCode: 409, statusMessage: "revoked" })
  }
  if (invite.status === "expired" || invite.expiresAt.getTime() < Date.now()) {
    if (invite.status !== "expired") {
      await db
        .update(projectInvitations)
        .set({ status: "expired" })
        .where(eq(projectInvitations.id, invite.id))
    }
    throw createError({ statusCode: 409, statusMessage: "expired" })
  }

  // Insert into project_members; catch the unique violation if the user was
  // concurrently added (or accepted twice in close succession).
  try {
    await db.insert(projectMembers).values({
      projectId: invite.projectId,
      userId: session.userId,
      role: invite.role,
      invitedBy: invite.invitedBy,
    })
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code !== "23505") throw err // not a unique violation — bubble up
  }

  await db
    .update(projectInvitations)
    .set({
      status: "accepted",
      acceptedAt: new Date(),
      acceptedBy: session.userId,
    })
    .where(
      and(eq(projectInvitations.id, invite.id), eq(projectInvitations.status, "pending")),
    )

  return { projectId: invite.projectId, role: invite.role }
})
```

- [ ] **Step 4: Run — expect pass**

Run: `bun test tests/api/project-invitations.test.ts -t "accept"`

Expected: all 5 accept tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/api/invitations/\[token\]/accept.post.ts \
        apps/dashboard/tests/api/project-invitations.test.ts
git commit -m "feat(dashboard): accept project invitation"
```

---

## Task 10: `POST /api/invitations/:token/decline`

**Files:**
- Create: `apps/dashboard/server/api/invitations/[token]/decline.post.ts`
- Modify: `apps/dashboard/tests/api/project-invitations.test.ts`

- [ ] **Step 1: Write the failing test**

Append:

```ts
  test("invitee can decline — status goes to revoked, no membership", async () => {
    await createUser("owner@example.com", "admin")
    const ownerCookie = await signIn("owner@example.com")
    const { body: project } = await apiFetch<ProjectDTO>("/api/projects", {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ name: "P" }),
    })
    const projectId = (project as ProjectDTO).id

    await apiFetch(`/api/projects/${projectId}/invitations`, {
      method: "POST",
      headers: { cookie: ownerCookie },
      body: JSON.stringify({ email: "nope@example.com", role: "viewer" }),
    })
    const [row] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.email, "nope@example.com"))
    const cookie = await signIn("nope@example.com")

    const { status } = await apiFetch(`/api/invitations/${row!.token}/decline`, {
      method: "POST",
      headers: { cookie },
    })
    expect(status).toBe(204)

    const [after] = await db
      .select()
      .from(projectInvitations)
      .where(eq(projectInvitations.id, row!.id))
    expect(after?.status).toBe("revoked")
  })
```

- [ ] **Step 2: Run — expect fail**

Run: `bun test tests/api/project-invitations.test.ts -t "decline"`

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/dashboard/server/api/invitations/[token]/decline.post.ts`:

```ts
import { eq } from "drizzle-orm"
import { createError, defineEventHandler, getRouterParam } from "h3"
import { db } from "../../../db"
import { projectInvitations } from "../../../db/schema"
import { requireSession } from "../../../lib/permissions"

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token")
  if (!token) throw createError({ statusCode: 400, statusMessage: "missing token" })
  const session = await requireSession(event)

  const [invite] = await db
    .select()
    .from(projectInvitations)
    .where(eq(projectInvitations.token, token))
  if (!invite) throw createError({ statusCode: 404, statusMessage: "Invitation not found" })
  if (session.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw createError({ statusCode: 403, statusMessage: "email_mismatch" })
  }
  if (invite.status !== "pending") {
    throw createError({ statusCode: 409, statusMessage: invite.status })
  }

  await db
    .update(projectInvitations)
    .set({ status: "revoked", acceptedBy: session.userId, acceptedAt: new Date() })
    .where(eq(projectInvitations.id, invite.id))

  event.node.res.statusCode = 204
  return ""
})
```

- [ ] **Step 4: Run — expect pass**

Run: `bun test tests/api/project-invitations.test.ts -t "decline"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/api/invitations/\[token\]/decline.post.ts \
        apps/dashboard/tests/api/project-invitations.test.ts
git commit -m "feat(dashboard): decline project invitation"
```

---

## Task 11: Accept page (`/invitations/[token]`)

**Files:**
- Create: `apps/dashboard/app/pages/invitations/[token].vue`

- [ ] **Step 1: Author the page**

Create `apps/dashboard/app/pages/invitations/[token].vue`:

```vue
<script setup lang="ts">
import type { InvitationDetailDTO } from "@reprojs/shared"

definePageMeta({ middleware: [] })

const route = useRoute()
const token = computed(() => String(route.params.token))
const toast = useToast()

const invite = ref<InvitationDetailDTO | null>(null)
const errorCode = ref<"email_mismatch" | "expired" | "revoked" | "accepted" | "not_found" | null>(
  null,
)
const pending = ref(true)
const submitting = ref(false)

useHead({ title: "Accept invitation" })

async function load() {
  pending.value = true
  try {
    invite.value = await $fetch<InvitationDetailDTO>(`/api/invitations/${token.value}`, {
      credentials: "include",
    })
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 401) {
      await navigateTo(`/auth/sign-in?returnTo=/invitations/${token.value}`)
      return
    }
    if (status === 404) errorCode.value = "not_found"
    else if (status === 403) errorCode.value = "email_mismatch"
    else errorCode.value = "not_found"
  } finally {
    pending.value = false
  }
}
await load()

async function accept() {
  submitting.value = true
  try {
    const res = await $fetch<{ projectId: string; role: string }>(
      `/api/invitations/${token.value}/accept`,
      { method: "POST", credentials: "include" },
    )
    toast.add({ title: "Invitation accepted", color: "success", icon: "i-heroicons-check-circle" })
    await navigateTo(`/projects/${res.projectId}`)
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    const msg = (err as { statusMessage?: string }).statusMessage ?? ""
    if (status === 403 && msg === "email_mismatch") errorCode.value = "email_mismatch"
    else if (status === 409 && msg === "expired") errorCode.value = "expired"
    else if (status === 409 && msg === "revoked") errorCode.value = "revoked"
    else
      toast.add({
        title: "Could not accept invitation",
        description: msg,
        color: "error",
        icon: "i-heroicons-exclamation-triangle",
      })
  } finally {
    submitting.value = false
  }
}

async function decline() {
  submitting.value = true
  try {
    await $fetch(`/api/invitations/${token.value}/decline`, {
      method: "POST",
      credentials: "include",
    })
    await navigateTo("/")
  } catch (err: unknown) {
    toast.add({
      title: "Could not decline",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-md mx-auto p-6 mt-16">
    <UCard v-if="pending">
      <p class="text-sm text-muted">Loading invitation…</p>
    </UCard>

    <UCard v-else-if="errorCode === 'email_mismatch'">
      <h1 class="text-xl font-semibold mb-2">Wrong account</h1>
      <p class="text-sm text-muted mb-4">
        This invitation was sent to a different email. Please sign out and sign in as the invited
        address.
      </p>
      <UButton label="Sign out" to="/api/auth/sign-out" />
    </UCard>

    <UCard v-else-if="errorCode === 'expired'">
      <h1 class="text-xl font-semibold mb-2">This invitation expired</h1>
      <p class="text-sm text-muted">Ask the inviter to resend it.</p>
    </UCard>

    <UCard v-else-if="errorCode === 'revoked'">
      <h1 class="text-xl font-semibold mb-2">This invitation is no longer valid</h1>
      <p class="text-sm text-muted">It was revoked or declined.</p>
    </UCard>

    <UCard v-else-if="errorCode === 'not_found'">
      <h1 class="text-xl font-semibold mb-2">Invitation not found</h1>
    </UCard>

    <UCard v-else-if="invite">
      <h1 class="text-xl font-semibold mb-2">Join {{ invite.projectName }}</h1>
      <p class="text-sm text-muted mb-4">
        {{ invite.inviterName ?? invite.inviterEmail }} invited you to join as
        <strong>{{ invite.role }}</strong
        >.
      </p>
      <div class="flex justify-end gap-2">
        <UButton
          label="Decline"
          color="neutral"
          variant="ghost"
          :loading="submitting"
          @click="decline"
        />
        <UButton label="Accept" color="primary" :loading="submitting" @click="accept" />
      </div>
    </UCard>
  </div>
</template>
```

- [ ] **Step 2: Manual smoke test**

Start the dev server (if not already): `cd apps/dashboard && bun run dev` (per `package.json`'s `"dev": "nuxt dev --host"`).

Log in as an admin, create a project, invite an email you control, open the inbox in a browser, click the link, confirm the accept page shows the project name + role + buttons and that Accept redirects to `/projects/:id`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/app/pages/invitations/\[token\].vue
git commit -m "feat(dashboard): invitation accept page"
```

---

## Task 12: Members page UI — swap invite modal + add pending invites section

**Files:**
- Modify: `apps/dashboard/app/pages/projects/[id]/members.vue`

- [ ] **Step 1: Change the invite modal to call the new endpoint**

Edit `apps/dashboard/app/pages/projects/[id]/members.vue:43-47` so `sendInvite()` POSTs to `/api/projects/${projectId.value}/invitations` instead of `/members`. The body shape is the same `{ email, role }`.

- [ ] **Step 2: Load pending invitations alongside members**

Add to the setup block, after the existing `useApi` for members:

```ts
import type { ProjectInvitationDTO } from "@reprojs/shared"

const {
  data: invitations,
  refresh: refreshInvites,
} = await useApi<ProjectInvitationDTO[]>(
  `/api/projects/${projectId.value}/invitations`,
  { default: () => [] },
)
```

Then in `sendInvite()`, replace `await refresh()` with:

```ts
await Promise.all([refresh(), refreshInvites()])
```

- [ ] **Step 3: Render a pending-invitations block below the members table**

Add below the existing `<UCard>` containing the members `<UTable>`:

```vue
<UCard v-if="isOwner && (invitations ?? []).length > 0" :ui="{ body: 'p-0' }">
  <template #header>
    <div class="px-4 py-3 text-sm font-medium">Pending invitations</div>
  </template>
  <ul class="divide-y divide-default">
    <li
      v-for="inv in invitations"
      :key="inv.id"
      class="flex items-center justify-between px-4 py-3"
    >
      <div>
        <div class="text-sm font-medium">{{ inv.email }}</div>
        <div class="text-xs text-muted">Invited as {{ inv.role }} · expires {{ new Date(inv.expiresAt).toLocaleDateString() }}</div>
      </div>
      <div class="flex gap-2">
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          label="Resend"
          @click="resendInvite(inv.id)"
        />
        <UButton
          size="xs"
          color="error"
          variant="ghost"
          label="Revoke"
          @click="revokeInvite(inv.id)"
        />
      </div>
    </li>
  </ul>
</UCard>
```

And add the matching handlers in the script block:

```ts
async function resendInvite(id: string) {
  try {
    await $fetch(`/api/projects/${projectId.value}/invitations/${id}/resend`, {
      method: "POST",
      credentials: "include",
    })
    toast.add({ title: "Invitation re-sent", color: "success" })
    await refreshInvites()
  } catch (err) {
    toast.add({
      title: "Could not resend",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
    })
  }
}

async function revokeInvite(id: string) {
  const ok = await confirm({
    title: "Revoke invitation?",
    description: "The invitation link will stop working.",
    confirmLabel: "Revoke",
    confirmColor: "error",
  })
  if (!ok) return
  try {
    await $fetch(`/api/projects/${projectId.value}/invitations/${id}`, {
      method: "DELETE",
      credentials: "include",
    })
    toast.add({ title: "Invitation revoked", color: "success" })
    await refreshInvites()
  } catch (err) {
    toast.add({
      title: "Could not revoke",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
    })
  }
}
```

- [ ] **Step 4: Manual smoke test**

Invite a new email from the project members page. Verify:
1. The Pending invitations section shows the new row.
2. Resend keeps the row but updates the timestamp in the DB.
3. Revoke removes it from the section.
4. After the invitee accepts, the row disappears and they appear in the main members table.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/pages/projects/\[id\]/members.vue
git commit -m "feat(dashboard): pending invites on project members page"
```

---

## Task 13: End-to-end sanity run

- [ ] **Step 1: Run all tests in the dashboard package**

Run: `cd apps/dashboard && bun test`

Expected: full test suite passes, including the new `tests/api/project-invitations.test.ts`.

- [ ] **Step 2: Run lint + format**

Run: `bun run check` from the repo root.

Expected: zero oxfmt/oxlint errors.

- [ ] **Step 3: If anything failed**

- If a test fails, STOP and re-plan — do not push through. Document the failure in a note under this task and surface it to the user.
- If lint fails, run `bun run lint:fix && bun run fmt` and re-run `bun run check`.

- [ ] **Step 4: Final checkpoint**

Ask the user to review the merged diff and manually test the full path once more in a browser before merging.

---

## Out-of-scope notes (deliberately not in this plan)

- Expiry cron: accept-time check handles correctness; background sweep to clean UI listings is a follow-up.
- CSV / bulk invites.
- Adopting better-auth's `organization` plugin — explicitly rejected during brainstorming.
