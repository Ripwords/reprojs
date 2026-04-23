# Expo SDK — Design

**Date:** 2026-04-20
**Status:** Draft — awaiting plan

## Problem

Repro today targets web apps only. The SDK packages (`@reprojs/core`, `@reprojs/ui`, `@reprojs/recorder`) lean hard on DOM, Shadow DOM, Canvas 2D, and `modern-screenshot`. Teams that want feedback capture inside an Expo-based mobile app can't use Repro. We want a first-class mobile path without forking the product.

## Goals

- New `packages/expo` SDK that Expo apps can drop in to capture annotated screenshots, console logs, network logs, breadcrumbs, and rich device info, and submit them to the existing dashboard intake.
- Dashboard distinguishes web vs Expo mobile reports visually and via filters, and renders mobile-appropriate context in the detail view.
- Package follows current Expo community best practices for config plugins, peer deps, and build output — no surprises for an Expo app team adopting it.

## Non-goals (v1)

- Session replay (no periodic screenshots, no video, no view-tree observer).
- Bare React Native (non-Expo) support, though the package should work there incidentally.
- Cookies, React Navigation auto-breadcrumbs, Redux/Zustand state capture, shake-to-report, encrypted queue, full-scroll screenshot.
- A standalone `@reprojs/react-native` variant — revisit in v2.

## Decisions (locked during brainstorming)

1. **Surface**: `<ReproProvider>` wraps the app; `<ReproLauncher />` is an opt-in floating bubble; `useRepro()` hook exposes `open / close / identify / log / setMetadata / queue`. A module-level `Repro` singleton provides non-React callsites with the same API.
2. **Discriminator**: new `source: "web" | "expo"` field on `ReportContext` (defaults `"web"` on intake for backward compat). `SystemInfo.pageUrl` and `ReportContext.pageUrl` relax from `z.string().url()` to `z.string().max(2048)`. `SystemInfo` gains optional `devicePlatform`, `appVersion`, `appBuild`, `deviceModel`, `osVersion` for mobile. Dashboard surfaces the discriminator via a badge in the inbox list, a sidebar filter, and conditional rendering in the ticket detail.
3. **Native rendering stack**: `react-native-view-shot` for screenshot capture, `react-native-svg` + `react-native-gesture-handler` for annotation. Annotation flatten uses an overlay-and-recapture trick (render screenshot + SVG annotations into a hidden view, `captureRef` that view → flat PNG). No Skia.
4. **Offline behavior**: persistent queue in `AsyncStorage` + `NetInfo` listener, bounded to 5 reports / 10MB total. Idempotency-Key header on intake enables safe retry.

## Architecture

### Package layout

```
packages/expo/
├── app.plugin.js                  # Expo config-plugin entry (3-line shim)
├── package.json
├── tsdown.config.ts
├── plugin/
│   └── with-repro.ts              # compiled → dist/plugin/with-repro.js; no-op in v1
└── src/
    ├── index.ts                   # public API surface
    ├── provider.tsx               # <ReproProvider>
    ├── launcher.tsx               # <ReproLauncher />
    ├── use-repro.ts               # useRepro() hook
    ├── singleton.ts               # Repro.* imperative fallback
    ├── wizard/
    │   ├── sheet.tsx
    │   ├── step-form.tsx
    │   ├── step-annotate.tsx
    │   └── step-submit.tsx
    ├── capture/
    │   ├── screenshot.ts          # view-shot wrapper
    │   └── flatten.ts             # overlay-and-recapture flatten
    ├── annotation/
    │   ├── canvas.tsx             # SVG + gesture-handler drawing surface
    │   ├── toolbar.tsx
    │   └── tools/                 # pen, arrow, rect, highlight, text UI (geometry from sdk-utils)
    ├── collectors/
    │   ├── console.ts
    │   ├── network.ts             # patches fetch + XMLHttpRequest
    │   ├── breadcrumbs.ts         # re-export from sdk-utils
    │   └── system-info.ts         # expo-device + Dimensions + PixelRatio + NetInfo
    ├── queue/
    │   ├── storage.ts             # AsyncStorage-backed persistent queue
    │   ├── netinfo.ts             # NetInfo listener + online/offline signal
    │   └── flush.ts               # retry policy
    └── intake-client.ts           # FormData payload, Idempotency-Key header
```

