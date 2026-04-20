# GitHub OAuth Credential Reveal — Design

**Date:** 2026-04-20
**Status:** Approved for planning

## Problem

The GitHub App manifest flow already provisions everything needed for both
issue-sync *and* GitHub sign-in — the manifest conversion response includes
`client_id` and `client_secret` alongside `pem` and `webhook_secret`, and the
manifest callback persists them to the `github_app` row (encrypted via
Drizzle's `encryptedText` custom type).

However, `server/lib/auth.ts` wires better-auth's `socialProviders.github` from
`env.GITHUB_CLIENT_ID` / `env.GITHUB_CLIENT_SECRET` only, at module load. So
even after the manifest flow succeeds, GitHub sign-in stays dark until an
operator hand-fills those env vars.

Wiring better-auth to read from the DB at runtime would require either a viral
`await getAuth()` refactor with cache invalidation, or a sidecar OAuth route
reimplementing the provider flow. Both trade implementation complexity against
a one-time setup event.

## Goal

After a successful manifest install, give the install admin a safe,
auditable way to read the GitHub App's `client_id` / `client_secret` from the
settings page so they can paste them into `.env` and restart the dashboard to
enable GitHub sign-in.

## Non-Goals

- Auto-wiring `socialProviders.github` at runtime from DB credentials.
- Writing to `.env` from the web app (breaks Docker image immutability; sketchy
  from a sandboxing perspective).
- Rotating the GitHub App's client secret (separate feature).
- Surfacing the `private_key` or `webhook_secret` for operator copy — those are
  only used server-side and never need a reveal.

## Design

### Data flow

```
Admin connects GitHub App (existing manifest flow)
    ↓
Manifest callback writes clientId/clientSecret to github_app row
(encrypted at rest via Drizzle `encryptedText` — already in place)
    ↓
/settings/github page shows a "GitHub sign-in credentials" panel:
  - clientId: always visible (semi-public — appears in OAuth redirect URLs)
  - clientSecret: masked behind a "Reveal" button
  - Info callout: paste these into .env as GITHUB_CLIENT_ID /
    GITHUB_CLIENT_SECRET, restart
  - Live status: reads /api/auth/providers to show "GitHub sign-in: enabled"
    vs "not configured yet"
    ↓
(clientId comes from the existing /api/integrations/github/app-status
endpoint, which is called on page load and never audit-logged — clientId is
semi-public metadata, same class as slug / appId.)
    ↓
Admin clicks Reveal → GET /api/integrations/github/oauth-credentials
    ↓
Server: requireInstallAdmin → read github_app row (Drizzle decrypts)
       → structured console.info audit line → return JSON, Cache-Control: no-store
    ↓
UI: reveals decrypted values for 30s (countdown), copy buttons appear,
    values are re-masked on timer expiry or navigation away
    ↓
Admin pastes into .env, restarts dashboard
    ↓
Next boot: auth.ts sees GITHUB_CLIENT_ID/SECRET env and registers the
GitHub social provider. /api/auth/providers returns github: true.
```

### Components

#### 1. `server/api/integrations/github/oauth-credentials.get.ts` (new)

- `requireInstallAdmin(event)` — same permission gate as `manifest-start`,
  `manifest-callback`, `install-callback`.
- Reads the singleton `githubApp` row (`id = 1`). If no row, return 404
  `"GitHub App not connected"`.
- Set response header `Cache-Control: no-store` (defense in depth against
  intermediary caches; the response is auth-gated anyway, but a secret should
  never be cacheable).
- Emit a structured audit line via `console.info`:
  ```ts
  console.info(JSON.stringify({
    event: "github_oauth_credential_reveal",
    userId: session.userId,
    ip: getRequestIP(event, { xForwardedFor: true }) ?? null,
    ts: new Date().toISOString(),
  }))
  ```
  Rationale: the reveal is a rare, admin-only event (basically once per
  install). Routing to `console.info` is sufficient for any operator running
  a log collector. A dedicated `credential_access_log` table is deferred
  until a second reveal surface exists.
- Returns `{ clientId, clientSecret }`. Drizzle's `encryptedText` custom type
  decrypts on read, so the handler passes the plaintext straight through.
  clientId is included for convenience — one fetch populates both fields on
  the reveal flow — but the UI gets clientId from the non-audited
  `app-status` endpoint for initial render.

#### 1a. `server/api/integrations/github/app-status.get.ts` (edit)

Adds `clientId` to the existing response payload. This endpoint is called on
every admin page load of `/settings/github` and is NOT audit-logged —
`clientId` is semi-public metadata (appears in OAuth redirect URLs and on the
GitHub App settings page), same class as `slug` and `appId`. Including it
here lets the UI render the clientId without triggering the
`github_oauth_credential_reveal` audit line every page load.

#### 2. `app/pages/settings/github.vue` (edit)

Add a **GitHub sign-in credentials** section that renders only when the GitHub
App is connected (existing `app-status.get.ts` already drives this gate).

- `clientId` — rendered plain in a monospace input with a copy button.
- `clientSecret` — renders as masked dots (`••••••••••••`) by default, with a
  **Reveal** button.
- On **Reveal** click:
  1. `$fetch('/api/integrations/github/oauth-credentials')`.
  2. Replace the mask with the returned value, show a "Hide" button and a
     copy button, and start a 30s countdown.
  3. On countdown reach 0, on `onBeforeUnmount`, or on "Hide" click, clear
     the value from local state and return to masked mode. Clearing from
     state is critical — it drops the plaintext from the Vue reactive tree
     / devtools.
- Copy button uses `navigator.clipboard.writeText`. On failure (older browsers,
  HTTP context), show "Copy failed — select and copy manually" and keep the
  value visible for the remainder of the timer.
- Info callout beneath the credentials:
  > Paste these into your `.env` file as:
  > ```
  > GITHUB_CLIENT_ID=<clientId>
  > GITHUB_CLIENT_SECRET=<clientSecret>
  > ```
  > Then restart the dashboard to enable GitHub sign-in.
- Status row at the top of the panel:
  - Reads `/api/auth/providers` (existing `getAuthProviderStatus`).
  - When `github === true`: green check, "GitHub sign-in is enabled."
  - When `github === false`: warning dot, "GitHub sign-in is not configured
    yet. Add the env vars below and restart."

#### 3. No schema changes

`github_app` row and `encryptedText` custom type already cover storage +
encryption. The new endpoint is a pure read-side projection of existing data.

### Credential precedence (unchanged)

`resolveGithubAppCredentials` in `server/lib/github-app-credentials.ts`
continues to prefer env over DB (option **A** from brainstorming). This
design affects the reveal UI, not the credential resolver. The GitHub App
API-client side of the codebase is unchanged.

### Error handling

| Case | Behavior |
| --- | --- |
| Endpoint called before manifest install | 404 with `"GitHub App not connected"` |
| Non-admin calls endpoint | 403 (via `requireInstallAdmin`) |
| DB read fails | 500; UI shows "Failed to reveal — try again" |
| Clipboard write fails | UI shows "Copy failed — select and copy manually", value stays visible |
| Page navigation while revealed | `onBeforeUnmount` clears plaintext from state |
| Timer fires while tab is backgrounded | `setTimeout` still fires; value re-masks when tab returns |

### Testing

**`server/api/integrations/github/oauth-credentials.test.ts` (new)**
- Non-admin → 403.
- Admin, no `github_app` row → 404 with the expected message.
- Admin, row present → 200 with decrypted `{ clientId, clientSecret }` matching
  the plaintext, `Cache-Control: no-store` header, audit line emitted with the
  expected shape (spy `console.info`).

**`app/pages/settings/github.vue` component tests**
- Panel is absent when `app-status` reports "not connected".
- Panel is present when connected; `clientSecret` starts masked.
- Click Reveal → endpoint called, value shown, copy button present.
- 30s timer re-masks; plaintext no longer in the DOM.
- Manually clicking Hide clears before the timer.
- Status row re-renders correctly for `github: true` vs `github: false` from
  `/api/auth/providers`.

## Out of Scope (Deferred)

- **`credential_access_log` table** — promote the audit trail from
  `console.info` to a table when a second sensitive reveal surface appears (for
  example, S3 access keys, SMTP passwords, or a future "rotate secret" button).
- **Auto-rotation** — `POST /api/integrations/github/rotate-oauth-secret`
  (GitHub's REST API supports it). Separate feature.
- **Post-restart detection** — the status row already reads
  `/api/auth/providers`, so a page refresh post-restart shows the new state;
  no polling needed.

## File Inventory

Changed / new:

- `apps/dashboard/server/api/integrations/github/oauth-credentials.get.ts`
  *(new)* — reveal endpoint.
- `apps/dashboard/tests/api/integrations/github/oauth-credentials.test.ts`
  *(new)* — endpoint tests.
- `apps/dashboard/app/pages/settings/github.vue` *(edit)* — credentials panel,
  status row.
- `apps/dashboard/tests/pages/settings/github.test.ts` *(new or edit,
  depending on current coverage)* — panel behavior tests.

Unchanged but referenced:

- `apps/dashboard/server/api/integrations/github/manifest-callback.get.ts`
- `apps/dashboard/server/lib/github-app-credentials.ts`
- `apps/dashboard/server/lib/permissions.ts` (`requireInstallAdmin`)
- `apps/dashboard/server/db/schema/github-app.ts` (`encryptedText` usage)
- `apps/dashboard/server/lib/auth-providers.ts`
- `apps/dashboard/server/lib/auth.ts`
