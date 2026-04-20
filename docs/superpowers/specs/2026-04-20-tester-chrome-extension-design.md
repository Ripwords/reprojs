# Tester Chrome extension design

Status: approved for implementation
Date: 2026-04-20
Owner: JJ

## Problem

Internal testers want to exercise the Repro feedback widget on sites they do
not control (customer preview builds, third-party integrations, staging URLs
owned by another team) without waiting for the host app to ship the `<script>`
embed. Today they have two choices:

1. Ask the host team to add the embed. Slow, and a non-starter for
   third-party properties.
2. Paste SDK bootstrap code into DevTools by hand on every page load. Fragile,
   easy to mistype the project key, doesn't survive navigation.

Neither is viable for day-to-day QA, so real-world session replay + annotated
screenshot reports from internal testing are effectively gated on the embed
being installed on the target site.

## Goals

- Internal testers can install a single Chrome extension, configure one or
  more `{ origin, projectKey, intakeEndpoint }` entries, and have the Repro
  widget appear automatically on matching tabs.
- The extension is **production-ready**: Manifest V3, no remote code, strict
  extension CSP, least-privilege permission model, publishable as an unlisted
  Chrome Web Store listing.
- The extension reuses the existing embed security model unchanged:
  `projectKey` (public identifier) + server-side origin allowlist on the
  intake endpoint. No new auth surface on the dashboard.
- The extension lives in the existing monorepo at `apps/extension/` so it
  shares tooling (Bun, tsdown-built workspace deps, oxlint/oxfmt) and tracks
  SDK versions via `workspace:*`.

## Non-goals

- **Not a replacement for the embed path.** End-users of customer sites will
  never have this extension. Bug reports from real users still come from the
  embedded `<script>` SDK.
- No dashboard coupling — no auth, no "import projects" button, no new
  endpoints. Testers manage origins in dashboard project settings exactly
  like any customer integrator.
- No Firefox build in v1 (design is portable; revisit when a tester asks).
- No multi-SDK-version bundling in v1 (one SDK version per extension
  release).
- No enterprise force-install / managed policy support in v1.
- No in-extension editor for the dashboard-side origin allowlist.

## Decisions

- **(Q1)** Auth to the dashboard is explicitly **not required**. The embed
  model treats `projectKey` as a public identifier gated server-side by
  `projects.allowedOrigins` (see `apps/dashboard/server/api/intake/reports.ts`
  lines 61–77); the extension inherits that posture verbatim and adds no new
  trust boundary.
- **(Q2)** Activation is **always-on per configured origin** via
  least-privilege `chrome.permissions.request` at the moment a tester adds an
  origin. The manifest ships with `host_permissions: []` and
  `optional_host_permissions: ["<all_urls>"]`; the user's actual grant is
  narrowed to the specific origin they configured.
- **(Q3)** The SDK is bundled into the extension at build time as a static
  asset (`@reprojs/core/iife`). MV3 forbids remote code, so fetching the SDK
  from a CDN at runtime is not an option. SDK version is pinned by the
  extension's `package.json`; each extension release corresponds to exactly
  one SDK version.
- **(Q4)** Distribution is the Chrome Web Store as an **unlisted** listing.
  Testers install via a shared link. No enterprise policy in v1.

## Architecture

### Package

New workspace package: `apps/extension/`.

```
apps/extension/
├── manifest.config.ts           # crxjs manifest, MV3
├── vite.config.ts               # crxjs + vite + preact
├── package.json                 # "@reprojs/extension"
├── src/
│   ├── popup/                   # Preact popup (list/add/edit configs)
│   ├── options/                 # same UI, larger canvas
│   ├── service-worker/          # tabs.onUpdated → inject
│   ├── bootstrap/
│   │   ├── set-config.ts        # tiny script: window.__REPRO_CONFIG__ = ...
│   │   └── sdk.iife.js          # copied from @reprojs/core at build
│   ├── lib/
│   │   ├── storage.ts           # chrome.storage.local wrapper
│   │   ├── origin-match.ts      # URL → origin key
│   │   └── permissions.ts       # chrome.permissions helpers
│   └── types.ts                 # Config, StorageShape
└── tests/
    └── origin-match.test.ts     # bun test
```

Build tool: `crxjs` + Vite (MV3 support with live-reload). TypeScript strict.
Lint: oxlint. Format: oxfmt. Unit tests: `bun test`. Browser tests: Playwright
in MV3 persistent-context mode.

### Manifest (MV3)

```jsonc
{
  "manifest_version": 3,
  "name": "Repro Tester",
  "version": "0.1.0",
  "permissions": ["storage", "scripting", "activeTab"],
  "host_permissions": [],
  "optional_host_permissions": ["<all_urls>"],
  "background": { "service_worker": "src/service-worker/index.ts", "type": "module" },
  "action": { "default_popup": "src/popup/index.html" },
  "options_page": "src/options/index.html",
  "web_accessible_resources": [
    {
      "resources": ["src/bootstrap/sdk.iife.js"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

Content scripts are intentionally absent — injection is driven by the service
worker via `chrome.scripting.executeScript` so the SDK runs in the page's
`MAIN` world (required for it to hook `fetch` / `console`).

### Data model

`chrome.storage.local` key `configs` holds:

```ts
type Config = {
  id: string                // uuid
  label: string             // human label, e.g. "staging.acme.com"
  origin: string            // "https://staging.acme.com"  (scheme + host, no path)
  projectKey: string        // dashboard's projects.publicKey
  intakeEndpoint: string    // e.g. https://repro.example.com
  createdAt: number
}