### Supporting refactor — new `packages/sdk-utils` (`@reprojs/sdk-utils`)

Pure, DOM-free, RN-free helpers shared between `@reprojs/ui` and `@reprojs/expo`. Moves existing code from `packages/ui/src/collectors/` and `packages/ui/src/annotation/tools/`:

- `ring-buffer.ts`
- `redact.ts`
- `breadcrumbs.ts` (core emitter only; DOM wrapper stays in `@reprojs/ui`)
- Annotation tool geometry (pen, arrow, rect, highlight, text) — split from Canvas-rendering code

Why a new package rather than folding into `@reprojs/shared`: `shared` is zod schemas (the API contract) and is consumed by the dashboard server; `sdk-utils` is runtime helpers for SDK packages only. Different purpose, different churn.

### Dependency graph

```
@reprojs/shared ────────┬──→ @reprojs/ui ──→ @reprojs/core (web)
                        ├──→ @reprojs/expo (new)
                        └──→ apps/dashboard
@reprojs/sdk-utils (new)─┼──→ @reprojs/ui
                         └──→ @reprojs/expo
```

No other existing packages change publicly. `@reprojs/core`, `@reprojs/recorder`, `@reprojs/integrations/github` are untouched. `@reprojs/ui` gets an internal refactor to import pure helpers from `@reprojs/sdk-utils` with identical public behavior.

## Public API

### Root setup

```tsx
import { ReproProvider, ReproLauncher } from '@reprojs/expo';

export default function App() {
  return (
    <ReproProvider
      config={{
        projectKey: 'rp_pk_...',
        intakeUrl: 'https://dashboard.example.com/api/intake',
        reporter: { userId: '123', email: 'u@x.com' },
        collectors: {
          console: true,
          network: { enabled: true, captureBodies: false },
          breadcrumbs: true,
          systemInfo: true,
        },
        queue: {
          maxReports: 5,
          maxBytes: 10 * 1024 * 1024,
          backoffMs: [1000, 5000, 30000, 120000],
        },
        redact: {
          headerDenylist: ['authorization', 'cookie', 'x-api-key'],
          bodyRedactKeys: ['password', 'token', 'secret'],
        },
        theme: { accent: '#6366f1', mode: 'auto' },
        metadata: { appVersion: '1.2.3', build: '42' },
      }}
    >
      <YourAppRoot />
      <ReproLauncher />
    </ReproProvider>
  );
}
```

- `ReproProvider` must be inside `GestureHandlerRootView` and above any `NavigationContainer` (dev-mode runtime check).
- Provider renders nothing visible; the wizard is rendered via a `Modal` owned by the provider.
- All collectors start patched on mount, unpatched on unmount. Cleanup is non-negotiable.

### Hook

```ts
interface ReproHandle {
  open: (opts?: { initialTitle?: string; initialDescription?: string }) => void;
  close: () => void;
  identify: (reporter: ReporterIdentity | null) => void;
  log: (event: string, data?: Record<string, string | number | boolean | null>) => void;
  setMetadata: (patch: Record<string, string | number | boolean>) => void;
  queue: {
    pending: number;
    lastError: string | null;
    flush: () => Promise<void>;
  };
}
```

- `open()` outside a `ReproProvider` throws in dev, no-ops in prod.
- `identify(null)` clears reporter identity.
- `log()` emits a breadcrumb — same shape as the web emitter.
- `setMetadata` merges shallowly.

### Launcher component

```tsx
<ReproLauncher
  position="bottom-right"        // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  offset={{ bottom: 24, right: 24 }}
  icon={<CustomBugIcon />}
  hideWhen={() => someAtom.value}
/>
```

Opt-in. Hosts wanting headless control omit it and use `useRepro().open()` directly.

### Non-React callsites

```ts
import { Repro } from '@reprojs/expo';

Repro.open();
Repro.log('checkout_failed', { cartId: 'abc' });
```

Module-level singleton backed by the same provider instance. Throws in dev if the provider hasn't mounted; no-ops in prod.

### Package exports

