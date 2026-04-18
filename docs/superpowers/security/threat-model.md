# Feedback Tool Threat Model

## Scope
This document captures the security invariants the feedback-tool platform relies on, the
known tradeoffs, and the attacker capabilities we defend against.

## Identity model
- **Public project keys are not secrets.** They are embedded in every host page's
  `<script>` tag. Abuse mitigation is the per-key rate limit (60/min) and key
  rotation from the project settings page — not concealment. Treat any leaked
  key as "rotate it."
- **Origin header enforcement is browser-only.** A leaked key + curl can POST
  from any origin header. We accept this; the compensating controls are the
  rate limit and admin monitoring of insert volume.

## Intake invariants
- `contentType` on `report_attachments` is **server-set per `kind`**, never
  passed through from client Blob MIME types. Regression-tested.
- Intake endpoint is the only public endpoint with CORS. All other endpoints
  are session-scoped and same-origin.
- 5 MB total payload cap enforced at the multipart reader.

## Collector data
- Host-app strings logged via `console.*` or `feedback.log()` are trusted inputs.
  We apply default regex scrubbers (JWT, GitHub PAT, Slack, AWS, Bearer) as
  defense-in-depth, but this is best-effort — not a guarantee.
- Network URL query strings get `api_key` / `token` / `access_token` / etc.
  redacted by default.
- Request + response bodies are **not captured** by default. Opt-in.
- Cookies matching common sensitive names (`session`, `auth`, `jwt`, etc.) are
  redacted with `__Secure-` / `__Host-` prefix stripping.

## Dashboard rendering
- Any URL rendered as `href` goes through `safeHref()`, which only allows
  `http:` / `https:` / `mailto:`. A `javascript:` URI in a reported pageUrl
  resolves to `#`.
- Report `title` and `description` are rendered via Vue text interpolation
  (`{{ }}`), which HTML-escapes. `v-html` is never used on user-supplied data.

## PII posture
- Reporter email (if provided via `feedback.identify()`) is stored as part of
  the report context.
- Project deletion cascades to reports + attachments at the DB level.
- Attachment blobs on disk are not deleted by the cascade — orphaned files
  are an acceptable v1 state on single-tenant self-host. A cleanup job is a
  future follow-up.
- There is no self-service "delete my data" UI for end-users. GDPR / erasure
  requests are handled by the install's admin deleting the report rows.

## `beforeSend` contract
- Runs synchronously, once, immediately before the intake POST.
- Wrapped in try/catch: if the hook throws, we log to `console.warn` and send
  the original report unmodified (fail-open).
- Returning `null` aborts the submit entirely (silent cancel, no retry).
- Async work inside the hook must be resolved before return.

## Known deferrals
- Signed reports / HMAC on intake payload — not in v1.
- Per-end-user PII deletion UI — future compliance sub-project.
- Server-side replay integrity checks (E) — tracked in sub-project E design.
- Attachment retention policy — admin-configurable via a future sub-project.

## Sub-project F — Ticket inbox

- **Mutation authorization.** Every `PATCH /reports/:id` and `POST /reports/bulk-update` calls `requireProjectRole(event, id, 'developer')`. Viewers get 403. Tested.
- **Assignee scoping.** The picker + validation constrain assignees to `developer` / `owner` members of the same project. Assigning to a viewer (or a user from another project) returns 400. Tested.
- **Concurrent writes.** Last-write-wins on `PATCH`. Two admins racing to change status = whichever hits the DB second wins. The events log records both transitions in order, so the history is intact even if the final state reflects only the last writer.
- **Event log integrity.** Mutation + event inserts share a single DB transaction. Either all events for a mutation land or none; no ghost events.
- **Search performance.** ILIKE on title + description without a trigram index is acceptable up to ~10k reports per project. Follow-up: add `pg_trgm` + GIN on `lower(title || ' ' || coalesce(description, ''))` once real installs need it.
- **DoS mitigation.** Query-param arrays capped at 10 values per key; `q` ≤200 chars; `reportIds` ≤100; `limit` ≤100.

## Sub-project G — GitHub Issues sync

- **App private key** lives only in `GITHUB_APP_PRIVATE_KEY` env. Never logged; never persisted in DB. Missing → install attempts return "GitHub not configured".
- **Webhook HMAC verification** via `crypto.timingSafeEqual` on raw request bytes. Rejected 401 before any DB access.
- **Install callback `state`** is HMAC-signed `{projectId, userId, exp}` with 10-minute TTL. Prevents install-redirect hijacking.
- **Signed attachment URLs** use HMAC-SHA256 over `{projectId, reportId, kind, expiresAt}` with 7-day expiry. Separate `ATTACHMENT_URL_SECRET` env var, rotatable independently of the App private key.
- **Installation token lifecycle** — requested via App JWT, cached in-process, refreshed lazily; never persisted.
- **Mass-enqueue DoS** — bounded by intake's existing rate limits from B. Worker ceiling ~10 jobs/minute well below GitHub's 5000/hr per-installation.
- **Stale sync jobs for deleted rows** — FK CASCADEs on `report_id` and `project_id`.
- **GitHub-side label pollution** — `updateIssueLabels` is full-replacement; manual labels in GitHub get overwritten on next triage sync. Documented.
- **Orphan issues from unlink** — intentional: dashboard explicitly abandons ownership.
