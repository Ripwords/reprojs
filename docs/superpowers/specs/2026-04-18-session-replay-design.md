# Session Replay Recorder — Design Spec

**Sub-project E.** Rolling 30s DOM-event recorder in the SDK; gzipped, uploaded with each bug report; played back in the dashboard via `rrweb-player`. Completes the SDK's diagnostic bundle.

**Status:** design approved, awaiting user sign-off before implementation plan.

## 1. Goals and Non-Goals

**Goals**
- Capture the last 30 seconds of DOM activity leading up to a bug report.
- Reproduce the captured window exactly on the dashboard (DOM-level fidelity, not raw video).
- Respect privacy: passwords never captured; host apps have per-node and per-deployment escape hatches; admins can disable the whole feature per-project or per-deployment.
- Add minimal weight to the SDK baseline (<20 KB gzipped for the recorder, dynamically imported so `replay: false` hosts pay nothing).
- Keep the recorder framework-agnostic — no React/Vue/Svelte, no shadow-DOM exotica (for v1).

**Non-goals (v1)**
- iframe content capture, canvas/WebGL capture, CSS-in-JS style-sheet capture.
- Live streaming / watch-in-progress playback.
- Replay analytics (heatmaps, rage-click detection).
- Mobile webview instrumentation beyond what runs in a standard browser.
- Native mobile SDKs (deferred per CLAUDE.md §1.2).

## 2. Core Decisions

| Area | Decision | Rationale |
|---|---|---|
| Recorder format | Vendored minimal rrweb-compatible subset in a new `packages/recorder` package | Keeps bundle cost under control while remaining schema-compatible with `rrweb-player` for dashboard playback — no custom player work. |
| Attachment integration | New `replay` attachment kind — separate multipart part, separate `report_attachments` row, own Zod schema extension | Replay is categorically different from `logs` (much larger, binary-ish, read lazily on Play). Separation supports independent lifecycle/retention, avoids bloating logs parsing. |
| Payload budget | 1 MB hard cap, gzipped via `CompressionStream` at flush time; ring-buffer raw cap 4 MB; truncate oldest events if post-gzip exceeds 1 MB (up to 3 retries, else omit replay) | `CompressionStream` is native + free in all evergreen browsers; event streams routinely hit 4× ratios so 1 MB gzipped ≈ 3–5 MB of raw events. |
| Privacy masking | Config-driven, `moderate` default: mask passwords + `data-feedback-mask` + email/tel/number input types. `strict` and `minimal` modes for per-deployment risk profile. `data-feedback-block` subtree exclusion works in all modes. | Mirrors rrweb defaults. Hosts pick strictness per deployment without forking the SDK. |
| Replay UI | `rrweb-player` dynamically imported in the Vue drawer tab — scrubber, play/pause, timestamp overlay, speed control | Off-the-shelf player saves non-trivial custom work; lazy-loading contains the ~150 KB weight to users who actually click Play. |
| Accessibility from GitHub | Dashboard-only; no replay links in GitHub Issue bodies | Keeps replay behind auth+RBAC. GitHub issues are visible to all repo members — not the right gate for session data. |

## 3. Architecture

**New package:** `packages/recorder/` — framework-agnostic, ESM+CJS+.d.ts via tsdown, matches the other `packages/*` build setup.

**Three-sided system:**

1. **SDK side** — `packages/recorder` instantiated from `packages/ui/src/collectors/replay.ts`. Recorder starts on `feedback.init()`, not when the widget opens, so there's history available at submit time. On submit the existing `snapshotAll()` flow calls `recorder.flushGzipped()`, which ring-buffer-drains events, gzips, and returns `{ bytes, eventCount, durationMs, truncated }`. The core submit path attaches `bytes` as the multipart `replay` part.

2. **Intake side** — `POST /api/intake/reports` gains an optional `replay` multipart part. Validates size (≤ 1 MB), persists to storage as `<reportId>/replay.json.gz`, inserts a `report_attachments` row with `kind = 'replay'`, `contentType = 'application/gzip'`. Content-Type is hardcoded server-side — the client-supplied MIME is ignored, matching the existing pattern for `screenshot` and `logs`.

