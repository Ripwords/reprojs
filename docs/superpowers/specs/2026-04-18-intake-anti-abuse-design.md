# Intake Anti-Abuse — Design

## Goal

Harden the public intake endpoint against accidental and low-effort malicious spam **without** introducing external dependencies, captcha providers, or privacy tradeoffs. Keep the tool comfortable for private/UAT deployments; do not try to solve the public-SaaS threat model in this iteration (deferred — would require HMAC identity or third-party captcha).

## Non-Goals

- Protection against a determined attacker with commercial captcha-solving services
- Public-facing SaaS threat model (requires HMAC or Turnstile)
- Zero-false-positive guarantee for bots
- Replacing existing rate limiting (these stack on top)

## Threat Model — What This Addresses

| Threat | Current defense | This spec adds |
|---|---|---|
| Random script kiddie with stolen `ft_pk_` | Origin allowlist + rate limit | Honeypot, min-time, daily ceiling |
| Naive bot farms crawling leaked keys | Rate limit caps daily damage at 86k/key | Daily ceiling caps at admin-set max; honeypot catches most bots outright |
| Host app integrator accidentally DoSing their own project | Rate limit | Daily ceiling, tighter anon defaults |

**Still unaddressed (deferred):** paid captcha-solving services, distributed botnets, server-side attackers running real browsers. These need HMAC identity or Turnstile.

## Four Defenses

### 1. Honeypot Field

SDK's report form renders a hidden input (`name="website"`, visually hidden via CSS inside Shadow DOM) that legitimate users never interact with. Bots auto-filling forms populate it. The SDK **always** includes this field in the submitted report JSON.

**Intake check:** if `honeypot` in the report JSON is a non-empty string, return 201 with a fake report ID but DO NOT write to DB (tarpit — don't alert the attacker to the rejection). Log a counter metric.

**Field name:** `_hp` in the wire format (shorter, less obviously a honeypot). SDK surface uses the conventional `website` name in the DOM so bots recognize it.

### 2. Min-Time-To-Submit

When the widget opens, the SDK records `openedAt = performance.now()`. On submit, it computes `dwellMs = performance.now() - openedAt` and includes it in the report JSON as `_dwellMs`.

**Intake check:** reject 400 when `_dwellMs < 1500` (1.5s — faster than a human can fill a form). Real users typically spend 10s+ annotating a screenshot and writing a description; the floor is conservative enough to never false-positive.

**Tamperability:** an attacker can forge `_dwellMs`. Fine — this is a layer, not a wall. Defeats naive bots that don't render.

### 3. Per-Project Daily Ceiling

New column on `projects`: `daily_report_cap INTEGER DEFAULT 1000 NOT NULL`. Admin-configurable in project settings.

**Intake check:** before insert, `SELECT COUNT(*) FROM reports WHERE project_id = $1 AND created_at > now() - interval '24 hours'`. If the count already ≥ `daily_report_cap`, return 429 with `Retry-After: 3600`.

**Default: 1000.** Enough for ~40 reports/hour sustained; bigger than any real UAT team. Admins can raise (e.g. 50000) or lower (e.g. 50 for a tiny demo).

**Cost:** one indexed COUNT per intake. With an index on `(project_id, created_at)` — already exists — this is sub-millisecond.

### 4. Tighter Anonymous Rate Limit

Today: `INTAKE_RATE_PER_KEY=60` (per-minute, all submissions).

Change: the rate limiter gets a second, stricter bucket for **anonymous** submissions (no session cookie, no `reporter.userId`). `INTAKE_RATE_PER_KEY_ANON=10` (per-minute). Authenticated submissions still use the full 60/min.

**Anonymous** for this purpose = request payload has no `reporter.userId`. Simple, stateless — matches how Intercom etc. identify sessions. The host app decides whether to pass an identity by calling `feedback.identify({ userId })`; if it does, the reporter is considered authenticated for rate-limit purposes.

Rationale: host apps that have authenticated users can trivially pass a `userId`. Anonymous-only deployments (public widgets, pre-auth flows) take the tighter limit, which is where most abuse lands.

Note: this does NOT verify the userId — a caller can claim any value. That's fine here; this is a rate-limit tier, not an identity trust boundary. Real identity verification is the deferred HMAC-identity work.

## SDK API Changes

Currently: `feedback.init({ projectKey, endpoint })`. Submit payload contains `{ title, description, context, metadata? }`.

After:
- SDK automatically populates `_hp` (empty string) and `_dwellMs` in the submitted JSON — no API surface changes for integrators.
- The honeypot input is rendered inside the Shadow DOM widget, not on the host page. Zero host-app impact.

## Schema Change

One migration (drizzle `db:gen`):

```sql
ALTER TABLE "projects" ADD COLUMN "daily_report_cap" integer DEFAULT 1000 NOT NULL;
```

No new tables. No new indexes (existing `reports (project_id, created_at)` index serves the COUNT query).

## UI Change

Project settings → add a "Daily report limit" number input (1..1,000,000). Placed near existing "Allowed origins". Admin-only. Validated server-side via Zod.

## Intake Endpoint Order of Checks

(Order matters — cheapest rejections first, DB hits last.)

1. CORS preflight (existing)
2. Method + multipart parse (existing)
3. Payload size cap (existing)
4. Parse report JSON + Zod (existing — extend schema to accept `_hp`, `_dwellMs`)
5. **NEW: Min-time check** — reject 400 if `_dwellMs < 1500`
6. Project lookup by key (existing)
7. Origin allowlist (existing — post-v0.6.1 fix)
8. Rate limiter take (existing — key + IP; now two tiers for anon vs authed)
9. **NEW: Daily ceiling check** — SELECT COUNT, reject 429 if over
10. **NEW: Honeypot tarpit** — if `_hp` non-empty, return 201 with fake UUID, DO NOT insert
11. Insert report + attachments (existing)
12. Enqueue sync (existing)

## Configuration Summary

| Env var | Default | Purpose |
|---|---|---|
| `INTAKE_MIN_DWELL_MS` | `1500` | Min time between widget open and submit |
| `INTAKE_RATE_PER_KEY` | `60` | Per-minute cap for authenticated submissions (unchanged) |
| `INTAKE_RATE_PER_KEY_ANON` | `10` | Per-minute cap for anonymous submissions (new) |
| `INTAKE_RATE_PER_IP` | `20` | Per-IP per-minute cap (unchanged) |

Project-level: `daily_report_cap` column (default 1000).

## Testing Strategy

**Unit:**
- Zod schema extension accepts `_hp` and `_dwellMs`, rejects malformed
- Honeypot helper correctly identifies filled vs empty
- Daily-ceiling query returns correct count

**Integration (intake.test.ts):**
- Report with non-empty `_hp` → 201 with fake ID, no row inserted
- Report with `_dwellMs < 1500` → 400
- 1001st report in 24h with default cap → 429
- Anonymous submission over 10/min → 429; authenticated over 10/min but under 60/min → 201
- All four defenses stacked — each independently triggers the correct rejection

## Deferred to Later

- HMAC-identity integration (for SaaS/host-app scenarios where reporters log in to the host app, not feedback-tool)
- Cloudflare Turnstile if captcha turns out to be needed
- Adaptive rate limiting (auto-tightening when a key starts getting abused)
- Per-origin rate limiting (if one origin starts flooding, throttle it specifically)

## Out-of-Scope Explicit List

- No reCAPTCHA, no Turnstile, no captcha of any kind (this iteration)
- No changes to signup gate / email-domain logic
- No new roles
- No SDK login flow
- No cross-site cookie work (that's its own iteration)