type StorageShape = { configs: Config[] }
```

No secrets are ever stored; `projectKey` is public and `intakeEndpoint` is
the dashboard's public URL. `chrome.storage.local` is not synced across
browsers by design.

### Flow: adding an origin

1. Tester opens popup, enters `label`, `origin`, `projectKey`,
   `intakeEndpoint`.
2. Popup calls `chrome.permissions.request({ origins: ["<origin>/*"] })`.
3. User grants in Chrome's native prompt.
4. On grant, the `Config` is persisted. On denial, the entry is discarded and
   the popup shows an inline error.

### Flow: injection

1. Service worker listens on `chrome.tabs.onUpdated` and fires only on
   `status === "complete"` with an `http(s):` URL.
2. Compute the tab's origin (`new URL(tab.url).origin`).
3. Look up `configs` by origin. No match → done.
4. Match found → run two `chrome.scripting.executeScript` calls into
   `world: "MAIN"`:
   - **Config inject**: a tiny inline function that assigns
     `window.__REPRO_CONFIG__ = { projectKey, endpoint, source: "extension" }`.
   - **SDK inject**: `files: ["src/bootstrap/sdk.iife.js"]` loads the bundled
     IIFE, which reads `window.__REPRO_CONFIG__` and boots the widget.

Both calls target the top frame only (`frameIds: [0]`) in v1 — iframe support
is deferred.

### Flow: removing an origin

1. Popup deletes the `Config` entry from `chrome.storage.local`.
2. Popup calls `chrome.permissions.remove({ origins: ["<origin>/*"] })` so
   permission state matches user intent immediately.

## CSP & security posture

- **Extension CSP**: MV3 default (`script-src 'self'; object-src 'self'`).
  No eval, no remote code, no inline handlers. The SDK is a bundled static
  file, not fetched.
- **Page CSP**: `chrome.scripting.executeScript` into `world: "MAIN"` is the
  Chrome-sanctioned extension path for running bundled code in the page — it
  is not a CSP bypass in the adversarial sense; it's the explicit extension
  trust contract the user granted when they installed the extension and
  approved the host permission.
- **Origin allowlist** (server-side, `projects.allowedOrigins`) remains the
  actual access gate. An extension that injects the SDK on an origin the
  dashboard has not allowlisted will observe intake 403 responses. The
  extension surfaces this in the popup as a visible error so the tester
  knows to add the origin in dashboard project settings.
- **Least privilege**: zero `host_permissions` in the manifest. All page
  access is opt-in at runtime per-origin. Revoking an origin in
  `chrome://extensions` immediately disables injection for that origin (the
  service worker's `executeScript` call returns a permission error, which we
  catch and swallow).
- **No secret material**: `projectKey` is public; `intakeEndpoint` is public.
  The extension handles no session tokens, no API keys.

## Error handling

| Condition | Behavior |
| --- | --- |
| User denies host permission | Entry not saved; popup shows "Permission required for this origin." |
| `executeScript` fails (permission revoked mid-session) | Service worker swallows the error, no UI surfaced (the user already knows they revoked). |
| Intake returns 403 (origin not allowlisted) | SDK surfaces the error to the user via its own toast; no extension-side handling. |
| Tab URL is `chrome://` / `chrome-extension://` / `file://` | Service worker skips injection (not in `optional_host_permissions` scope). |
| Config has a typo'd `intakeEndpoint` | Network failure bubbles up through the SDK's normal error path. |

## Testing

- **Unit** (`bun test`): origin matching, storage shape validation, URL
  normalization, config CRUD.
- **Integration** (Playwright MV3): launch persistent context with the
  unpacked extension, assert:
  - SDK injected on a configured origin (widget root appears in shadow DOM).
  - SDK NOT injected on an unconfigured origin.
  - Removing a config removes the permission and stops further injection.
  - Navigation preserves injection (new tab load re-fires the SDK inject).
- **Manual smoke**: install the built `.zip` as an unpacked extension, add
  one real project configured on the dev dashboard, report a bug from a
  configured origin, verify the ticket lands in the inbox.

## Distribution

- Chrome Web Store, unlisted listing.
- Publisher: Repro team account.
- Privacy policy: required by the store; links to the main dashboard's
  privacy policy page.
- Release cadence: new extension release whenever `@reprojs/core` bumps
  minor/major. Patch bumps of the SDK do not require an extension release
  unless they fix a bug the extension-injected path hits.

## Out of scope (v1)

- Firefox / Safari builds.
- "Import configs from dashboard" convenience flow.
- Bundling multiple SDK versions and letting the tester pick.
- Enterprise managed-policy install (`ExtensionInstallForcelist`).
- Iframe injection.
- Per-tab / click-to-activate mode.
- Per-origin SDK config overrides (theme, z-index, shortcut) — v1 uses SDK
  defaults.

## Open questions

None at spec time. All four decisions above (auth, activation, versioning,
distribution) are locked.