3. **Dashboard side** — report drawer gets a new "Replay" tab. The tab component lazy-imports `rrweb-player`, fetches the gzipped bytes via the existing signed-attachment-URL flow, decompresses in-browser with `DecompressionStream`, and feeds the resulting event array to `Replayer`.

**Bundle impact:**
- SDK baseline unchanged (~15 KB for core + collectors).
- Recorder adds ~15–20 KB gzipped when enabled.
- Total SDK with recorder: ~35 KB gzipped, inside CLAUDE.md §5.1's 50 KB stretch goal.
- `replay: false` at init avoids loading the recorder chunk at all.

## 4. Components

### `packages/recorder/` (new package)

| File | Responsibility |
|---|---|
| `src/types.ts` | Event type definitions, rrweb-schema-compatible (`EventType`, `IncrementalSource`, `serializedNode`, mutation/input/mouse/scroll records). |
| `src/record.ts` | Public API: `createRecorder(config)` returning `{ start, stop, pause, resume, flushGzipped }`. Orchestrates observers + buffer + mask. |
| `src/observers/full-snapshot.ts` | Builds the initial DOM snapshot — walks the document, assigns node IDs, emits a `FullSnapshot` event. |
| `src/observers/mutation.ts` | `MutationObserver` wrapper — emits add/remove/attribute/text mutations. |
| `src/observers/input.ts` | Input event listener — emits masked values per mask rules. |
| `src/observers/mouse.ts` | Mouse move/click/scroll listeners. |
| `src/observers/viewport.ts` | `resize` listener + initial viewport snapshot. |
| `src/buffer.ts` | Rolling ring buffer. Size-bounded (≤4 MB raw), time-bounded (≥30 s window). `flush()` returns events in chronological order and clears the buffer. |
| `src/mask.ts` | Mask config → predicate. Handles `strict`/`moderate`/`minimal`, `data-feedback-mask`, `data-feedback-block`, custom `maskSelectors`/`blockSelectors`. |
| `src/compress.ts` | `gzipEvents(events): Promise<{ bytes, truncated, droppedEvents }>`. Uses `CompressionStream('gzip')`. Truncate-and-retry loop if result >1 MB (max 3 retries, then gives up). |
| `src/index.ts` | Public re-exports. |

### `packages/ui/src/collectors/replay.ts` (new)

Thin adapter: creates a `Recorder` on SDK init, exposes `start/stop/flushGzipped`. `packages/ui/src/collectors/index.ts` (existing) extends `snapshotAll()` to include `replayBytes` in the returned bundle. `packages/core` (existing) attaches it as a multipart part.

### `packages/shared/src/reports.ts` (extend)

Add `"replay"` to the attachment-kind union so SDK and dashboard agree on the value.

### Dashboard server

| File | Change |
|---|---|
| `server/api/intake/reports.ts` | Accept optional `replay` multipart part; validate size; persist to storage + `report_attachments` row. |
| `server/db/schema/reports.ts` | Extend `report_attachments.kind` enum with `"replay"`. |
| `server/db/schema/projects.ts` | Add `replayEnabled: boolean NOT NULL DEFAULT true`. |
| `server/api/projects/[id]/reports/[reportId]/attachment.get.ts` | No code change; existing signed-URL path already serves any attachment kind. |
| `server/lib/env.ts` | Add `REPLAY_FEATURE_ENABLED: boolean` (default `true`) and `INTAKE_REPLAY_MAX_BYTES: number` (default `1_048_576`). |

### Dashboard UI

| File | Change |
|---|---|
| `app/components/report-drawer/drawer.vue` | Add "Replay" tab. |
| `app/components/report-drawer/replay-tab.vue` (new) | Lazy-imports `rrweb-player`, fetches gzipped bytes, decompresses, feeds to player. |
| `apps/dashboard/package.json` | Add `rrweb-player` as a dashboard-only dependency (not in the SDK packages). |
| `app/pages/projects/[id]/settings/index.vue` | Toggle for `replayEnabled` in the project settings. |

