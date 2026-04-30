# Client ↔ dashboard compatibility

The dashboard (`ripwords/reprojs-dashboard` on Docker Hub) and each SDK release on **independent cadences**. The web SDK (`@reprojs/core`), the Expo SDK (`@reprojs/expo`), and the Chrome tester extension (`@reprojs/extension`) all share the intake contract in `@reprojs/shared`, so not every client version works against every dashboard tag.

If you deploy the dashboard and update clients in lockstep, you can ignore this page. You only need it when the two sides drift — for example, you bumped the dashboard but haven't shipped a new build of your host app yet, or you're running an older self-hosted dashboard and want to know which client to pin.

## Matrix

| Dashboard tag | `@reprojs/core` (web SDK) | `@reprojs/expo` (Expo SDK) | `@reprojs/extension` (Chrome) |
| --- | --- | --- | --- |
| `0.1.0` – `0.1.10` | `>= 0.1.4`, `<= 0.4.x` ¹ | not supported | not supported ² |
| `0.1.11` – `0.1.18` | `>= 0.1.4`, `<= 0.4.x` ¹ | not supported | `0.1.1` |
| `0.2.x` – `0.4.x` | `>= 0.1.4`, `<= 0.4.x` ¹ | `>= 0.1.0`, `<= 0.2.x` ¹ | `0.1.1` – `0.1.2` |
| `0.5.x` | `>= 0.1.4`, `<= 0.4.x` | `>= 0.1.0`, `<= 0.2.x` | `0.1.1` – `0.1.2` |

¹ **User-file attachments** (web SDK `0.4.0` / Expo SDK `0.2.0`) require dashboard `>= 0.5.0`. On older dashboards the report is still accepted, but the user-attached files are silently dropped — only the screenshot and replay are persisted.

² The Chrome extension proxies the intake POST through its service worker, which fixes the `Origin` header to `chrome-extension://<id>`. Dashboards before `0.1.11` did not honour the `X-Repro-Origin` fallback header, so every proxied report was rejected as "Origin not allowed".

## What changed at each boundary

Boundaries only move when the intake contract changes. Patch-level dashboard releases (e.g. `0.4.1`, `0.4.2`, `0.1.x`) never narrow the supported client range.

- **Dashboard `0.1.11`** — intake accepts `X-Repro-Origin` from the Chrome extension's service-worker proxy. First dashboard the tester extension can talk to.
- **Dashboard `0.2.0`** — adds `ReportContext.source` discriminator, optional mobile fields on `SystemInfo` (`devicePlatform`, `appVersion`, `appBuild`, `deviceModel`, `osVersion`), allows empty `Origin` for `source: "expo"`, and accepts the `Idempotency-Key` header for offline-queue retries. First dashboard `@reprojs/expo` can talk to.
- **Dashboard `0.5.0`** — intake accepts `attachment[N]` multipart parts as user-attached files (with per-file size cap, MIME denylist, ClamAV virus scan, `kind='user-file'` rows). Required for the user-attachments UX added in web SDK `0.4.0` and Expo SDK `0.2.0`.

All other dashboard releases in the `0.x` line ship admin-side changes — UI, GitHub deeper-sync, replay player, triage permissions, role model — that don't move the intake contract.

## How versioning works

Each release line has its own tag prefix, so bumping one never churn-republishes the others.

| Release line | Git tag prefix | Published to |
| --- | --- | --- |
| Dashboard | `v<X.Y.Z>` | Docker Hub: `ripwords/reprojs-dashboard:<X.Y.Z>` + `<X.Y>` + `<X>` + `latest` |
| Web SDK | `sdk-v<X.Y.Z>` | npm: `@reprojs/core@<X.Y.Z>` (OIDC provenance) |
| Expo SDK | `expo-v<X.Y.Z>` | npm: `@reprojs/expo@<X.Y.Z>` (OIDC provenance) |
| Chrome extension | `extension-v<X.Y.Z>` | Chrome Web Store + GitHub release zip |

The extension bundles `@reprojs/core` at build time (MV3 forbids remote code), so its dashboard requirement tracks the bundled SDK rather than the npm package version. Internally:

- `extension-v0.1.1` bundles `sdk-v0.3.0`
- `extension-v0.1.2` bundles `sdk-v0.4.0`

## Pinning in your host app

```bash
# Web SDK — pin in your host app's package.json:
npm i @reprojs/core@~0.4.0    # tilde: accept 0.4.x patches, refuse 0.5.x

# Expo SDK — same idea:
npm i @reprojs/expo@~0.2.0
```

```bash
# Dashboard — pin in your .env / compose file:
REPRO_VERSION=0.5.0    # exact — most predictable
REPRO_VERSION=0.5      # major.minor — accept patches on pull
REPRO_VERSION=latest   # tracks main; only safe when you redeploy clients in lockstep
```

The Chrome extension auto-updates from the Chrome Web Store — you can't pin a specific version on installed browsers. If you self-distribute the zip from the GitHub release, pin the URL.

## Upgrade etiquette

- **Dashboard-only upgrade inside the supported client range** → safe. `docker compose pull && docker compose up -d`.
- **Client-only upgrade inside the supported dashboard range** → safe. Ship a new build of your host app (or wait for the extension auto-update).
- **Either side crossing a row** → check the boundary above. The dashboard is backward-compatible with older clients within `0.x`; new client features that require a newer dashboard degrade gracefully (the report still posts, the new sub-feature is dropped).

## When something looks wrong

If a client is talking to a dashboard outside its supported range, the dashboard responds in one of two ways depending on the mismatch:

- **Soft-degrade** (extra fields the dashboard doesn't know about) — the report is accepted, unknown fields are dropped, you see them missing in the report detail view. No error surfaced to the SDK.
- **Hard-reject** (missing required header / origin not honoured) — the dashboard returns `403` with `[intake] origin-not-allowed` (most common cause: extension talking to a `< 0.1.11` dashboard, or Expo client talking to a `< 0.2.0` dashboard).

Check the dashboard's request log first — the failure mode is logged with a stable prefix (`[intake] …`) so it's easy to grep.
