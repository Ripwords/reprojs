# Changelog

## sdk-v0.3.0

[compare changes](https://github.com/Ripwords/reprojs/compare/sdk-v0.2.1...sdk-v0.3.0)

### 🚀 Enhancements

- **dashboard:** Collapsible triage panel + per-section toggles ([6cd9abb](https://github.com/Ripwords/reprojs/commit/6cd9abb))
- **dashboard:** Page titles via useHead + global titleTemplate ([93b1027](https://github.com/Ripwords/reprojs/commit/93b1027))
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
- **dashboard:** Disconnect GitHub App from settings ([63b1b98](https://github.com/Ripwords/reprojs/commit/63b1b98))
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
- **extension:** Pre-fill Add form with active tab's origin ([ef78c25](https://github.com/Ripwords/reprojs/commit/ef78c25))
- **dashboard:** Pending-invitations page + fix stale list after accept ([b7ffeac](https://github.com/Ripwords/reprojs/commit/b7ffeac))
- **dashboard:** Replay fullscreen toggle + hide ineffective controls ([fa95c16](https://github.com/Ripwords/reprojs/commit/fa95c16))

### 🩹 Fixes

- **dashboard:** Static-import rrweb-player CSS + theme controller to dashboard ([a70598d](https://github.com/Ripwords/reprojs/commit/a70598d))
- **docs:** Drop /reprojs prefix from favicon path ([eb45504](https://github.com/Ripwords/reprojs/commit/eb45504))
- **release:** Bypass changelogen's 0.x bump downgrade in dashboard release ([bdb37e7](https://github.com/Ripwords/reprojs/commit/bdb37e7))
- **shared:** Allow null inviterEmail in InvitationDetailDTO ([9e672e2](https://github.com/Ripwords/reprojs/commit/9e672e2))
- **dashboard:** Enforce email match on GET /api/invitations/:token ([053bc4b](https://github.com/Ripwords/reprojs/commit/053bc4b))
- **dashboard:** Add aria-labels to credentials-panel action buttons ([8ec43a1](https://github.com/Ripwords/reprojs/commit/8ec43a1))
- **dashboard:** Use inviter display name in invite email ([93f6f65](https://github.com/Ripwords/reprojs/commit/93f6f65))
- **dashboard:** Auto-redirect to sign-in after sign-out ([f946968](https://github.com/Ripwords/reprojs/commit/f946968))
- **github:** Manifest OAuth callback points at better-auth social route ([d38ad91](https://github.com/Ripwords/reprojs/commit/d38ad91))
- **ci:** Provide ENCRYPTION_KEY to dashboard test job ([43e240d](https://github.com/Ripwords/reprojs/commit/43e240d))
- **github:** Manifest sets public:true + emails:read for sign-in ([380c62b](https://github.com/Ripwords/reprojs/commit/380c62b))
- **github:** Drop env-source guard from disconnect endpoint ([7e3e04c](https://github.com/Ripwords/reprojs/commit/7e3e04c))
- **extension:** Tsconfig types reference "bun" not "bun-types" ([682a979](https://github.com/Ripwords/reprojs/commit/682a979))
- **extension:** Guard against double SDK injection ([6de3900](https://github.com/Ripwords/reprojs/commit/6de3900))
- **extension:** Close the double-inject race properly ([f077804](https://github.com/Ripwords/reprojs/commit/f077804))
- **core:** Remove DOM fallback from screenshot auto mode ([a4ec71b](https://github.com/Ripwords/reprojs/commit/a4ec71b))
- **ui:** Cancelling the capture prompt closes the reporter ([3f3a7b7](https://github.com/Ripwords/reprojs/commit/3f3a7b7))
- **extension:** Harden bootRepro + add proxy diagnostics ([81367ac](https://github.com/Ripwords/reprojs/commit/81367ac))
- **intake:** Accept X-Repro-Origin from extension SW proxy ([84a683d](https://github.com/Ripwords/reprojs/commit/84a683d))
- **extension:** ⚠️  Harden SW proxy (security review F1/F3/F6/F7) ([1bded3e](https://github.com/Ripwords/reprojs/commit/1bded3e))
- **dashboard:** ⚠️  Pin Docker base image to bun 1.3 ([eec6980](https://github.com/Ripwords/reprojs/commit/eec6980))
- **dashboard:** Copy apps/extension/package.json in Docker build ([88b29f5](https://github.com/Ripwords/reprojs/commit/88b29f5))
- **security:** ⚠️  Close H1/H2/M2/M3/M4 from pre-publish audit ([1f7b72a](https://github.com/Ripwords/reprojs/commit/1f7b72a))
- **dashboard:** Invitations page 500s on SSR due to cookie forwarding ([3bd3c66](https://github.com/Ripwords/reprojs/commit/3bd3c66))
- **core:** Prevent screenshot hang and broken-image glyphs ([0f9f684](https://github.com/Ripwords/reprojs/commit/0f9f684))
- **recorder:** Align event pipeline with rrweb-player expectations ([b51ae61](https://github.com/Ripwords/reprojs/commit/b51ae61))
- **extension:** Re-inject SDK on page refresh ([b5f9db4](https://github.com/Ripwords/reprojs/commit/b5f9db4))

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
- Add tester chrome extension design spec ([8ec9f10](https://github.com/Ripwords/reprojs/commit/8ec9f10))
- Add tester chrome extension implementation plan ([0af8870](https://github.com/Ripwords/reprojs/commit/0af8870))
- **plan:** Use dedicated e2e manifest for playwright injection test ([12c3181](https://github.com/Ripwords/reprojs/commit/12c3181))
- Note apps/extension in repo layout ([72f3d13](https://github.com/Ripwords/reprojs/commit/72f3d13))
- Add privacy policy page ([8af07a9](https://github.com/Ripwords/reprojs/commit/8af07a9))
- Add tester Chrome extension guide ([e8d3c58](https://github.com/Ripwords/reprojs/commit/e8d3c58))
- Surface tester Chrome extension in overview docs ([f73840a](https://github.com/Ripwords/reprojs/commit/f73840a))

### 🏡 Chore

- **release:** V0.1.7 ([668c500](https://github.com/Ripwords/reprojs/commit/668c500))
- Update docs link ([a58e278](https://github.com/Ripwords/reprojs/commit/a58e278))
- Ignore .worktrees/ directory ([f27282c](https://github.com/Ripwords/reprojs/commit/f27282c))
- **release:** V0.1.8 ([e55c916](https://github.com/Ripwords/reprojs/commit/e55c916))
- **release:** V0.1.9 ([a68edbb](https://github.com/Ripwords/reprojs/commit/a68edbb))
- **release:** V0.1.10 ([a981f09](https://github.com/Ripwords/reprojs/commit/a981f09))
- **extension:** Add ext:* scripts to root ([7aba1b9](https://github.com/Ripwords/reprojs/commit/7aba1b9))
- **release:** V0.1.11 ([989c5d8](https://github.com/Ripwords/reprojs/commit/989c5d8))
- **ci:** Smoke-build dashboard image + gate release scripts on CI ([85fb50c](https://github.com/Ripwords/reprojs/commit/85fb50c))
- **release:** V0.1.12 ([24138bf](https://github.com/Ripwords/reprojs/commit/24138bf))
- **ci:** Exempt CHANGELOG files from oxfmt ([0b7dae0](https://github.com/Ripwords/reprojs/commit/0b7dae0))
- **release:** V0.1.13 ([b115536](https://github.com/Ripwords/reprojs/commit/b115536))
- **release:** V0.1.14 ([d27567b](https://github.com/Ripwords/reprojs/commit/d27567b))
- Ignore zip artifacts ([5b3900a](https://github.com/Ripwords/reprojs/commit/5b3900a))
- **ci:** Scannable release titles per track on GitHub Releases ([6d15fa1](https://github.com/Ripwords/reprojs/commit/6d15fa1))

### ✅ Tests

- Add truncateGithubApp helper for manifest-install tests ([f51dbf6](https://github.com/Ripwords/reprojs/commit/f51dbf6))
- Add failing tests for GitHub OAuth credential reveal endpoint ([a0eefbd](https://github.com/Ripwords/reprojs/commit/a0eefbd))
- Drop cross-process spy assertion on audit log ([4a44809](https://github.com/Ripwords/reprojs/commit/4a44809))
- **dashboard:** Decline rejects mismatched session email ([feb597d](https://github.com/Ripwords/reprojs/commit/feb597d))
- **extension:** Playwright MV3 injection coverage ([2b3cbfd](https://github.com/Ripwords/reprojs/commit/2b3cbfd))

### 🤖 CI

- **docker:** Create GitHub Release as part of publish workflow ([2514731](https://github.com/Ripwords/reprojs/commit/2514731))

#### ⚠️ Breaking Changes

- **extension:** ⚠️  Harden SW proxy (security review F1/F3/F6/F7) ([1bded3e](https://github.com/Ripwords/reprojs/commit/1bded3e))
- **dashboard:** ⚠️  Pin Docker base image to bun 1.3 ([eec6980](https://github.com/Ripwords/reprojs/commit/eec6980))
- **security:** ⚠️  Close H1/H2/M2/M3/M4 from pre-publish audit ([1f7b72a](https://github.com/Ripwords/reprojs/commit/1f7b72a))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## sdk-v0.2.1

[compare changes](https://github.com/Ripwords/reprojs/compare/sdk-v0.2.0...sdk-v0.2.1)

### 🚀 Enhancements

- **sdk:** Pause replay buffer while the report wizard is open ([bd64ef3](https://github.com/Ripwords/reprojs/commit/bd64ef3))

### 🩹 Fixes

- **sdk:** Close lifecycle gaps in pause/resume, capture, and reporter ([dce4455](https://github.com/Ripwords/reprojs/commit/dce4455))

### 💅 Refactors

- **recorder:** Drop unjustified \`as unknown as\` on stylesheet read ([4889dcd](https://github.com/Ripwords/reprojs/commit/4889dcd))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## sdk-v0.2.0

[compare changes](https://github.com/Ripwords/reprojs/compare/sdk-v0.1.6...sdk-v0.2.0)

### 🚀 Enhancements

- **sdk-core:** Pixel-perfect screen-capture path via getDisplayMedia ([a93a239](https://github.com/Ripwords/reprojs/commit/a93a239))

### 🩹 Fixes

- **dashboard:** Pre-create /data/attachments owned by non-root user ([379cd13](https://github.com/Ripwords/reprojs/commit/379cd13))
- **recorder:** Extract CSSOM rules and absolutize URLs in full snapshot ([ad8e527](https://github.com/Ripwords/reprojs/commit/ad8e527))
- **release:** Pin changelogen --from to prefix-matched tag ([0c68bcd](https://github.com/Ripwords/reprojs/commit/0c68bcd))

### 🏡 Chore

- **release:** V0.1.6 ([bad9a19](https://github.com/Ripwords/reprojs/commit/bad9a19))

### 🤖 CI

- **sdk-release:** Generate CHANGELOG and GitHub Release for @reprojs/core ([5603973](https://github.com/Ripwords/reprojs/commit/5603973))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>