```jsonc
{
  "name": "@reprojs/expo",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":            { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./app.plugin": "./app.plugin.js"
  }
}
```

## Capture pipeline

### Screenshot

```ts
import { captureRef } from 'react-native-view-shot';

export async function captureAppRoot(rootRef: RefObject<View>): Promise<{
  uri: string; width: number; height: number; bytes: number;
}>
```

- Provider exposes the app root `View` ref via context — host does not thread one.
- Launcher bubble is hidden by toggling a provider-owned ref flag (`capturing`) the launcher subscribes to; one-frame `requestAnimationFrame` delay before `captureRef`.
- If keyboard is visible, dismiss first and wait two frames.
- Captured file lives in `FileSystem.cacheDirectory`. Cleaned up on submit success or provider unmount. Queue-owned files are exempt from cleanup.

### Annotation flatten (Skia-free)

Render a hidden `FlattenView` containing `<Image src={screenshot.uri} />` + an absolutely-positioned `<Svg>` with the annotation paths. `captureRef` the flatten view → flat PNG.

```
┌───────────────────────────────────────┐
│  <FlattenView> (hidden, off-screen)   │
│  ┌─────────────────────────────────┐  │
│  │  <Image src={screenshot.uri}/>  │  │
│  │  <Svg absolute top:0 left:0>    │  │
│  │    {paths from annotation store}│  │
│  │  </Svg>                         │  │
│  └─────────────────────────────────┘  │
└───────────────────────────────────────┘
       │ captureRef(flattenRef)
       ▼  flattened PNG
```

`react-native-svg` renders into a native view tree that view-shot captures pixel-perfect. No Skia, no canvas, no server-side flatten path.

## Collectors

All collectors are start/stop functions owned by the provider. **Fail-open is a hard requirement**: any throw inside patched code must not break the host app.

| Collector | RN implementation |
|---|---|
| `console` | Patch `console.log / info / warn / error / debug` globals. Preserve original references in a closure. Capture stack via `new Error().stack` on warn+error only. Ring-buffer capped at config default. |
| `network` | Patch `global.fetch` and `global.XMLHttpRequest.prototype.{open, send, setRequestHeader}`. Axios in RN goes through XHR, so both must be patched. Bodies redacted per `redact.bodyRedactKeys` before storage. Size from `content-length` or response byte count. |
| `breadcrumbs` | `useRepro().log()` → emitter → ring buffer. Shape identical to web. |
| `systemInfo` | `Platform.OS`, `Platform.Version`, `Device.modelName` (expo-device), `Constants.expoConfig?.version` + native build number (appVersion/appBuild), `Dimensions.get('window' / 'screen')`, `PixelRatio.get()`, `Intl.DateTimeFormat().resolvedOptions().timeZone`, `NetInfo.fetch()` for `online` + `effectiveType`. |

**Interceptor cleanup rule**: on provider unmount, `patch.restore()` swaps the originals back. The patch module stores original refs in a closure at patch time; never reads from the global after patching. Prevents double-wrap if another SDK patches between us.

**Coexistence with other patchers** (Reactotron, Sentry, OpenTelemetry JS): sentinel property `__reprojs_patched` set on our wrappers. If we detect a non-ours wrapper already in place we still patch on top but log a dev-mode warning. If our sentinel is present we no-op (double-mount guard).

## Offline queue

### Queue on disk

```
AsyncStorage key: @reprojs/expo/queue/v1
Value: JSON { items: QueueItem[], sizeBytes: number }

interface QueueItem {
  id: string;                    // ULID, also the Idempotency-Key
  createdAt: string;
  payload: {
    input: ReportIntakeInput;
    attachments: Array<{ kind: AttachmentKind; uri: string; bytes: number }>;
  };
  attempts: number;
  lastErrorAt: string | null;
  lastError: string | null;
}
```

Attachment `uri`s are `file://` paths in `FileSystem.cacheDirectory`.

### Lifecycle

1. **Enqueue** on wizard submit:
   - Flatten annotated screenshot → cache file.
   - Serialize logs attachment → cache file.
   - Validate `ReportIntakeInput` with zod; if invalid, surface error, do **not** enqueue.
   - Enforce size caps (count ≤ 5, bytes ≤ 10MB). Over cap → drop oldest with a `queue_evicted` breadcrumb.
   - Persist queue; mark attachment files as queue-owned so cache cleanup skips them.
