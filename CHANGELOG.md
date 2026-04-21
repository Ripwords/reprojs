# Changelog

## v0.1.14

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.13...v0.1.14)

### 🚀 Enhancements

- **dashboard:** Pending-invitations page + fix stale list after accept ([b7ffeac](https://github.com/Ripwords/reprojs/commit/b7ffeac))

### 🩹 Fixes

- **dashboard:** Invitations page 500s on SSR due to cookie forwarding ([3bd3c66](https://github.com/Ripwords/reprojs/commit/3bd3c66))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.13

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.12...v0.1.13)

### 🚀 Enhancements

- **extension:** Pre-fill Add form with active tab's origin ([ef78c25](https://github.com/Ripwords/reprojs/commit/ef78c25))

### 🩹 Fixes

- **security:** ⚠️  Close H1/H2/M2/M3/M4 from pre-publish audit ([1f7b72a](https://github.com/Ripwords/reprojs/commit/1f7b72a))

### 📖 Documentation

- Add tester Chrome extension guide ([e8d3c58](https://github.com/Ripwords/reprojs/commit/e8d3c58))

### 🏡 Chore

- **ci:** Exempt CHANGELOG files from oxfmt ([0b7dae0](https://github.com/Ripwords/reprojs/commit/0b7dae0))

### 🤖 CI

- **docker:** Create GitHub Release as part of publish workflow ([2514731](https://github.com/Ripwords/reprojs/commit/2514731))

#### ⚠️ Breaking Changes

- **security:** ⚠️  Close H1/H2/M2/M3/M4 from pre-publish audit ([1f7b72a](https://github.com/Ripwords/reprojs/commit/1f7b72a))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.12

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.11...v0.1.12)

### 🩹 Fixes

- **extension:** ⚠️ Harden SW proxy (security review F1/F3/F6/F7) ([1bded3e](https://github.com/Ripwords/reprojs/commit/1bded3e))
- **dashboard:** ⚠️ Pin Docker base image to bun 1.3 ([eec6980](https://github.com/Ripwords/reprojs/commit/eec6980))
- **dashboard:** Copy apps/extension/package.json in Docker build ([88b29f5](https://github.com/Ripwords/reprojs/commit/88b29f5))

### 🏡 Chore

- **ci:** Smoke-build dashboard image + gate release scripts on CI ([85fb50c](https://github.com/Ripwords/reprojs/commit/85fb50c))

#### ⚠️ Breaking Changes

- **extension:** ⚠️ Harden SW proxy (security review F1/F3/F6/F7) ([1bded3e](https://github.com/Ripwords/reprojs/commit/1bded3e))
- **dashboard:** ⚠️ Pin Docker base image to bun 1.3 ([eec6980](https://github.com/Ripwords/reprojs/commit/eec6980))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.11

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.10...v0.1.11)

### 🚀 Enhancements

- **extension:** Scaffold apps/extension MV3 + crxjs skeleton ([62a36a5](https://github.com/Ripwords/reprojs/commit/62a36a5))
- **extension:** Add chrome.storage.local config wrapper ([9a03d07](https://github.com/Ripwords/reprojs/commit/9a03d07))
- **extension:** Add origin matching utility ([b9fd648](https://github.com/Ripwords/reprojs/commit/b9fd648))
- **extension:** Add chrome.permissions helpers ([e1b166e](https://github.com/Ripwords/reprojs/commit/e1b166e))
- **extension:** Add SDK sync script ([1d940b8](https://github.com/Ripwords/reprojs/commit/1d940b8))
- **extension:** Inject SDK via chrome.scripting on tab load ([5384731](https://github.com/Ripwords/reprojs/commit/5384731))
- **extension:** Popup shell + config list component ([1720e78](https://github.com/Ripwords/reprojs/commit/1720e78))
- **extension:** Add-config form with permission request ([282f7ce](https://github.com/Ripwords/reprojs/commit/282f7ce))
- **ci:** Add chrome web store publishing workflow ([030669b](https://github.com/Ripwords/reprojs/commit/030669b))
- **extension:** Sync icons from dashboard SVG at build time ([613f82b](https://github.com/Ripwords/reprojs/commit/613f82b))
- **extension:** Proxy SDK fetch through the service worker ([ff40433](https://github.com/Ripwords/reprojs/commit/ff40433))
- **extension:** Redesign popup/options + fix first-add race ([318666d](https://github.com/Ripwords/reprojs/commit/318666d))
- **extension:** Remember last intake endpoint in Add form ([e9f7b91](https://github.com/Ripwords/reprojs/commit/e9f7b91))

### 🩹 Fixes

- **github:** Drop env-source guard from disconnect endpoint ([7e3e04c](https://github.com/Ripwords/reprojs/commit/7e3e04c))
- **extension:** Tsconfig types reference "bun" not "bun-types" ([682a979](https://github.com/Ripwords/reprojs/commit/682a979))
- **extension:** Guard against double SDK injection ([6de3900](https://github.com/Ripwords/reprojs/commit/6de3900))
- **extension:** Close the double-inject race properly ([f077804](https://github.com/Ripwords/reprojs/commit/f077804))
- **core:** Remove DOM fallback from screenshot auto mode ([a4ec71b](https://github.com/Ripwords/reprojs/commit/a4ec71b))
- **ui:** Cancelling the capture prompt closes the reporter ([3f3a7b7](https://github.com/Ripwords/reprojs/commit/3f3a7b7))
- **extension:** Harden bootRepro + add proxy diagnostics ([81367ac](https://github.com/Ripwords/reprojs/commit/81367ac))
- **intake:** Accept X-Repro-Origin from extension SW proxy ([84a683d](https://github.com/Ripwords/reprojs/commit/84a683d))

### 📖 Documentation

- Add tester chrome extension design spec ([8ec9f10](https://github.com/Ripwords/reprojs/commit/8ec9f10))
- Add tester chrome extension implementation plan ([0af8870](https://github.com/Ripwords/reprojs/commit/0af8870))
- **plan:** Use dedicated e2e manifest for playwright injection test ([12c3181](https://github.com/Ripwords/reprojs/commit/12c3181))
- Note apps/extension in repo layout ([72f3d13](https://github.com/Ripwords/reprojs/commit/72f3d13))
- Add privacy policy page ([8af07a9](https://github.com/Ripwords/reprojs/commit/8af07a9))

### 🏡 Chore

- **extension:** Add ext:\* scripts to root ([7aba1b9](https://github.com/Ripwords/reprojs/commit/7aba1b9))

### ✅ Tests

- **extension:** Playwright MV3 injection coverage ([2b3cbfd](https://github.com/Ripwords/reprojs/commit/2b3cbfd))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.10

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.9...v0.1.10)

### 🚀 Enhancements

- **dashboard:** Disconnect GitHub App from settings ([63b1b98](https://github.com/Ripwords/reprojs/commit/63b1b98))

### 🩹 Fixes

- **ci:** Provide ENCRYPTION_KEY to dashboard test job ([43e240d](https://github.com/Ripwords/reprojs/commit/43e240d))
- **github:** Manifest sets public:true + emails:read for sign-in ([380c62b](https://github.com/Ripwords/reprojs/commit/380c62b))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.9

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.8...v0.1.9)

### 🩹 Fixes

- **dashboard:** Auto-redirect to sign-in after sign-out ([f946968](https://github.com/Ripwords/reprojs/commit/f946968))
- **github:** Manifest OAuth callback points at better-auth social route ([d38ad91](https://github.com/Ripwords/reprojs/commit/d38ad91))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.8

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.7...v0.1.8)

### 🚀 Enhancements

- **dashboard:** Paginate + cache GitHub installation repos endpoint ([074d199](https://github.com/Ripwords/reprojs/commit/074d199))
- **dashboard:** Infinite-scroll GitHub repo picker with server search ([1243947](https://github.com/Ripwords/reprojs/commit/1243947))
- **shared:** Project invitation DTOs and inputs ([f7f38e3](https://github.com/Ripwords/reprojs/commit/f7f38e3))
- **dashboard:** Project_invitations table and migration ([c4c84a8](https://github.com/Ripwords/reprojs/commit/c4c84a8))
- **dashboard:** Project invite email template ([2acf89b](https://github.com/Ripwords/reprojs/commit/2acf89b))
- **dashboard:** POST /api/projects/:id/invitations ([0225c8f](https://github.com/Ripwords/reprojs/commit/0225c8f))
- **dashboard:** GET /api/projects/:id/invitations ([42f0899](https://github.com/Ripwords/reprojs/commit/42f0899))
- **dashboard:** Revoke pending project invitation ([3de73f7](https://github.com/Ripwords/reprojs/commit/3de73f7))
- **dashboard:** Resend project invitation ([a6d2677](https://github.com/Ripwords/reprojs/commit/a6d2677))
- **dashboard:** GET /api/invitations/:token ([f570397](https://github.com/Ripwords/reprojs/commit/f570397))
- **dashboard:** Accept project invitation ([6016ebd](https://github.com/Ripwords/reprojs/commit/6016ebd))
- **dashboard:** Decline project invitation ([375e659](https://github.com/Ripwords/reprojs/commit/375e659))
- **dashboard:** Invitation accept page ([5b7ddd2](https://github.com/Ripwords/reprojs/commit/5b7ddd2))
- **dashboard:** Pending invites on project members page ([8e641af](https://github.com/Ripwords/reprojs/commit/8e641af))
- **dashboard:** GET /api/invitations/:token returns 409 for non-pending states ([cf254da](https://github.com/Ripwords/reprojs/commit/cf254da))
- **dashboard:** Admin endpoint to reveal GitHub OAuth client_id/secret ([250712e](https://github.com/Ripwords/reprojs/commit/250712e))
- **dashboard:** Include clientId in github app-status response ([e12ee33](https://github.com/Ripwords/reprojs/commit/e12ee33))
- **dashboard:** Reveal GitHub OAuth credentials on settings page ([ce07893](https://github.com/Ripwords/reprojs/commit/ce07893))

### 🩹 Fixes

- **release:** Bypass changelogen's 0.x bump downgrade in dashboard release ([bdb37e7](https://github.com/Ripwords/reprojs/commit/bdb37e7))
- **shared:** Allow null inviterEmail in InvitationDetailDTO ([9e672e2](https://github.com/Ripwords/reprojs/commit/9e672e2))
- **dashboard:** Enforce email match on GET /api/invitations/:token ([053bc4b](https://github.com/Ripwords/reprojs/commit/053bc4b))
- **dashboard:** Add aria-labels to credentials-panel action buttons ([8ec43a1](https://github.com/Ripwords/reprojs/commit/8ec43a1))
- **dashboard:** Use inviter display name in invite email ([93f6f65](https://github.com/Ripwords/reprojs/commit/93f6f65))

### 📖 Documentation

- Add GitHub OAuth credential reveal design ([1e11c92](https://github.com/Ripwords/reprojs/commit/1e11c92))
- Add project member auto-invite design ([3fae443](https://github.com/Ripwords/reprojs/commit/3fae443))
- Add implementation plan for GitHub OAuth credential reveal ([e4ca7ee](https://github.com/Ripwords/reprojs/commit/e4ca7ee))
- Add project member auto-invite implementation plan ([8408ec2](https://github.com/Ripwords/reprojs/commit/8408ec2))
- Clarify audit semantics — clientId via app-status, secret via reveal ([261df44](https://github.com/Ripwords/reprojs/commit/261df44))
- Clarify audit semantics — clientId via app-status, secret via reveal ([2d0a6df](https://github.com/Ripwords/reprojs/commit/2d0a6df))
- Add GitHub OAuth credential reveal design ([cbfd149](https://github.com/Ripwords/reprojs/commit/cbfd149))
- Add implementation plan for GitHub OAuth credential reveal ([31b4003](https://github.com/Ripwords/reprojs/commit/31b4003))
- Clarify audit semantics — clientId via app-status, secret via reveal ([fb54340](https://github.com/Ripwords/reprojs/commit/fb54340))
- **dashboard:** Clarify clientId is plaintext; note apiFetch deviation ([e06b6b1](https://github.com/Ripwords/reprojs/commit/e06b6b1))
- **self-hosting:** Note GitHub App credentials can power sign-in ([49bb0e2](https://github.com/Ripwords/reprojs/commit/49bb0e2))

### 🏡 Chore

- Update docs link ([a58e278](https://github.com/Ripwords/reprojs/commit/a58e278))
- Ignore .worktrees/ directory ([f27282c](https://github.com/Ripwords/reprojs/commit/f27282c))

### ✅ Tests

- Add truncateGithubApp helper for manifest-install tests ([f51dbf6](https://github.com/Ripwords/reprojs/commit/f51dbf6))
- Add failing tests for GitHub OAuth credential reveal endpoint ([a0eefbd](https://github.com/Ripwords/reprojs/commit/a0eefbd))
- Drop cross-process spy assertion on audit log ([4a44809](https://github.com/Ripwords/reprojs/commit/4a44809))
- **dashboard:** Decline rejects mismatched session email ([feb597d](https://github.com/Ripwords/reprojs/commit/feb597d))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.7

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.6...v0.1.7)

### 🚀 Enhancements

- **sdk-core:** Pixel-perfect screen-capture path via getDisplayMedia ([a93a239](https://github.com/Ripwords/reprojs/commit/a93a239))
- **sdk:** Pause replay buffer while the report wizard is open ([bd64ef3](https://github.com/Ripwords/reprojs/commit/bd64ef3))
- **dashboard:** Collapsible triage panel + per-section toggles ([6cd9abb](https://github.com/Ripwords/reprojs/commit/6cd9abb))
- **dashboard:** Page titles via useHead + global titleTemplate ([93b1027](https://github.com/Ripwords/reprojs/commit/93b1027))

### 🩹 Fixes

- **recorder:** Extract CSSOM rules and absolutize URLs in full snapshot ([ad8e527](https://github.com/Ripwords/reprojs/commit/ad8e527))
- **release:** Pin changelogen --from to prefix-matched tag ([0c68bcd](https://github.com/Ripwords/reprojs/commit/0c68bcd))
- **sdk:** Close lifecycle gaps in pause/resume, capture, and reporter ([dce4455](https://github.com/Ripwords/reprojs/commit/dce4455))
- **dashboard:** Static-import rrweb-player CSS + theme controller to dashboard ([a70598d](https://github.com/Ripwords/reprojs/commit/a70598d))
- **docs:** Drop /reprojs prefix from favicon path ([eb45504](https://github.com/Ripwords/reprojs/commit/eb45504))

### 💅 Refactors

- **recorder:** Drop unjustified \`as unknown as\` on stylesheet read ([4889dcd](https://github.com/Ripwords/reprojs/commit/4889dcd))

### 🏡 Chore

- **release:** Sdk-v0.2.0 ([320cfad](https://github.com/Ripwords/reprojs/commit/320cfad))
- **release:** Sdk-v0.2.1 ([73414c3](https://github.com/Ripwords/reprojs/commit/73414c3))

### 🤖 CI

- **sdk-release:** Generate CHANGELOG and GitHub Release for @reprojs/core ([5603973](https://github.com/Ripwords/reprojs/commit/5603973))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.6

[compare changes](https://github.com/Ripwords/reprojs/compare/sdk-v0.1.6...v0.1.6)

### 🩹 Fixes

- **dashboard:** Pre-create /data/attachments owned by non-root user ([379cd13](https://github.com/Ripwords/reprojs/commit/379cd13))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.5

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.4...v0.1.5)

### 🩹 Fixes

- **dashboard:** Resolve runtime env at request time, not build time ([b02c894](https://github.com/Ripwords/reprojs/commit/b02c894))

### 🤖 CI

- **publish-docker:** Gate image build on a verify job ([32a9b00](https://github.com/Ripwords/reprojs/commit/32a9b00))
- **publish-npm:** Add npm publish workflow with provenance + release:sdk helper ([5104bf4](https://github.com/Ripwords/reprojs/commit/5104bf4))
- **publish-npm:** Switch to npm trusted publishing (OIDC) — drop NPM_TOKEN ([1c26993](https://github.com/Ripwords/reprojs/commit/1c26993))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.4

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.3...v0.1.4)

### 🚀 Enhancements

- **dashboard:** Encryption foundation — AES-256-GCM helper + encryptedText column ([8f9d128](https://github.com/Ripwords/reprojs/commit/8f9d128))
- **dashboard:** Github_app singleton table + credential resolver with env→db fallback ([82e6f0b](https://github.com/Ripwords/reprojs/commit/82e6f0b))
- **github-integration:** Shared buildGithubAppManifest ([f7dff95](https://github.com/Ripwords/reprojs/commit/f7dff95))
- **dashboard:** GitHub App manifest wizard — start/callback routes, status API, admin UI ([170a2d9](https://github.com/Ripwords/reprojs/commit/170a2d9))

### 💅 Refactors

- **dashboard:** Make github.ts helpers async via credential resolver ([1bc0789](https://github.com/Ripwords/reprojs/commit/1bc0789))

### 📖 Documentation

- **self-hosting:** Document in-app GitHub App manifest wizard ([8dfdfee](https://github.com/Ripwords/reprojs/commit/8dfdfee))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.3

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.2...v0.1.3)

### 🏡 Chore

- **brand:** Rename @reprokit → @reprojs across npm + Docker + GitHub ([cdd9dc7](https://github.com/Ripwords/reprojs/commit/cdd9dc7))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.2

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.1...v0.1.2)

### 🤖 CI

- **docker:** Migrate from GHCR to Docker Hub (ripwords/reprojs-dashboard) ([54ffb9c](https://github.com/Ripwords/reprojs/commit/54ffb9c))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.1

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.0...v0.1.1)

### 🚀 Enhancements

- **dashboard:** Add session environment card to report overview ([83dc70d](https://github.com/Ripwords/reprojs/commit/83dc70d))
- **deploy:** One-file self-host via Docker + GHCR ([fa6adcb](https://github.com/Ripwords/reprojs/commit/fa6adcb))
- **docs:** Logo + flame/mist brand theming ([7253e6d](https://github.com/Ripwords/reprojs/commit/7253e6d))

### 🩹 Fixes

- **deploy:** Ship server/emails/ in the Docker image ([1611933](https://github.com/Ripwords/reprojs/commit/1611933))

### 📖 Documentation

- Update wiki + clone URLs to Ripwords/reprojs ([e9bffbb](https://github.com/Ripwords/reprojs/commit/e9bffbb))
- Update README ([904b78d](https://github.com/Ripwords/reprojs/commit/904b78d))
- VitePress site at ripwords.github.io/reprojs ([35a1eaa](https://github.com/Ripwords/reprojs/commit/35a1eaa))

### 📦 Build

- **sdk:** Make @reprojs/core a self-contained publishable package ([95d8992](https://github.com/Ripwords/reprojs/commit/95d8992))
- **deploy:** Healthcheck script in the image instead of inline shell ([a77a113](https://github.com/Ripwords/reprojs/commit/a77a113))

### 🤖 CI

- Wire dummy GitHub App env vars for webhook signature tests ([c2c5646](https://github.com/Ripwords/reprojs/commit/c2c5646))
- **docs:** Auto-enable Pages on first deploy ([24db132](https://github.com/Ripwords/reprojs/commit/24db132))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.0

Initial public release of Repro — the framework-agnostic embeddable feedback SDK plus self-hostable triage dashboard, published under the `@reprojs/*` npm scope.

### 🚀 Features

- **SDK** (`@reprojs/core`) — framework-agnostic init API, Shadow-DOM-isolated widget, keyboard shortcut, programmatic `open` / `close` / `identify` / `log`.
- **Screenshot capture + annotation canvas** — freehand pen, line, arrow, rectangle, text; undo / redo; flattened to PNG on submit.
- **30s rolling session replay** (`@reprojs/recorder`) — rrweb-compatible event stream, privacy masking (password fields, `data-repro-mask`).
- **Diagnostic context bundle** — console + network logs, cookies (denylisted), system info, custom breadcrumbs.
- **Dashboard** (`apps/dashboard`, Nuxt 4) — project management, ticket inbox with filters + facets, report triage drawer with replay player, assignee + priority + tags + status.
- **Intake API** — multipart upload, per-project origin allowlist, per-key + per-IP rate limits, honeypot + dwell-time anti-abuse, daily report cap.
- **Auth** — better-auth with magic-link + GitHub / Google OAuth; admin signup-gating.
- **GitHub Issues sync** (`@reprojs/integrations-github`) — GitHub App with one-click issue creation, two-way status sync via webhooks, background retry queue.
- **Blob storage** — pluggable adapter: local disk (default) or any S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, Hetzner, MinIO, Garage).
- **CI** — GitHub Actions gate: lint + format check, SDK tests, SDK IIFE build sanity check, dashboard integration tests against a real Postgres.

### 📦 Published packages

- `@reprojs/core` — SDK entry
- `@reprojs/ui` — widget UI (Preact + Shadow DOM)
- `@reprojs/recorder` — 30s rolling DOM replay buffer
- `@reprojs/shared` — contract types + Zod schemas
- `@reprojs/integrations-github` — GitHub Issues adapter

### 🔒 Security posture

- Origin allowlist enforced on every intake request; cross-origin scripts cannot read error bodies as an enumeration oracle for valid project keys.
- Session tokens validated server-side; auth endpoints rate-limited.
- HTTP response headers set via nuxt-security (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`).
- Sensitive-input masking on by default in the recorder.

### 🙏 Contributors

- JJ Teoh
