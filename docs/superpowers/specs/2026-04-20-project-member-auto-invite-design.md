# Project member auto-invite design

Status: approved for implementation
Date: 2026-04-20
Owner: JJ

## Problem

`POST /api/projects/:id/members` requires the invitee to already exist in the
install, and 404s otherwise. Owners who want to add a teammate that hasn't yet
signed up have to:

1. Abandon the members page.
2. Go to Settings → Users and invite them install-wide.
3. Wait for that person to sign in.
4. Come back to the members page and add them again.

This is four steps for what should be one, and the asynchronous gap (the owner
has to remember to come back) means in practice the teammate often never gets
added.

## Goals

- From the members page, an owner can invite any email address, whether or not
  they already have an account on this install.
- The invitee receives an email with a single accept link. Clicking it either
  signs them in (if they already have an account), prompts them to sign up via
  magic link / OAuth (if they don't), or — in both cases — lands them on an
  accept page that shows the project and role and has an explicit
  **Accept** / **Decline** button.
- The existing install-wide invite flow (`POST /api/users`) is untouched.
- Install-level sign-up gates (`signupGated`, `allowedEmailDomains`) continue
  to apply exactly as they do to install-wide invites today.

## Non-goals

- No GitHub- or Slack-style "join this org by link" public invite links. All
  invites are email-scoped.
- No bulk CSV invites.
- No change to the role model (`owner` / `developer` / `viewer`).
- No change to better-auth. We do **not** adopt the better-auth organization
  plugin — our projects aren't multi-tenant workspaces, they're inboxes inside
  one install, and the plugin's schema would conflict with the existing
  `project_members` table for zero functional gain.

## Decisions

- **(Q1)** Scope is the project-members page only. Install-wide invites stay
  as-is.
- **(Q2)** A dedicated `project_invitations` table holds pending invites. We
  don't overload `project_members` with a nullable `userId`.
- **(Q3)** When an invite is created for an email that doesn't yet have a
  `user` row, we create the `user` row (`status=invited`, `role=member`) at
  invite time. This means the invitee can complete sign-in via the normal
  magic-link path without any extra gate carve-out — the existing `after` hook
  in `apps/dashboard/server/lib/auth.ts` (promoteInvitedOrFirstUser) already
  flips `invited` → `active` on first successful sign-in. The
  `project_invitations` row then only has to carry `projectId` + `role`
  through the round-trip.
- **(Q4)** Both new and existing users see the accept page. Auto-acceptance on
  click would surprise existing users and give no clean way to decline.

## Architecture

### Schema

New file `apps/dashboard/server/db/schema/project-invitations.ts`:

```ts
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
```

Invariants enforced in code (not constraints) because pg partial unique
indexes are awkward through drizzle-kit and this is a single admin-only write
path:

- At most one `pending` invite per `(projectId, email)` at a time.
- `acceptedBy` is always the `user.id` whose email matches `invite.email`.

`token` is a 32-byte hex (`crypto.randomBytes(32).toString("hex")`), matching
the entropy of the existing magic-link and attachment-signing tokens. The
token appears only in the email link and is never logged.

Emails are lowercased before insert and before all lookups.

### API

All project-scoped endpoints require the calling session to be `owner` on the
project (reusing `requireProjectRole(event, projectId, "owner")`). The token
endpoints require an authenticated session but not a specific role.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/projects/:id/invitations` | Create a new pending invite. |
| `GET` | `/api/projects/:id/invitations` | List pending invites for a project. |
| `DELETE` | `/api/projects/:id/invitations/:invitationId` | Revoke a pending invite. |
| `POST` | `/api/projects/:id/invitations/:invitationId/resend` | Re-send the email and bump `expiresAt`. |
| `GET` | `/api/invitations/:token` | Read invite for display on the accept page. |
| `POST` | `/api/invitations/:token/accept` | Accept the invite. |
| `POST` | `/api/invitations/:token/decline` | Decline the invite. |

The existing `POST /api/projects/:id/members` stays for test scaffolding
and direct admin utility, but the dashboard UI no longer calls it — all
invite-driven additions go through the new endpoints.

#### `POST /api/projects/:id/invitations`

Body:

```ts
type CreateProjectInvitationInput = {
  email: string // valid RFC 5322, normalized to lowercase
  role: "owner" | "developer" | "viewer"
}
```

Behavior (in order):

1. Require project `owner` role via `requireProjectRole`.
2. Throttle via the existing `inviteLimiter` (see `server/lib/rate-limit.ts`)
   keyed by `invite:${session.userId}`. Same limiter as install-invites so the
   total outbound-email rate per admin stays capped across both flows.
3. Apply install-level sign-up gate:
   - If `appSettings.signupGated && allowedEmailDomains.length > 0` and
     `email`'s domain is not in the allowlist → 400.
4. Look up existing `user` by email.
   - If found and is already a `project_members` row for this project → 409.
   - If found → proceed with their existing `user.id`.
   - If not found → insert a `user` row with `status=invited`, `role=member`
     (same pattern as `/api/users`). This is the key difference from the
     current members endpoint.
5. Look up existing `pending` invite for `(projectId, email)` → 409 with
   "Invitation already pending — use resend."
6. Insert `project_invitations` row with a fresh token, `expiresAt = now + 7d`,
   `invitedBy = session.userId`, `status = pending`.
7. Fire-and-forget email (see `users/index.post.ts` for the pattern — catches
   errors so better-auth's session heartbeat doesn't race SMTP latency):
   - Template: new `server/emails/project-invite.html`.
   - Variables: `projectName`, `inviterName`, `inviterEmail`, `role`,
     `acceptUrl = ${BETTER_AUTH_URL}/invitations/<token>`, `expiresDays = 7`.
8. Return `ProjectInvitationDTO`.

#### `POST /api/invitations/:token/accept`

Behavior:

1. Require an authenticated session (if not, 401 — the UI catches this and
   redirects to `/auth/sign-in?returnTo=/invitations/<token>`).
2. Look up invite by token. If none, 404.
3. Reject if `status !== 'pending'` (409 with the specific reason:
   `already_accepted`, `revoked`, or — if `expiresAt < now` — `expired`;
   the server also flips a time-expired row to `status=expired` on this path
   so the UI sees a stable state next time).
4. Reject if `session.user.email.toLowerCase() !== invite.email` (403 with
   `email_mismatch`). This prevents Alice from accepting Bob's invite by
   cookie-swapping — a cheap but important check.
5. Insert into `project_members` (`projectId`, `userId = session.userId`,
   `role = invite.role`, `invitedBy = invite.invitedBy`).
6. Update invitation: `status=accepted`, `acceptedAt=now`, `acceptedBy =
   session.userId`.
7. Return `{ projectId, role }` so the UI can redirect to `/projects/:id`.

Races: a user double-clicking Accept, or two tabs open, can cause two
concurrent insertions. `project_members` has a composite PK on
`(projectId, userId)` which makes the second insert a no-op (unique
violation) — the endpoint catches the unique-violation and returns 200
with the same payload (idempotent).

#### `POST /api/invitations/:token/decline`

Sets `status=revoked` with `acceptedBy=session.userId` (reusing the column as
"closed by" for audit). Doesn't alter `project_members`. Returns `204`.

### Accept page

New file `apps/dashboard/app/pages/invitations/[token].vue`.

- Uses `useApi` to call `GET /api/invitations/:token`.
- If the request 401s (not signed in), use `navigateTo` with
  `?returnTo=/invitations/<token>` to send them through `/auth/sign-in`.
- If it 403s with `email_mismatch`, render a page that says "You're signed
  in as X@Y but this invite is for A@B — please sign out and sign in as
  A@B" (with a Sign-out button).
- If it 404s or 409s (`expired`, `revoked`, `already_accepted`), render a
  matching error state.
- Otherwise show the project name, the role, and **Accept** / **Decline**
  buttons.
- Accept calls `POST /api/invitations/:token/accept`, then redirects to
  `/projects/:projectId` with a success toast.

### Members page UI changes

`apps/dashboard/app/pages/projects/[id]/members.vue`:

- The "Invite member" modal now calls `POST /api/projects/:id/invitations`
  instead of `POST /api/projects/:id/members`.
- The table gains a second section (or a tab) for **Pending invites** fed by
  `GET /api/projects/:id/invitations`. Each row shows email, role, invited-by,
  invited-at, and a dropdown with **Resend** and **Revoke**.

### Email template

New file `apps/dashboard/server/emails/project-invite.html`, modeled on
`invite.html`. Variables:

- `projectName`
- `inviterName` and `inviterEmail`
- `role` (human-cased: "owner" → "Owner", etc.)
- `acceptUrl`
- `expiresDays`

The call site uses the same `sendMail({ to, subject, html }).catch(...)`
pattern as `server/api/users/index.post.ts` — fire-and-forget so SMTP
latency can't race the admin session heartbeat.

### Shared types (`packages/shared`)

Additions:

```ts
export const CreateProjectInvitationInput = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "developer", "viewer"]),
})

