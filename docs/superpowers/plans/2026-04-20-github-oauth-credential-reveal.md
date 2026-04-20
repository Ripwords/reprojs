# GitHub OAuth Credential Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the install admin a safe, audited way to read the GitHub App's `client_id` / `client_secret` from the settings page after the manifest flow, so they can paste them into `.env` and enable better-auth GitHub sign-in with one restart.

**Architecture:** New admin-only `GET /api/integrations/github/oauth-credentials` endpoint reads the singleton `github_app` DB row (Drizzle's `encryptedText` decrypts on read), emits a structured `console.info` audit line, returns JSON with `Cache-Control: no-store`. Settings page gains a "GitHub sign-in credentials" panel — `clientId` always visible, `clientSecret` masked behind a **Reveal** button that re-masks after 30 seconds or on navigation. Existing better-auth `socialProviders.github` wiring in `server/lib/auth.ts` stays env-only; admin pastes revealed values into `.env` and restarts.

**Tech Stack:** Nuxt 4 / Nitro server routes, Drizzle ORM (Postgres), `encryptedText` custom type (AES-256-GCM), better-auth (for session gating via `requireInstallAdmin`), Vue 3 `<script setup>`, Nuxt UI 3 (`UCard`, `UButton`, `UInput`, `UBadge`), bun test.

**Spec:** `docs/superpowers/specs/2026-04-20-github-oauth-credential-reveal-design.md`

---

## Pre-flight Checks

- [ ] **Verify the Nuxt dev server is running.** Most tests in this repo hit a live server.

  Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/me`
  Expected: `401` (server up, unauthenticated) or `200`.
  If it prints an error: start it with `bun run dev` from `apps/dashboard/` in a second terminal and wait for "ready".

- [ ] **Verify `ENCRYPTION_KEY` is set in the dev process env.**

  Run (inside the dashboard dir): `bun -e 'console.log(!!process.env.ENCRYPTION_KEY)'`
  Expected: `true`. If `false`, generate one and add it to `apps/dashboard/.env`:
  `echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> apps/dashboard/.env` and restart the dev server.

- [ ] **Verify `truncateGithubApp` is going to need to exist.** We'll add it in Task 2 because the existing `truncateGithub` helper only truncates `github_integrations` / `report_sync_jobs`, not the `github_app` singleton.

  Run: `grep -n "truncateGithub\b\|github_app" apps/dashboard/tests/helpers.ts`
  Expected: only matches for `truncateGithub` (the `_integrations` truncator), no `github_app` reference.

---

## Task 1: Add `truncateGithubApp` test helper

**Files:**
- Modify: `apps/dashboard/tests/helpers.ts:153`

Tests need to reset the `github_app` singleton row between runs. The existing `truncateGithub` helper handles `github_integrations` only — it doesn't know about the separate `github_app` table added by the manifest flow.

- [ ] **Step 1: Add the helper**

Open `apps/dashboard/tests/helpers.ts`. Just under the existing `truncateGithub` function (line 153), add:

```ts
export async function truncateGithubApp() {
  await db.execute(sql`TRUNCATE github_app RESTART IDENTITY CASCADE`)
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/tests/helpers.ts
git commit -m "test: add truncateGithubApp helper for manifest-install tests"
```

---

## Task 2: TDD the oauth-credentials endpoint — test file

**Files:**
- Create: `apps/dashboard/tests/api/oauth-credentials.test.ts`

This test file exercises the endpoint end-to-end against the live Nuxt dev server. It seeds a `github_app` row directly (Drizzle's `encryptedText` encrypts on write), then asserts auth gates, response shape, headers, and audit logging.

- [ ] **Step 1: Write the failing test file**

Create `apps/dashboard/tests/api/oauth-credentials.test.ts`:

```ts
import { setup } from "@nuxt/test-utils/e2e"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(60000)
import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { apiFetch, createUser, signIn, truncateDomain, truncateGithubApp } from "../helpers"
import { db } from "../../server/db"
import { githubApp } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })

beforeAll(() => {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error(
      "ENCRYPTION_KEY must be set on the dev server for oauth-credentials tests to encrypt seed rows",
    )
  }
})

