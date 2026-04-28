# SDK Wizard Redesign + User Attachments — Design

**Date:** 2026-04-27
**Status:** Draft — awaiting plan

## Problem

The web SDK widget (`packages/ui` rendered by `packages/core`) is visibly behind the rest of the product. The Expo SDK (`packages/expo`) ships a polished 3-step wizard (`Details → Annotate → Review`) using the dashboard's flame/mist palette, with reusable controls (`PrimaryButton`, `SecondaryButton`, `StepIndicator`, `FieldLabel`), a "what's included in this report" summary card, and a step indicator. The web widget is monochrome, 2-step (`Annotate → Describe`), uses ad-hoc `.ft-*` styles with hard-coded hex values that share nothing with the rest of the design system, and lacks any structured review step.

Separately, users have been asking to attach their own files (additional screenshots from another tab, a copied JSON, a video clip from a screen recorder) on top of the auto-captured screenshot. Today the SDK has no surface for this and the intake API only parses fixed-name multipart parts (`report`, `screenshot`, `logs`, `replay`).

This spec covers both: bring the web widget visually and structurally up to the Expo wizard's level using shared theme tokens, and add user-attachment support across SDK + intake + dashboard.

## Goals

- Web SDK widget is structurally and visually parity with Expo: same 3 steps, same step indicator, same control vocabulary, same flame/mist palette.
- A single source of truth for theme tokens lives in `packages/sdk-utils` so the two SDKs can never drift again.
- Users can optionally attach up to 5 additional files of any non-executable type per report from both web and Expo SDKs.
- Attachments are end-to-end usable: the intake stores them, the dashboard report drawer renders them with download links and image previews.
- The DB migration is additive and backward compatible: old SDKs work unchanged, new SDK against an old server silently drops attachments without breaking the rest of the report.

## Non-goals (v1)

- Drag-and-drop file dropping anywhere in the wizard. v1 is a click-to-pick affordance only.
- In-wizard image annotation of user-supplied attachments — only the auto-captured screenshot is annotatable.
- Camera capture in the Expo SDK (no `expo-image-picker` in v1; `expo-document-picker` only).
- Resumable / chunked uploads. Single multipart POST as today, capped by `INTAKE_MAX_BYTES`.
- A separate `attachments` intake endpoint. Attachments piggyback on `POST /api/intake/reports`.
- Per-attachment annotation, ordering, or captions.
- Migrating the existing screenshot/replay/logs storage layout. Only the new `user-file` kind uses the new key prefix.

## Decisions (locked during brainstorming)