export type ProjectInvitationDTO = {
  id: string
  projectId: string
  email: string
  role: ProjectRole
  status: "pending" | "accepted" | "revoked" | "expired"
  invitedByUserId: string
  invitedByEmail: string | null
  createdAt: string
  expiresAt: string
}

export type InvitationDetailDTO = {
  token: string
  projectId: string
  projectName: string
  role: ProjectRole
  email: string
  inviterName: string | null
  inviterEmail: string
  expiresAt: string
}
```

## Security

- **Token entropy:** 256 bits (32 random bytes, hex). Brute force is
  infeasible; the 7-day expiry provides defense in depth.
- **Token leakage:** the `GET /api/invitations/:token` endpoint requires an
  authenticated session, so a leaked token alone doesn't reveal the invite
  contents.
- **Account-takeover via invite:** blocked by the `session.user.email ===
  invite.email` check in the accept endpoint. An attacker who obtains the
  token cannot accept the invite into their own account.
- **Sign-up gate bypass:** the gate is enforced at invite creation (same as
  `/api/users`), so an owner can't pull in a blocked domain by inviting
  them directly. After invite, the gate naturally accepts the new user
  because their row is `status=invited`.
- **Email enumeration:** `POST /api/projects/:id/invitations` returns the
  same response whether or not a `user` row pre-existed. The rate-limit
  response is the same shape as today's install-invite 429.

## Testing

Follow the existing test layout in `apps/dashboard/tests/api/`. Use
`tests/helpers.ts` to stand up the real Postgres container and seed an
admin.

New file `tests/api/project-invitations.test.ts`:

1. Owner can create an invitation for a brand-new email: the `user` row is
   created with `status=invited`, the `project_invitations` row is
   `pending`, and an email is queued.
2. Owner can create an invitation for an existing active user: no `user`
   row is created; only the invitation.
3. Creating a second pending invite for the same `(projectId, email)`
   returns 409.
4. Creating an invite where the email is already a project member returns
   409.
5. Creating an invite for a domain not on the allowlist (when
   `signupGated=true`) returns 400.
6. Non-owner calling POST returns 403.
7. `GET /api/projects/:id/invitations` lists only `pending` rows.
8. `DELETE /api/projects/:id/invitations/:id` flips status to `revoked`.
9. `POST .../resend` on a pending invite bumps `expiresAt` and re-sends
   email; on a non-pending invite returns 409.
10. `GET /api/invitations/:token` returns `InvitationDetailDTO` for a valid
    pending token.
11. `POST /api/invitations/:token/accept` succeeds when session email
    matches; inserts `project_members`; flips invite to `accepted`.
12. Accepting with a mismatched session email returns 403 with
    `email_mismatch`.
13. Accepting a revoked invite returns 409 with `revoked`.
14. Accepting an expired invite flips the row to `status=expired` and
    returns 409 with `expired`.
15. Accepting the same invite twice is idempotent (second call is a no-op
    that returns 200).
16. Declining sets status to `revoked` without inserting into
    `project_members`.

Update `tests/api/members.test.ts` only where it currently exercises the
full invite-by-email path — those cases move to the new test file. Direct
`POST /api/projects/:id/members` behavior is still worth keeping as an
admin fallback but is no longer the UI entry point.

## Open follow-ups (out of scope)

- Auto-expiring cron job to flip `pending` → `expired` so UI listings show
  the correct status without hitting the accept path. Lazy expiry is fine
  for v1 because listings can filter `expiresAt > now()`.
- Email-forward protection: if a user forwards the invite link, the
  recipient can accept if and only if they sign in as the invited email.
  This is already enforced by the email-match check but is worth calling
  out in the user-facing docs.

## Files touched

**New:**

- `apps/dashboard/server/db/schema/project-invitations.ts`
- `apps/dashboard/server/db/migrations/<next>_project_invitations.sql`
- `apps/dashboard/server/api/projects/[id]/invitations/index.get.ts`
- `apps/dashboard/server/api/projects/[id]/invitations/index.post.ts`
- `apps/dashboard/server/api/projects/[id]/invitations/[invitationId]/index.delete.ts`
- `apps/dashboard/server/api/projects/[id]/invitations/[invitationId]/resend.post.ts`
- `apps/dashboard/server/api/invitations/[token]/index.get.ts`
- `apps/dashboard/server/api/invitations/[token]/accept.post.ts`
- `apps/dashboard/server/api/invitations/[token]/decline.post.ts`
- `apps/dashboard/server/emails/project-invite.html`
- `apps/dashboard/app/pages/invitations/[token].vue`
- `apps/dashboard/tests/api/project-invitations.test.ts`
- `packages/shared/src/project-invitations.ts`

**Modified:**

- `apps/dashboard/server/db/schema/index.ts` — export new table
- `apps/dashboard/app/pages/projects/[id]/members.vue` — swap invite modal
  target, add pending-invites section
- `packages/shared/src/index.ts` — export new types