2. **Flush** triggers:
   - App foreground (`AppState` listener).
   - NetInfo `offline → online` transition.
   - Immediate attempt after enqueue if online.
   - Manual `repro.queue.flush()`.
3. **Retry policy**: `backoffMs = [1000, 5000, 30000, 120000]`. After 4 failed attempts the item stays in the queue but no auto-retry — next foreground/online transition resets the backoff counter.
4. **Per-item submit**:
   - POST `ReportIntakeInput` JSON with `Idempotency-Key: <item.id>`.
   - POST attachments via `/api/intake/attachments`.
   - 2xx → delete attachment files, remove queue item.
   - 4xx other than 429 → drop item, `queue_dropped_4xx` breadcrumb.
   - 429 / 5xx / network error → increment attempts, schedule next backoff.

### Privacy

Queue items contain report payloads including logs. AsyncStorage is sandboxed per-app but **not** encrypted by default. Documented in the README. Encrypted queue via `expo-secure-store` is a v2 nice-to-have.

## `@reprojs/shared` contract changes (additive, non-breaking)

```ts
export const ReportSource = z.enum(["web", "expo"])
export type ReportSource = z.infer<typeof ReportSource>

export const DevicePlatform = z.enum(["ios", "android"])

export const SystemInfo = z.object({
  userAgent: z.string(),
  platform: z.string(),
  devicePlatform: DevicePlatform.optional(),      // NEW — set when source === 'expo'
  appVersion: z.string().optional(),              // NEW
  appBuild: z.string().optional(),                // NEW
  deviceModel: z.string().optional(),             // NEW
  osVersion: z.string().optional(),               // NEW
  language: z.string(),
  timezone: z.string(),
  timezoneOffset: z.number(),
  viewport: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  screen: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  dpr: z.number().positive(),
  online: z.boolean(),
  connection: z.object({ effectiveType: z.string().optional(), rtt: z.number().optional(), downlink: z.number().optional() }).optional(),
  pageUrl: z.string().max(2048),                  // RELAXED: was z.string().url()
  referrer: z.string().optional(),
  timestamp: z.string(),
})

export const ReportContext = z.object({
  source: ReportSource.default("web"),            // NEW
  pageUrl: z.string().max(2048),                  // RELAXED
  userAgent: z.string().max(1000),
  viewport: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  timestamp: z.string(),
  reporter: ReporterIdentity.optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  systemInfo: SystemInfo.optional(),
  cookies: z.array(CookieEntry).optional(),
})

export const ReportSummaryDTO = z.object({
  // ... existing fields
  source: ReportSource,                           // NEW — non-optional on read
  devicePlatform: DevicePlatform.nullable(),      // NEW
})
```

Idempotency-Key is a request header, not a schema field — documented in the intake contract doc.

## Dashboard DB migration

Single additive migration:

```sql
ALTER TABLE reports
  ADD COLUMN source TEXT NOT NULL DEFAULT 'web'
    CHECK (source IN ('web', 'expo')),
  ADD COLUMN device_platform TEXT
    CHECK (device_platform IS NULL OR device_platform IN ('ios', 'android')),
  ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX reports_project_idempotency_key_idx
  ON reports(project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX reports_project_source_created_idx
  ON reports(project_id, source, created_at DESC);
```

Existing rows backfill via the column default. Idempotency uniqueness is per-project so two projects can't collide on a client-generated ULID.

## Intake endpoint changes

`apps/dashboard/server/api/intake/reports.ts`:

1. Read `Idempotency-Key` header. If present, look up `(project_id, idempotency_key)`. If found, return the existing `IntakeResponse` without new row/storage writes.
2. Extract `source` + device fields from validated `ReportContext` → write to the new columns.
3. Include `source` in the rate-limit key so a mobile burst can't starve web reports (or vice versa) on the same project.
4. Origin allowlist: mobile has no browser `Origin`. Allow requests with no `Origin` header only when validated `context.source === "expo"`. Project key remains the primary trust boundary for mobile. Bundle-identifier allowlist is v2.

## Dashboard UI changes