## 5. Data Flow

### Record-time (host page)

```
feedback.init({ projectKey, replay: { masking: 'moderate' } })
  └── recorder.start()
      ├── full-snapshot.ts: walk DOM → push FullSnapshot event
      ├── attach mutation/input/mouse/viewport observers
      └── every event: mask.ts redact → buffer.push({ t, event })

[user interacts; buffer keeps last 30s, evicting oldest on 4 MB cap]

feedback.open() → user submits
 └── ui.collectors.snapshotAll()
     ├── console.drain()
     ├── network.drain()
     ├── breadcrumbs.drain()
     └── replay.flushGzipped()
         ├── buffer.flush() → Event[]
         ├── JSON.stringify → UTF-8 Uint8Array
         ├── CompressionStream('gzip') → gzipped Uint8Array
         └── if >1 MB: truncate oldest, retry (max 3)
             else: return { bytes, eventCount, durationMs, truncated }
 └── core.submit(): multipart POST [report, screenshot, logs, replay]
```

### Intake-time (dashboard server)

```
POST /api/intake/reports
  ├── existing: validate report JSON, origin, rate-limit, daily cap
  ├── if replay part present:
  │   ├── if !REPLAY_FEATURE_ENABLED or !project.replayEnabled: silently drop the
  │   │   part (report row still inserted, success 201); response body signals
  │   │   { replayStored: false, replayDisabled: true } so the SDK stops
  │   │   including it on subsequent submits during this session
  │   ├── else assert size ≤ INTAKE_REPLAY_MAX_BYTES (413 if over — rejects whole request)
  │   └── storage.put(`<reportId>/replay.json.gz`, bytes)
  └── insert report_attachments {
        kind: 'replay',
        contentType: 'application/gzip',
        storageKey: '<reportId>/replay.json.gz',
      }
```

### Read-time (dashboard drawer)

```
User clicks "Replay" tab
  └── replay-tab.vue mount
      ├── dynamic import('rrweb-player')
      ├── fetch signed-URL for replay attachment
      ├── response body → DecompressionStream('gzip') → Uint8Array
      ├── new TextDecoder().decode(bytes) → JSON.parse → Event[]
      └── new Replayer(events, { target: containerEl })
          → rrweb-player renders scrubber + play/pause
```

## 6. Error Handling and Privacy

### Failure modes

**Recorder-side (host page — MUST fail open; never break the host app):**

| Failure | Behavior |
|---|---|
| DOM observer throws (exotic host DOM) | Catch, log one warning, tear down observers, set internal `dead` flag. Submit proceeds with `replay` omitted. |
| `CompressionStream` unavailable (ancient browser) | Detected at init; recorder refuses to start, logs once. Submit proceeds without replay. |
| Buffer exceeds 4 MB raw | Ring-buffer eviction; oldest events drop. No user signal. |
| Gzipped result >1 MB | Truncate oldest and re-gzip, up to 3 retries. If still >1 MB, omit replay. `truncated: true` + `droppedEvents: N` in the first event's metadata when truncation occurred. |
| User closes tab mid-submit | No special handling — same as abandoned multipart POST. |

**Intake-side:**

| Failure | Behavior |
|---|---|
| `replay` part missing | Report still created; `replay` attachment absent. Drawer shows "No replay captured". |
| `replay` part >1 MB | 413 — existing `INTAKE_MAX_BYTES` aggregate cap enforces this. |
| Storage put fails after report row inserted | Log error, leave report without replay row. Matches existing screenshot/logs failure pattern. |

**Playback-side:**

| Failure | Behavior |
|---|---|
| Decompression fails | Tab shows "Replay unavailable" with retry button. |
| Replayer throws on malformed events | Same fail-soft; don't crash the dashboard page. |
| Attachment 404 (deleted from storage) | Same unavailable state. |

### Privacy guarantees