1. **Wizard step order on web.** `Annotate → Details → Review`. Same 3 steps as Expo, but the screenshot step comes first because `getDisplayMedia()` triggers an OS-level dialog that has to fire before any other UI is meaningful. Expo keeps `Details → Annotate → Review` (no OS dialog there).
2. **Visual target.** Match Expo: flame/mist palette, mono uppercase field labels, surfaceSoft inputs, primary button shadow, summary card, step-indicator dots with connecting bars.
3. **Attachment shape.** Hybrid: images render as thumbnails (with object URL preview), non-images render as generic file chips (icon + name + size). Single mixed list.
4. **Attachment location.** Details step only (alongside title/description). Review shows them read-only; no add/remove on Review.
5. **Theme sharing.** Hoist token *values* to `packages/sdk-utils/src/theme/tokens.ts`. Web ui generates CSS custom properties from the tokens at mount time and injects them into the shadow root host. Expo continues to consume the token object directly.
6. **Scope.** End-to-end on web (SDK + shared + intake + dashboard render) AND parity in Expo from day one. Same single plan touches both SDKs.
7. **Limits.** Max 5 files per report; 10 MB per file; 25 MB total user-files per report. Server-side mime denylist (executables/scripts). Client-side validation is a UX guardrail; server is authoritative.
8. **Backward compatibility.** New `AttachmentKind` enum value (`"user-file"`); new nullable `filename` column on `report_attachments`. No backfill. Old SDKs unaffected; new SDK against old server silently drops attachments (the server's multipart parser ignores unknown parts).

## Architecture

### Package layout

```
packages/
├── sdk-utils/
│   └── src/
│       ├── theme/
│       │   ├── tokens.ts          # color, radius, hit — runtime-neutral
│       │   └── index.ts
│       └── attachments/
│           ├── types.ts           # Attachment, AttachmentLimits
│           └── validate.ts        # validate(File[], limits) → {ok, errors}
│
├── ui/                            # web Preact widget
│   └── src/
│       ├── wizard/
│       │   ├── theme-css.ts       # tokens → ":host { --ft-color-*: …; }"
│       │   ├── controls.tsx       # PrimaryButton, SecondaryButton,
│       │   │                      # StepIndicator, FieldLabel, Header
│       │   ├── attachment-list.tsx
│       │   ├── step-annotate.tsx  # restyled
│       │   ├── step-details.tsx   # NEW (replaces step-describe.tsx)
│       │   └── step-review.tsx    # NEW
│       ├── reporter.tsx           # 3-step state machine
│       ├── styles.css             # rewritten to use var(--ft-*)
│       └── mount.ts               # injects <style> with theme-css output
│
├── expo/
│   └── src/
│       ├── wizard/
│       │   ├── theme.ts           # one-line re-export from sdk-utils
│       │   ├── controls.tsx       # unchanged API; tokens come from sdk-utils
│       │   ├── attachment-list.tsx  # NEW (RN equivalent)
│       │   ├── step-form.tsx      # adds AttachmentList
│       │   └── sheet.tsx          # threads attachments through onSubmit
│       └── capture/
│           └── file-picker.ts     # expo-document-picker wrapper
│
├── core/                          # web SDK entry
│   └── src/
│       ├── intake-client.ts       # serialize attachment[N] parts
│       └── index.ts               # wire attachments into onSubmit
│
└── shared/
    └── src/
        └── reports.ts             # AttachmentKind += "user-file"

apps/
└── dashboard/
    ├── server/
    │   ├── api/intake/reports.ts  # parse attachment[N], persist, validate
    │   └── db/
    │       ├── schema/reports.ts  # report_attachments.filename column
    │       └── migrations/        # new migration: filename + enum check
    └── app/components/report-drawer/
        ├── attachments-tab.vue    # NEW tab — image grid + file list
        └── overview-tab.vue       # adds "N additional files" chip
```

### End-to-end data flow (web)

```
1. core.open() → ui.open() → Reporter mounts
2. Reporter.onCapture() → screenshot.ts:getDisplayMedia → annotated source img
   • Cancel → close wizard (existing behavior)
3. <StepAnnotate>     full-bleed canvas + flame/mist toolbar
   • Skip → annotated = raw screenshot
   • Next → flatten(canvas, shapes) → annotated Blob
4. <StepDetails>      title + description + AttachmentList
   • "+" → <input type="file" multiple>
   • For each File: validate via sdk-utils → push into Attachment[]
   • Remove → revokeObjectURL + splice
   • Back returns to Annotate; state preserved
5. <StepReview>       "Included in this report" summary card
   • Lines: title+desc, screenshot, console/network/breadcrumbs,
     environment, "N attachments" with file count
   • Send report → onSubmit
6. core.onSubmit():
   - snap = collectors.snapshotAll()
   - replay = collectors.flushReplay()
   - postReport({title, description, screenshot=annotated, logs, replay,
                 attachments})
7. intake-client builds FormData:
     "report"          JSON
     "screenshot"      annotated PNG
     "logs"            JSON (existing)
     "replay"          gzip (existing)
     "attachment[0]"   File (filename + content-type from Attachment)
     "attachment[1]"   File
     ...
8. POST /api/intake/reports
9. Server validates per-file size, total size, mime denylist, sanitizes
   filename, PUTs to ${reportId}/user/${idx}-${safeName}, inserts
   report_attachments rows with kind="user-file" and filename column.
10. 201 → SDK shows success, wizard auto-closes.
```

Expo's flow is structurally identical except step order is `Details → Annotate → Review` and the file picker is `expo-document-picker.getDocumentAsync({multiple:true})`.

### Theme sharing mechanics

```ts
// packages/sdk-utils/src/theme/tokens.ts
export const tokens = {
  color: {
    bg: "#ffffff",
    surfaceSoft: "#f5f7f8",
    surface: "#edf0f1",
    border: "#dde2e5",
    borderStrong: "#c7cfd5",
    text: "#25343f",
    textMuted: "#6c7a87",
    textFaint: "#9aa4ae",
    primary: "#ff9b51",
    primaryPressed: "#f27a1f",
    primarySoft: "#fff2e6",
    primaryDisabled: "#ffdcbf",
    danger: "#b91c1c",
    dangerSoft: "#fef2f2",
    dangerBorder: "#fecaca",
  },
  radius: { sm: 8, md: 12, lg: 16, pill: 999 },
  hit: 44,
} as const

export type Tokens = typeof tokens
```

```ts
// packages/ui/src/wizard/theme-css.ts
import { tokens } from "@reprojs/sdk-utils/theme"

export function themeToCssVars(t = tokens): string {
  const lines: string[] = [":host {"]
  for (const [name, value] of Object.entries(t.color)) {
    lines.push(`  --ft-color-${kebab(name)}: ${value};`)
  }
  for (const [name, value] of Object.entries(t.radius)) {
    lines.push(`  --ft-radius-${name}: ${value}px;`)
  }
  lines.push(`  --ft-hit: ${t.hit}px;`)
  lines.push("}")
  return lines.join("\n")
}
```

`mount.ts` calls `themeToCssVars()` once and prepends the result to the existing inlined stylesheet. `styles.css` switches every hard-coded color to `var(--ft-color-*)`.

```ts
// packages/expo/src/wizard/theme.ts
export { tokens as theme } from "@reprojs/sdk-utils/theme"
```

(The single-line re-export keeps the existing `theme.color.primary` import sites in expo unchanged.)

### Attachment shape

```ts
// packages/sdk-utils/src/attachments/types.ts
export interface Attachment {
  id: string            // uuid, local lifetime
  blob: Blob            // raw file bytes
  filename: string      // sanitized client-side (final auth at server)
  mime: string          // content-type
  size: number          // bytes
  isImage: boolean      // mime.startsWith("image/")
  previewUrl?: string   // object URL for image preview; caller manages
}

export interface AttachmentLimits {
  maxCount: number       // default 5
  maxFileBytes: number   // default 10 * 1024 * 1024
  maxTotalBytes: number  // default 25 * 1024 * 1024
}

// packages/sdk-utils/src/attachments/validate.ts
export interface ValidationFailure {
  filename: string
  reason: "too-large" | "denied-mime" | "count-exceeded" | "total-exceeded" | "unreadable"
}

export interface ValidationResult {
  accepted: Attachment[]
  rejected: ValidationFailure[]
}

export function validateAttachments(
  candidates: File[],
  existing: Attachment[],
  limits: AttachmentLimits,
): ValidationResult
```

### Intake server changes

```ts
// pseudo
const userParts: { idx: number; data: Buffer; filename: string; mime: string }[] = []
for (const part of parts) {
  const m = part.name?.match(/^attachment\[(\d+)\]$/)
  if (!m) continue
  if (!part.filename) throw 400("attachment missing filename")
  if (part.data.length > USER_FILE_MAX_BYTES) throw 413(...)
  if (DENIED_MIMES.has(part.type)) throw 415(...)
  userParts.push({ idx: +m[1], data: part.data, filename: sanitize(part.filename), mime: part.type })
}
const totalUserBytes = userParts.reduce((n, p) => n + p.data.length, 0)
if (totalUserBytes > USER_FILES_TOTAL_MAX_BYTES) throw 413(...)

const storage = await getStorage()
const writes = userParts.map(async (p) => {
  const key = `${report.id}/user/${p.idx}-${p.filename}`
  await storage.put(key, new Uint8Array(p.data), p.mime)
  await db.insert(reportAttachments).values({
    reportId: report.id,
    kind: "user-file",
    storageKey: key,
    contentType: p.mime,
    sizeBytes: p.data.length,
    filename: p.filename,
  })
  return key
})
try { await Promise.all(writes) }
catch (e) { await rollbackPuts(writes.map(w => w.key)); throw e }
```

`rollbackPuts` is a new helper in `server/lib/storage` that issues `delete` for each key and swallows individual failures (best-effort cleanup; orphaned blobs are preferable to a half-failed report row).

### DB migration

```sql
-- migrations/00XX_user_attachments.sql
ALTER TABLE report_attachments
  ADD COLUMN filename text;

ALTER TABLE report_attachments
  DROP CONSTRAINT report_attachments_kind_check;

ALTER TABLE report_attachments
  ADD CONSTRAINT report_attachments_kind_check
  CHECK (kind IN ('screenshot', 'annotated-screenshot', 'replay', 'logs', 'user-file'));
```

Additive, no backfill. The `filename` column stays NULL for existing screenshot/replay/logs rows.

### Dashboard render

`apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.get.ts` already returns `attachments: AttachmentDTO[]` — extend `AttachmentDTO` in `packages/shared` to include `filename: string | null` so user-files surface their original name. The drawer routes `kind === "user-file"` to a new `<AttachmentsTab>` that groups by `isImage`:

- Image grid: thumbnails (storage URL), click → open in new tab. Decode error falls back to file chip.
- File list: mime-keyed icon, filename, human-readable size, download button.

`<OverviewTab>` adds a small chip "N additional files" when any user-file attachment exists; clicking the chip activates the new tab.

## Error handling

### Client (SDK widget)

| Scenario | Behavior |
|---|---|
| File > per-file cap | Inline error chip on AttachmentList; file not added; existing files preserved. |
| Adding would exceed total | Same. Error names which file overflowed and by how much. |
| At max count | Disable "+" button; show "5 of 5 — remove one to add another". |
| Mime in denylist (client mirror) | Inline error "File type not allowed". |
| Unreadable blob | Inline error "Couldn't read file. Try again." |
| Submit while assembling | Disable "Send report" until FormData is built. |
| 413 from server | Existing error path; message rendered in Review. User can Back to Details, remove file, retry. Idempotency-Key (existing) keys retries. |
| 415 from server | Same; message names offending file. |
| Network failure | Existing error path; state preserved; retry safe. |
| Cancel | Revoke all object URLs; resume replay buffer (existing). |

### Server (intake)

| Scenario | Behavior |
|---|---|
| `attachment[N]` missing filename | 400, `"attachment missing filename"`. |
| Filename has path separators / control chars | Sanitize: strip `/\\\0` + control bytes; truncate 200 chars; if empty → `attachment-${idx}`. |
| Filename collision after sanitize | Storage key prefixed with `${idx}-`, so no collision. |
| Per-file cap exceeded | 413; `data.index = N`. |
| Total user-files cap exceeded | 413; message includes the budget number. |
| Denylisted mime | 415; message names file. |
| Storage write fails for one of N | `rollbackPuts` deletes succeeded keys; 500 propagates. No partial DB state — DB inserts only happen *after* the per-attachment storage put resolves. |
| Multipart parser hits `INTAKE_MAX_BYTES` | Existing 413, no change. |

### Dashboard

| Scenario | Behavior |
|---|---|
| Storage 404 for an attachment | Render chip with "File unavailable" badge; disable download. Other attachments still load. |
| Image decode error | Fall back to file chip; never show broken-image glyph. |
| Long filename | Truncate with middle ellipsis (`reall…filename.png`); tooltip = full name. |
| `application/octet-stream` mime | Generic "File" icon; no preview attempt. |

## Limits & defaults

| Knob | Default | Notes |
|---|---|---|
| `maxCount` | 5 | client + server |
| `maxFileBytes` | 10 MB | client + server (env: `INTAKE_USER_FILE_MAX_BYTES`) |
| `maxTotalUserBytes` | 25 MB | server only (env: `INTAKE_USER_FILES_TOTAL_MAX_BYTES`); client tracks for UX |
| MIME denylist | `application/x-msdownload`, `application/x-sh`, `text/x-shellscript`, `application/x-executable`; extension-based: `.exe .bat .sh .ps1 .cmd .com .scr .vbs` | server only |
| Filename max chars | 200 | server-side sanitize |

All four numeric knobs are read from env at server start (parsed by the existing `lib/env.ts`).

## Testing

Per the project's TDD rule, every layer's tests are written first.

### `packages/sdk-utils`
- `attachments/validate.test.ts` — per-file cap, count cap, total cap, mime denylist, zero-byte file, missing mime, unicode filename, accumulates errors instead of bailing.
- `theme/tokens.test.ts` — snapshot guard so accidental token deletion trips CI.

### `packages/ui`
- `wizard/theme-css.test.ts` — `themeToCssVars(tokens)` produces correct lines; double-injection idempotent.
- `wizard/attachment-list.test.ts` — picker click adds, remove revokes object URL (spy `URL.revokeObjectURL`), at-cap disables "+", validation errors render, total counter accurate.
- `wizard/step-details.test.ts` — wires fields + attachments through onSubmit; back nav preserves state.
- `wizard/step-review.test.ts` — summary card lists user files with count; submit error renders; primary button disabled while submitting.
- `reporter.test.ts` — 3-step state machine; back/forward across all transitions preserves state.

happy-dom gap: `URL.createObjectURL`/`revokeObjectURL` are stubs; verify spy calls, don't assume real-browser side effects. Use `Blob` directly where `File` isn't needed.

### `packages/expo`
- `wizard/step-form.test.tsx` — AttachmentList renders; files pass through onSubmit.
- `wizard/sheet.test.tsx` — summary line shows attachment count.
- `capture/file-picker.test.ts` — mocks `expo-document-picker`; verifies validation runs against picker output.

### `packages/core`
- `intake-client.test.ts` — extends existing; `postReport` with attachments serializes `attachment[N]` parts with correct filename + content-type; without attachments, body byte-identical to today (regression guard).
- `index.test.ts` — wire-through: wizard `onSubmit` payload reaches `postReport` with attachments intact.

### `apps/dashboard` (real Postgres)
- `tests/api/intake-attachments.test.ts` — accepts N attachments, persists rows + storage keys; rejects per-file > cap (413); rejects total > cap (413); rejects denylisted mime (415); sanitizes filename; rolls back partial storage writes on failure; old SDK (no attachment parts) behaves identically.
- `tests/api/intake.test.ts` — regression: existing screenshot-only / replay-only / logs-only paths unchanged.
- `tests/api/reports.test.ts` — `GET /reports/:id` returns user-file attachments with filename + mime + presigned URL.
- `tests/components/attachments-tab.test.ts` — image grid + file chip list; broken-storage URL falls back gracefully.

### Manual / browser verification
Walk `packages/ui/demo` end-to-end with: zero attachments, one image, one PDF, hitting per-file cap, hitting count cap, removing files, Back/Forward navigation, cancel mid-flow. Cross-browser smoke on Chrome + Firefox + Safari (file inputs differ across vendors).

## Sequencing risk (highest-unknowns-first)

1. **Token hoist + CSS-vars injection** lands first. Touches every styled element in `packages/ui`. Until this is green every later change rebases on shifting CSS.
2. **3-step wizard restructure** lands second, *without* attachments — just the new steps and new shared controls. Visual regression is isolated from feature work.
3. **Attachment data path** lands third, in this order: sdk-utils types/validators → intake server (DB migration first) → SDK wiring (web first, expo second) → dashboard render. The end-to-end integration test bridges all four.

## Open questions

None at design time — all decisions captured above. Possible follow-ups (out of scope, listed for memory):

- Drag-and-drop attachment dropping in the wizard.
- In-wizard annotation of user-supplied screenshots.
- Camera capture in Expo (`expo-image-picker`).
- Per-attachment captions / order.
- Resumable / chunked uploads beyond `INTAKE_MAX_BYTES`.