### Inbox list
Platform pill next to the title — `Web` / `iOS` / `Android`, derived from `source` + `devicePlatform`. Unknown mobile falls back to `Mobile`.

### Inbox sidebar filter
New filter group `Source` with checkbox options and counts: `Web`, `iOS`, `Android`. Persisted via the existing URL query-param convention.

### Ticket detail
Conditional rendering keyed on `source`:
- `web` → unchanged (browser device card, replay tab if `hasReplay`).
- `expo` → device card showing `deviceModel`, `osVersion`, `appVersion (build)`, `devicePlatform`; **no replay tab**; `pageUrl` rendered as plain text labeled "Route".

## Expo plugin best-practices compliance

| Practice | Implementation |
|---|---|
| Entry convention | `packages/expo/app.plugin.js` at root, re-exports compiled plugin from `dist/plugin/with-repro.js` |
| Plugin body (v1) | No-op `withPlugins` pass-through. Exists so consumers add `"@reprojs/expo"` to `app.json` `plugins` uniformly — future-proofs adding Info.plist/AndroidManifest patches without a breaking change |
| `peerDependencies` | `expo`, `react`, `react-native`, `react-native-view-shot`, `react-native-svg`, `react-native-gesture-handler`, `@react-native-async-storage/async-storage`, `@react-native-community/netinfo`, `expo-device`, `expo-constants`, `expo-file-system` |
| `peerDependenciesMeta` | None optional in v1 |
| SDK version range | `expo: ">=52.0.0"`; CI matrix covers SDK 52 + 53 |
| New Architecture | All chosen native deps support Fabric; no opt-out guard |
| Expo Go | **Dev-build-only**. Runtime check logs dev-mode warning and no-ops `open()` when view-shot's native module is missing |
| Metro config | No custom resolver |
| Types | `dist/index.d.ts`, generated by tsdown. Plugin types via `@expo/config-plugins` |
| Build | `tsdown`, matching the rest of the repo. No `expo-module-scripts` (pure JS, no native source) |

## Testing

| Layer | Tool | Coverage |
|---|---|---|
| Pure units (queue storage, redact, ring-buffer, annotation geometry) | `bun test` | Every pure module |
| Collector patches (console, fetch/XHR) | `bun test` + global shims | Patch applies, records, restores; fail-open under throwing host code |
| Provider + hook | `bun test` + `@testing-library/react-native` | Mount/unmount cleanup; `useRepro()` contract; dev-mode runtime checks |
| Offline queue | `bun test` + `AsyncStorage` mock + fake timers | Enqueue, eviction, backoff, idempotency, foreground/online triggers |
| Intake contract | Existing dashboard integration tests extended with a mobile fixture | `source=expo` persists with `devicePlatform`; idempotency dedupes |
| E2E screenshot flow | **Deferred.** Manual smoke tests on iOS + Android dev builds before release — real-device screenshot verification is out of scope for v1 automated tests |

## Risks

1. **view-shot on Android + translucent keyboard/modal**: occasional blank frames in library reports. Mitigation: dismiss keyboard, wait two frames, verify `bytes > 0` post-capture, surface a "retry capture" button on empty result.
2. **fetch/XHR double-patching**: Reactotron / Sentry / OpenTelemetry JS may already patch. Sentinel-property check + dev-mode warning; no-op if our sentinel is present.
3. **Expo SDK upgrade cadence**: peer-dep range may need tightening per major Expo SDK. Documented in CI matrix.
4. **Idempotency key collision**: extremely low probability with ULID + per-project uniqueness. Accepted.
5. **Origin allowlist relaxation for mobile**: weaker trust boundary than web. Project key is primary defense; bundle-identifier allowlist deferred to v2. Documented security trade-off.

## Out of scope (v1)

- Session replay (any flavor)
- Cookies
- Full-scroll screenshot (`snapshotContentContainer: true`)
- React Navigation auto-breadcrumbs — docs recommend manual `repro.log()`
- Redux/Zustand state capture
- Encrypted queue (`expo-secure-store`)
- Shake-to-report gesture
- Bare React Native standalone (`@reprojs/react-native`) — v2 consideration
- Bundle-identifier allowlist for mobile intake — v2