- **Default (`moderate`)** masks: `<input type="password">`, `<input type="email">`, `<input type="tel">`, `<input type="number">`, nodes with `data-feedback-mask`. Text inside masked nodes is replaced with `*` preserving length. Input `value` attributes on masked nodes are replaced with same-length `*`.
- **`strict`** masks all inputs, textareas, and selects regardless of type.
- **`minimal`** masks only `<input type="password">` and `data-feedback-mask`.
- **`data-feedback-block`** subtrees are entirely excluded from both the initial full-snapshot and subsequent mutations — nodes never exist in the event stream.
- **`pauseReplay()` / `resumeReplay()`** host-controlled window. Gap emits a "paused" marker event so the player displays a "Recording paused" frame rather than a silent stall.
- **Per-project disable:** `projects.replayEnabled=false` — intake silently drops the replay part but still creates the report (201). The response body signals `{ replayStored: false, replayDisabled: true }` and the SDK stops including replay on subsequent submits for that session. Admins toggle in project settings.
- **Per-deployment disable:** env `REPLAY_FEATURE_ENABLED=false` overrides per-project and drops replay parts install-wide with the same success-with-signal semantics.
- **Bundle-level opt-out:** `feedback.init({ replay: false })` prevents the recorder chunk from loading at all.

## 7. Testing

**SDK unit tests** (`packages/recorder/src/**/*.test.ts`, `bun test`, happy-dom or jsdom).

| Suite | Coverage |
|---|---|
| `buffer.test.ts` | Size-cap eviction; 30s time-window; chronological flush order; push-during-flush safety. |
| `mask.test.ts` | `moderate`/`strict`/`minimal` matrices; `data-feedback-mask`/`block`; custom selectors; length-preserving replacement. |
| `compress.test.ts` | Gzip round-trip via `CompressionStream` + `DecompressionStream`; truncate-retry loop; truncation metadata. |
| `observers/mutation.test.ts` | Add/remove/attribute/text events shape; detached nodes don't leak; mask rules apply to newly-added nodes. |
| `observers/input.test.ts` | Password input → `***`; respects mask config dynamically. |
| `record.test.ts` | Full lifecycle: start → interact → flush; pause/resume emits markers; stop tears down all observers. |

**Dashboard integration tests** (`apps/dashboard/tests/api/replay-intake.test.ts`, real Postgres).

- Happy path: `replay` part persists + row inserted.
- Missing `replay` part: backward-compat, report still created.
- Oversized `replay` part: 413.
- Malformed gzip bytes: stored as-is; decompression is the dashboard player's problem.
- `projects.replayEnabled=false`: report created (201), response signals `{ replayStored: false, replayDisabled: true }`, no replay row inserted.
- `REPLAY_FEATURE_ENABLED=false` env: same behavior install-wide, regardless of project setting.

**Dashboard UI tests** (`apps/dashboard/tests/components/replay-tab.test.ts`).

- Lazy import fires only on tab activation.
- Decompression error → "Replay unavailable".
- Missing attachment → "No replay captured".

**Deferred (documented gaps):**
- Real-browser end-to-end playback assertions wait for the Playwright addition referenced in CLAUDE.md §5.3.
- Load test for 1 MB replays — unit-tested via compress-retry logic; not reproduced at integration scale.

## 8. Migration and Rollout

- New schema changes: `report_attachments.kind` enum adds `"replay"`; `projects.replayEnabled` column added. Pre-production, so `db:push` applies both.
- `.env.example` gets `REPLAY_FEATURE_ENABLED=true` and `INTAKE_REPLAY_MAX_BYTES=1048576`.
- No backward-compat concern for older SDKs: they simply don't send the replay part; intake handles absent part already.
- CLAUDE.md §8 open-question #2 ("recorder format") closes with this design: rrweb-compatible schema, vendored minimal subset, `rrweb-player` on the dashboard. Update §8.

## 9. Out of Scope (Intentionally Deferred)

- Multi-tab session correlation.
- iframe content capture.
- Canvas/WebGL capture.
- Shadow-DOM content in third-party widgets inside the host page.
- Per-user replay privacy controls (e.g. reporter opts out of their own replay).
- Retention: replays stored indefinitely alongside the report for v1; retention policy becomes its own future spec.
- Replay analytics (heatmaps, rage clicks).