describe("GET /api/integrations/github/oauth-credentials", () => {
  afterEach(async () => {
    await truncateGithubApp()
    await truncateDomain()
  })

  test("401 when unauthenticated", async () => {
    const res = await apiFetch("/api/integrations/github/oauth-credentials")
    expect(res.status).toBe(401)
  })

  test("403 when authenticated as non-admin", async () => {
    const userId = await createUser("member@example.com", "member")
    const cookie = await signIn("member@example.com")
    const res = await apiFetch("/api/integrations/github/oauth-credentials", {
      headers: { cookie },
    })
    expect(res.status).toBe(403)
    // Sanity: userId created so the test actually exercised a signed-in session
    expect(userId).toBeTruthy()
  })

  test("404 when admin but no github_app row", async () => {
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")
    const res = await apiFetch("/api/integrations/github/oauth-credentials", {
      headers: { cookie },
    })
    expect(res.status).toBe(404)
  })

  test("200 with decrypted credentials, Cache-Control: no-store, audit log emitted", async () => {
    const adminId = await createUser("admin@example.com", "admin")
    await db.insert(githubApp).values({
      id: 1,
      appId: "12345",
      slug: "repro-test",
      privateKey: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
      webhookSecret: "whsec-test",
      clientId: "Iv1.testclientid",
      clientSecret: "secret-value-xyz",
      htmlUrl: "https://github.com/apps/repro-test",
      createdBy: adminId,
    })

    const infoSpy = spyOn(console, "info").mockImplementation(() => {})

    const cookie = await signIn("admin@example.com")
    const res = await fetch(`${process.env.TEST_BASE_URL ?? "http://localhost:3000"}/api/integrations/github/oauth-credentials`, {
      headers: { cookie },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("no-store")

    const body = (await res.json()) as { clientId: string; clientSecret: string }
    expect(body.clientId).toBe("Iv1.testclientid")
    expect(body.clientSecret).toBe("secret-value-xyz")

    // Audit line: JSON-serialized into a single console.info call.
    const auditCall = infoSpy.mock.calls.find((c) => {
      const arg = c[0]
      return typeof arg === "string" && arg.includes("github_oauth_credential_reveal")
    })
    expect(auditCall).toBeDefined()
    const parsed = JSON.parse(auditCall?.[0] as string)
    expect(parsed.event).toBe("github_oauth_credential_reveal")
    expect(parsed.userId).toBe(adminId)
    expect(typeof parsed.ts).toBe("string")

    infoSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run from `apps/dashboard/`:
```bash
bun test tests/api/oauth-credentials.test.ts
```
Expected: **all 4 tests fail**. Most likely error per-test is the HTTP status mismatch (404 from Nitro's "route not found" instead of the 401/403/404/200 we asserted, or JSON-parse failure on the HTML 404 page for the 200 case).

This is the correct red state — the endpoint does not exist yet.

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/dashboard/tests/api/oauth-credentials.test.ts
git commit -m "test: add failing tests for GitHub OAuth credential reveal endpoint"
```

---

## Task 3: Implement the oauth-credentials endpoint

**Files:**
- Create: `apps/dashboard/server/api/integrations/github/oauth-credentials.get.ts`

- [ ] **Step 1: Write the handler**

Create `apps/dashboard/server/api/integrations/github/oauth-credentials.get.ts`:

```ts
import { createError, defineEventHandler, getRequestIP, setHeader } from "h3"
import { eq } from "drizzle-orm"
import { db } from "../../../db"
import { githubApp } from "../../../db/schema"
import { requireInstallAdmin } from "../../../lib/permissions"

/**
 * Admin-only: reveals the GitHub App's OAuth client_id + client_secret so the
 * operator can paste them into `.env` as GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
 * and restart to enable better-auth GitHub sign-in.
 *
 * The values are decrypted on read by Drizzle's `encryptedText` custom type.
 * `Cache-Control: no-store` is defense-in-depth — the route is auth-gated, but
 * a secret must never be cacheable by any intermediary. Every successful reveal
 * emits a structured `console.info` audit line so operators with a log
 * collector can answer "who saw this secret, when, from where".
 */
export default defineEventHandler(async (event) => {
  const session = await requireInstallAdmin(event)

  const [row] = await db.select().from(githubApp).where(eq(githubApp.id, 1)).limit(1)
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "GitHub App not connected" })
  }

  setHeader(event, "Cache-Control", "no-store")

  console.info(
    JSON.stringify({
      event: "github_oauth_credential_reveal",
      userId: session.userId,
      ip: getRequestIP(event, { xForwardedFor: true }) ?? null,
      ts: new Date().toISOString(),
    }),
  )

  return {
    clientId: row.clientId,
    clientSecret: row.clientSecret,
  }
})
```

- [ ] **Step 2: Run the tests, confirm they pass**

Run from `apps/dashboard/`:
```bash
bun test tests/api/oauth-credentials.test.ts
```
Expected: **4 pass, 0 fail**.

If the 200 test fails with a decryption error, re-check that `ENCRYPTION_KEY` is identical in the dev-server env and the test process env (tests inherit the shell env; the dev server reads `apps/dashboard/.env` via Bun autoload).

- [ ] **Step 3: Run the full dashboard test suite to catch regressions**

```bash
bun test
```
Expected: **no new failures**. Pre-existing unrelated failures (e.g. flaky magic-link tests on first run) are fine — scan the diff between this run and the baseline on `main`.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/server/api/integrations/github/oauth-credentials.get.ts
git commit -m "feat(dashboard): admin endpoint to reveal GitHub OAuth client_id/secret"
```

---

## Task 4: Add the credentials panel to the settings page

**Files:**
- Modify: `apps/dashboard/app/pages/settings/github.vue`

The panel lives inside the same `<template>` as the existing "GitHub App configured" card and the "Enable webhooks" instructions. It only renders when the app is connected via the in-app flow (`status.source === 'db'`) — env-var deployments already have the values in their environment files, so there's nothing to reveal.

- [ ] **Step 1: Add all `<script setup>` state, fetch, timers, and lifecycle hooks**

In the `<script setup>` block of `apps/dashboard/app/pages/settings/github.vue`, just below the existing `const { data: status, refresh } = await useApi<AppStatus>(...)` line (~line 19), add the following. This is one coherent block — all of it lands before the template changes in Step 2 so every identifier the template references is already defined.

```ts
interface OAuthCredentials {
  clientId: string
  clientSecret: string
}

interface AuthProviders {
  github: boolean
  google: boolean
}

const { data: providers, refresh: refreshProviders } = await useApi<AuthProviders>(
  "/api/auth/providers",
)

const revealed = ref<OAuthCredentials | null>(null)
const revealing = ref(false)
const revealError = ref<string | null>(null)
const remainingSec = ref(0)
const copyFailed = ref(false)
const fetchedClientId = ref<string | null>(null)
let hideTimer: ReturnType<typeof setTimeout> | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null

// Client ID is safe to show eagerly — it's semi-public (appears in OAuth
// redirect URLs and on the GitHub App settings page). Client secret stays
// out of the reactive tree until the admin explicitly clicks Reveal.
const clientIdDisplay = computed(
  () => revealed.value?.clientId ?? fetchedClientId.value ?? "",
)

function clearRevealed() {
  revealed.value = null
  remainingSec.value = 0
  copyFailed.value = false
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

async function revealSecret() {
  revealing.value = true
  revealError.value = null
  copyFailed.value = false
  try {
    const creds = await $fetch<OAuthCredentials>(
      "/api/integrations/github/oauth-credentials",
    )
    revealed.value = creds
    remainingSec.value = 30
    countdownTimer = setInterval(() => {
      remainingSec.value = Math.max(0, remainingSec.value - 1)
    }, 1000)
    hideTimer = setTimeout(clearRevealed, 30_000)
  } catch (e: unknown) {
    const err = e as { statusCode?: number; statusMessage?: string; message?: string }
    revealError.value = err.statusMessage ?? err.message ?? "Failed to reveal — try again"
  } finally {
    revealing.value = false
  }
}

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copyFailed.value = false
  } catch {
    copyFailed.value = true
  }
}

onMounted(async () => {
  if (status.value?.configured && status.value.source === "db") {
    try {
      // Eager fetch of clientId only — we read clientSecret from the same
      // payload but throw it away here. The reveal flow re-fetches when the
      // admin clicks to ensure the plaintext only enters the reactive tree
      // as a result of an explicit action.
      const creds = await $fetch<OAuthCredentials>(
        "/api/integrations/github/oauth-credentials",
      )
      fetchedClientId.value = creds.clientId
    } catch {
      fetchedClientId.value = null
    }
  }
})

onBeforeUnmount(clearRevealed)
```

- [ ] **Step 2: Add the credentials panel to the template**

In the same file, just after the "Enable webhooks (manual step)" `<UCard>` (around line 166, before the closing `</div>`), add:

```vue
    <UCard v-if="status?.configured && status.source === 'db'">
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-default">GitHub sign-in credentials</h2>
          <UBadge
            :color="providers?.github ? 'success' : 'warning'"
            variant="subtle"
          >
            {{ providers?.github ? "Sign-in enabled" : "Sign-in not configured" }}
          </UBadge>
        </div>
      </template>
      <div class="space-y-4 text-sm">
        <p class="text-muted">
          Your GitHub App can also power "Sign in with GitHub" in the dashboard. Copy the values
          below into your <code class="font-mono px-1 rounded bg-muted">.env</code> file and
          restart the dashboard.
        </p>

        <div class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-muted mb-1">Client ID</label>
            <div class="flex gap-2">
              <UInput :model-value="clientIdDisplay" readonly class="font-mono flex-1" />
              <UButton
                variant="subtle"
                color="neutral"
                icon="i-heroicons-clipboard"
                :disabled="!clientIdDisplay"
                @click="() => clientIdDisplay && copyToClipboard(clientIdDisplay)"
              >
                Copy
              </UButton>
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-muted mb-1">Client Secret</label>
            <div class="flex gap-2">
              <UInput
                :model-value="revealed ? revealed.clientSecret : '••••••••••••••••'"
                readonly
                :type="revealed ? 'text' : 'password'"
                class="font-mono flex-1"
              />
              <UButton
                v-if="!revealed"
                :loading="revealing"
                variant="subtle"
                color="primary"
                icon="i-heroicons-eye"
                @click="revealSecret"
              >
                Reveal
              </UButton>
              <template v-else>
                <UButton
                  variant="subtle"
                  color="neutral"
                  icon="i-heroicons-clipboard"
                  @click="() => revealed && copyToClipboard(revealed.clientSecret)"
                >
                  Copy
                </UButton>
                <UButton
                  variant="subtle"
                  color="neutral"
                  icon="i-heroicons-eye-slash"
                  @click="clearRevealed"
                >
                  Hide ({{ remainingSec }}s)
                </UButton>
              </template>
            </div>
            <p v-if="copyFailed" class="text-xs text-warning mt-1">
              Copy failed — select and copy the value manually.
            </p>
            <p v-if="revealError" class="text-xs text-error mt-1">
              {{ revealError }}
            </p>
          </div>
        </div>

        <div class="bg-muted/50 rounded p-3 text-xs text-muted space-y-1">
          <p class="font-medium text-default">Add to your .env and restart:</p>
          <pre class="font-mono whitespace-pre-wrap">GITHUB_CLIENT_ID=&lt;your client id&gt;
GITHUB_CLIENT_SECRET=&lt;your client secret&gt;</pre>
        </div>

        <div v-if="!providers?.github" class="flex gap-2">
          <UButton variant="subtle" color="neutral" @click="() => refreshProviders()">
            I've restarted — re-check
          </UButton>
        </div>
      </div>
    </UCard>
```

- [ ] **Step 3: Confirm Nuxt auto-imports**

The script block uses `ref`, `computed`, `onMounted`, `onBeforeUnmount`, `useApi`, and `$fetch` without explicit imports. Nuxt 4's auto-imports cover all of them. No `import` lines are needed.

Run a quick sanity type-check just on this file:
```bash
bun --bun nuxi typecheck 2>&1 | grep -E "settings/github\.vue" || echo "OK — no type errors in settings/github.vue"
```
Expected: `OK — no type errors in settings/github.vue`.

- [ ] **Step 4: Manual smoke test — non-connected path**

1. Open the dev server in a browser: `http://localhost:3000/settings/github` as an admin user.
2. If the app isn't connected yet: the new panel must NOT render. Only the "Create GitHub App" card shows.
3. If `status.source === 'env'`: the new panel must NOT render (existing env-var footer already advises unsetting env vars to migrate).

- [ ] **Step 5: Manual smoke test — connected path**

1. Complete the manifest flow so `status.source === 'db'`.
2. Reload `/settings/github`.
3. Expect:
   - **GitHub sign-in credentials** card appears below the webhooks card.
   - Status badge shows "Sign-in not configured" (warning) because `.env` has no `GITHUB_CLIENT_ID` yet.
   - `Client ID` field populates automatically (eager fetch).
   - `Client Secret` field shows `••••••••••••••••` with a **Reveal** button.
4. Click **Reveal**. Expect:
   - The secret becomes visible for 30s.
   - **Hide (29s)** countdown button replaces Reveal.
   - **Copy** button appears next to the value. Clicking it should copy to clipboard silently (or show "Copy failed" on HTTP / older browsers).
5. Wait 30s without interacting. Expect:
   - Secret auto-masks; countdown disappears; Reveal button returns.
6. Click **Reveal** again, then navigate away to another page and back. Expect:
   - Secret is NOT shown on return — the `onBeforeUnmount` cleared local state.
7. Check the dashboard server log. Expect:
   - For each Reveal click, a single `console.info` line containing `"event":"github_oauth_credential_reveal"`, the admin's userId, the request IP, and the timestamp.
8. Copy the values into `apps/dashboard/.env`:
   ```
   GITHUB_CLIENT_ID=<revealed clientId>
   GITHUB_CLIENT_SECRET=<revealed clientSecret>
   ```
9. Restart the dev server. Reload `/settings/github`. Expect:
   - Status badge flips to "Sign-in enabled" (success).
10. Go to `/auth/sign-in`. Expect:
    - **Continue with GitHub** button is now visible.
    - Clicking it starts the GitHub OAuth flow and signs you in.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/app/pages/settings/github.vue
git commit -m "feat(dashboard): reveal GitHub OAuth credentials on settings page"
```

---

## Task 5: Documentation — self-host setup note

**Files:**
- Modify: `docs/content/2.self-hosting/4.github-app.md` (if it exists; otherwise skip with a one-line commit message noting the doc gap)

- [ ] **Step 1: Find the self-hosting GitHub App docs**

Run: `ls docs/content/ 2>/dev/null && grep -rn "GITHUB_CLIENT_ID\|manifest" docs/ 2>/dev/null | head -10`

If there's no relevant doc file, skip this task. The in-app UI copy is the primary docs surface; the repo-level CLAUDE.md is orthogonal.

- [ ] **Step 2 (only if a relevant doc exists): Add a short section**

Add just after the manifest-flow instructions:

```md
### Enable GitHub sign-in

The GitHub App you just created can also power "Sign in with GitHub". After the
manifest flow completes, open **Settings → GitHub** in the dashboard. The
**GitHub sign-in credentials** card shows the Client ID and (behind a Reveal
button) the Client Secret. Copy them into your `.env` file:

```
GITHUB_CLIENT_ID=<client id from dashboard>
GITHUB_CLIENT_SECRET=<client secret from dashboard>
```

Then restart the dashboard. The "GitHub sign-in" status badge on the same page
should flip from "not configured" to "enabled".
```

- [ ] **Step 3: Commit (if applicable)**

```bash
git add docs/content/
git commit -m "docs: document enabling GitHub sign-in from the manifest-installed app"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full test suite**

Run from `apps/dashboard/`:
```bash
bun test
```
Expected: **no new failures vs. `main`**.

- [ ] **Step 2: Lint + format**

Run from the repo root:
```bash
bun run check
```
Expected: **0 new errors**. Pre-existing warnings in `packages/recorder/` are unrelated (seen in the previous commit).

- [ ] **Step 3: Type check (if a dedicated script exists)**

Run: `bun run typecheck 2>/dev/null || bun --bun nuxi typecheck || echo "no typecheck script — skip"`
Expected: **0 type errors** on changed files.

- [ ] **Step 4: Open a PR via the `pr` skill**

```
/pr
```

Expected body (the skill will draft this — verify it captures):
- Summary: admin-only endpoint + settings panel to reveal the GitHub App's OAuth client_id/secret after manifest install, enabling GitHub sign-in with one restart.
- Test plan: bun test for the endpoint; manual browser smoke test for the reveal/copy/hide/restart flow.
- Links to the spec: `docs/superpowers/specs/2026-04-20-github-oauth-credential-reveal-design.md`.

---

## File Inventory

**New:**
- `apps/dashboard/server/api/integrations/github/oauth-credentials.get.ts`
- `apps/dashboard/tests/api/oauth-credentials.test.ts`

**Modified:**
- `apps/dashboard/tests/helpers.ts` — adds `truncateGithubApp`
- `apps/dashboard/app/pages/settings/github.vue` — adds credentials panel + sign-in status badge
- `docs/content/2.self-hosting/4.github-app.md` — optional, if the file exists

**Untouched (intentional):**
- `apps/dashboard/server/lib/auth.ts` — `socialProviders.github` stays env-only; no runtime rebuild.
- `apps/dashboard/server/lib/auth-providers.ts` — unchanged; already reads env at request time.
- `apps/dashboard/server/lib/github-app-credentials.ts` — credential resolver precedence (env > DB) unchanged.
- `apps/dashboard/server/db/schema/github-app.ts` — no schema changes; reusing existing `encryptedText` columns.
