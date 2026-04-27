# SDK Wizard Redesign + User Attachments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the web SDK widget (`packages/ui` + `packages/core`) structurally and visually in line with the Expo wizard (`packages/expo`), and add end-to-end user-attachment support across SDK, intake API, and dashboard.

**Architecture:** Hoist theme tokens to `@reprojs/sdk-utils` so web (Preact/DOM) and mobile (RN) share one source of truth. Web ui generates CSS custom properties from those tokens at mount time and injects them into the shadow root host; `styles.css` switches every hex literal to `var(--ft-*)`. Replace the 2-step `Annotate → Describe` flow with a 3-step `Annotate → Details → Review` mirror of Expo's wizard, using a shared control vocabulary (`PrimaryButton`, `SecondaryButton`, `StepIndicator`, `FieldLabel`). Add a hybrid attachment list (image thumbs + file chips) on the Details step. Extend the intake multipart contract with indexed `attachment[N]` parts; persist them as a new `kind: "user-file"` row with the original filename. Render attachments in the dashboard report drawer.

**Tech Stack:** Preact 10 + Shadow DOM + tsdown (web SDK), React Native + react-native-svg (Expo SDK), Bun + bun:test, TypeScript strict mode, Drizzle ORM + Postgres 17, Nuxt 4 + Vue 3 (dashboard), oxlint + oxfmt, Zod for contract validation. Per project rules: no `any`, no `fetch`+`useEffect`, TDD required, conventional commits, atomic.

**Phase order (sequenced by risk):**

| Phase | What lands | Why first |
|---|---|---|
| 1. Foundations | `sdk-utils` token + attachment modules; `theme-css` helper | Highest blast radius — touches the design system used by every subsequent phase. Land it green before building on it. |
| 2. Web wizard restructure | New shared controls, 3-step flow, `styles.css` rewritten to use vars; **no attachments yet** | Visual regressions in the SDK widget are isolated from feature work. |
| 3. Backend | DB migration, intake server parses `attachment[N]`, mime/size validation, storage rollback | Server has to accept attachments before any client can send them. |
| 4. Web SDK wiring | `AttachmentList` component, `step-details` wires it, `step-review` shows count, `intake-client` serializes parts, `core/index.ts` threads them through | First end-to-end happy path on web. |
| 5. Dashboard render | `AttachmentDTO.filename`, `<AttachmentsTab>`, overview chip | Operators can see what users sent. |
| 6. Expo parity | Theme re-export, `expo-document-picker` wrapper, attachment list (RN), step-form wiring, intake-client + queue updates | Mobile mirrors web behaviour. |

---

## Phase 1 — Foundations: `@reprojs/sdk-utils`

The package is currently `theme`-less and `attachment`-less. We're adding two new sub-modules. Both are runtime-neutral — no DOM, no Preact, no React Native imports.

### Task 1: Add `theme/tokens.ts` with the canonical token object

**Files:**
- Create: `packages/sdk-utils/src/theme/tokens.ts`
- Create: `packages/sdk-utils/src/theme/index.ts`
- Create: `packages/sdk-utils/src/theme/tokens.test.ts`
- Modify: `packages/sdk-utils/src/index.ts`

- [ ] **Step 1: Write the failing snapshot test.**

`packages/sdk-utils/src/theme/tokens.test.ts`:

```ts
import { expect, test } from "bun:test"
import { tokens } from "./tokens"

test("tokens object exposes the expected color, radius, and hit values", () => {
  expect(tokens.color.primary).toBe("#ff9b51")
  expect(tokens.color.primaryPressed).toBe("#f27a1f")
  expect(tokens.color.bg).toBe("#ffffff")
  expect(tokens.color.text).toBe("#25343f")
  expect(tokens.radius.md).toBe(12)
  expect(tokens.hit).toBe(44)
})

test("token keys are stable — guards against accidental deletion", () => {
  expect(Object.keys(tokens.color).sort()).toEqual(
    [
      "bg",
      "border",
      "borderStrong",
      "danger",
      "dangerBorder",
      "dangerSoft",
      "primary",
      "primaryDisabled",
      "primaryPressed",
      "primarySoft",
      "surface",
      "surfaceSoft",
      "text",
      "textFaint",
      "textMuted",
    ].sort(),
  )
  expect(Object.keys(tokens.radius).sort()).toEqual(["lg", "md", "pill", "sm"].sort())
})
```

- [ ] **Step 2: Run the test to verify it fails.**

```
cd /Users/jiajingteoh/Documents/reprojs && bun test packages/sdk-utils/src/theme/tokens.test.ts
```

Expected: FAIL — `Cannot find module './tokens'`.

- [ ] **Step 3: Create `packages/sdk-utils/src/theme/tokens.ts`.**

```ts
/**
 * Canonical theme tokens shared by the web SDK widget (packages/ui) and the
 * Expo SDK wizard (packages/expo). Mirrors the dashboard's flame (primary)
 * + mist (neutral) scales so reports composed in either SDK visually match
 * the triage UI they land in.
 */
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

- [ ] **Step 4: Create `packages/sdk-utils/src/theme/index.ts`.**

```ts
export { tokens } from "./tokens"
export type { Tokens } from "./tokens"
```

- [ ] **Step 5: Re-export from the package index.**

Modify `packages/sdk-utils/src/index.ts` — append a line:

```ts
export * from "./theme"
```

The full file should now be:

```ts
export * from "./ring-buffer"
export * from "./redact"
export * from "./breadcrumbs"
export * from "./annotation"
export * from "./theme"
```

- [ ] **Step 6: Run the test to verify it passes.**

```
bun test packages/sdk-utils/src/theme/tokens.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 7: Commit.**

```bash
git add packages/sdk-utils/src/theme packages/sdk-utils/src/index.ts
git commit -m "feat(sdk-utils): add canonical theme tokens shared by web and expo SDKs"
```

---

### Task 2: Add `attachments/types.ts` with the transport shape

**Files:**
- Create: `packages/sdk-utils/src/attachments/types.ts`
- Create: `packages/sdk-utils/src/attachments/index.ts`

- [ ] **Step 1: Create `packages/sdk-utils/src/attachments/types.ts`.**

```ts
/**
 * Transport shape for user-supplied additional attachments. Lives in
 * sdk-utils because both packages/ui and packages/expo build this same
 * shape from their respective file pickers and hand it to their intake
 * clients. The dashboard's AttachmentDTO is a separate, render-side shape.
 */
export interface Attachment {
  /** Local UUID — used as React/Preact key and for picker dedupe. */
  id: string
  /** Raw file bytes. In Expo this is wrapped via fetch(uri).blob() before send. */
  blob: Blob
  /** Original filename, sanitized client-side. Server is the source of truth. */
  filename: string
  /** MIME type. Falls back to "application/octet-stream" if the picker doesn't supply one. */
  mime: string
  /** Bytes. */
  size: number
  /** Convenience: mime.startsWith("image/"). Set at construction. */
  isImage: boolean
  /** Object URL for thumbnail preview. Caller manages revocation. */
  previewUrl?: string
}

export interface AttachmentLimits {
  maxCount: number
  maxFileBytes: number
  maxTotalBytes: number
}

export const DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits = {
  maxCount: 5,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
}

/**
 * Client-side mime denylist. Mirrors (but does not replace) the
 * server-side denylist. Server is authoritative.
 */
export const DENIED_MIME_PREFIXES: readonly string[] = [
  "application/x-msdownload",
  "application/x-sh",
  "text/x-shellscript",
  "application/x-executable",
] as const

export const DENIED_FILENAME_EXTENSIONS: readonly string[] = [
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".scr",
  ".sh",
  ".ps1",
  ".vbs",
] as const
```

- [ ] **Step 2: Create `packages/sdk-utils/src/attachments/index.ts`.**

```ts
export * from "./types"
export * from "./validate"
```

(`validate` is added in the next task — `index.ts` now references a missing module so DON'T run a typecheck/build between Task 2 and Task 3. The plan deliberately fronts the index file so Task 3's commit is a single, complete unit.)

- [ ] **Step 3: Stage files but don't commit yet.**

Files are part of the next task's commit.

```bash
git add packages/sdk-utils/src/attachments/types.ts packages/sdk-utils/src/attachments/index.ts
```

---

### Task 3: Add `attachments/validate.ts` with full TDD coverage

**Files:**
- Create: `packages/sdk-utils/src/attachments/validate.ts`
- Create: `packages/sdk-utils/src/attachments/validate.test.ts`
- Modify: `packages/sdk-utils/src/index.ts`

- [ ] **Step 1: Write the failing test.**

`packages/sdk-utils/src/attachments/validate.test.ts`:

```ts
import { expect, test } from "bun:test"
import { DEFAULT_ATTACHMENT_LIMITS, validateAttachments, type Attachment } from "./index"

function makeFile(name: string, bytes: number, type = "image/png"): File {
  const blob = new Blob([new Uint8Array(bytes)], { type })
  return new File([blob], name, { type })
}

function makeExisting(size: number, mime = "image/png"): Attachment {
  return {
    id: "x",
    blob: new Blob([new Uint8Array(size)], { type: mime }),
    filename: "existing.png",
    mime,
    size,
    isImage: mime.startsWith("image/"),
  }
}

test("accepts a single small image", () => {
  const result = validateAttachments([makeFile("a.png", 100)], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.accepted).toHaveLength(1)
  expect(result.rejected).toHaveLength(0)
  expect(result.accepted[0]?.isImage).toBe(true)
})

test("rejects a file over per-file cap", () => {
  const big = makeFile("big.png", DEFAULT_ATTACHMENT_LIMITS.maxFileBytes + 1)
  const result = validateAttachments([big], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.accepted).toHaveLength(0)
  expect(result.rejected).toEqual([{ filename: "big.png", reason: "too-large" }])
})

test("rejects when count would exceed maxCount", () => {
  const existing = Array.from({ length: 5 }, () => makeExisting(10))
  const result = validateAttachments(
    [makeFile("new.png", 10)],
    existing,
    DEFAULT_ATTACHMENT_LIMITS,
  )
  expect(result.accepted).toHaveLength(0)
  expect(result.rejected).toEqual([{ filename: "new.png", reason: "count-exceeded" }])
})

test("rejects when total bytes would exceed maxTotalBytes", () => {
  const existing = [makeExisting(20 * 1024 * 1024)]
  const result = validateAttachments(
    [makeFile("a.png", 10 * 1024 * 1024)],
    existing,
    DEFAULT_ATTACHMENT_LIMITS,
  )
  expect(result.accepted).toHaveLength(0)
  expect(result.rejected).toEqual([{ filename: "a.png", reason: "total-exceeded" }])
})

test("rejects denylisted mime", () => {
  const exe = makeFile("evil.exe", 100, "application/x-msdownload")
  const result = validateAttachments([exe], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.rejected).toEqual([{ filename: "evil.exe", reason: "denied-mime" }])
})

test("rejects denylisted extension even if mime is benign", () => {
  const fake = makeFile("script.sh", 100, "text/plain")
  const result = validateAttachments([fake], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.rejected).toEqual([{ filename: "script.sh", reason: "denied-mime" }])
})

test("accumulates errors instead of bailing on first", () => {
  const ok = makeFile("ok.png", 100)
  const big = makeFile("big.png", DEFAULT_ATTACHMENT_LIMITS.maxFileBytes + 1)
  const evil = makeFile("evil.exe", 100, "application/x-msdownload")
  const result = validateAttachments([ok, big, evil], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.accepted).toHaveLength(1)
  expect(result.accepted[0]?.filename).toBe("ok.png")
  expect(result.rejected).toEqual([
    { filename: "big.png", reason: "too-large" },
    { filename: "evil.exe", reason: "denied-mime" },
  ])
})

test("count check considers files added earlier in the same batch", () => {
  const existing = [makeExisting(10), makeExisting(10), makeExisting(10), makeExisting(10)]
  const a = makeFile("a.png", 10)
  const b = makeFile("b.png", 10)
  const result = validateAttachments([a, b], existing, DEFAULT_ATTACHMENT_LIMITS)
  expect(result.accepted).toHaveLength(1)
  expect(result.rejected).toEqual([{ filename: "b.png", reason: "count-exceeded" }])
})

test("zero-byte file is rejected as unreadable", () => {
  const empty = makeFile("empty.png", 0)
  const result = validateAttachments([empty], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.rejected).toEqual([{ filename: "empty.png", reason: "unreadable" }])
})

test("missing mime defaults to application/octet-stream", () => {
  const blob = new Blob([new Uint8Array(100)])
  const file = new File([blob], "data.bin")
  const result = validateAttachments([file], [], DEFAULT_ATTACHMENT_LIMITS)
  expect(result.accepted[0]?.mime).toBe("application/octet-stream")
})
```

- [ ] **Step 2: Run the test to verify it fails.**

```
bun test packages/sdk-utils/src/attachments/validate.test.ts
```

Expected: FAIL — module `./validate` not found.

- [ ] **Step 3: Implement `packages/sdk-utils/src/attachments/validate.ts`.**

```ts
import {
  DENIED_FILENAME_EXTENSIONS,
  DENIED_MIME_PREFIXES,
  type Attachment,
  type AttachmentLimits,
} from "./types"

export type ValidationFailureReason =
  | "too-large"
  | "denied-mime"
  | "count-exceeded"
  | "total-exceeded"
  | "unreadable"

export interface ValidationFailure {
  filename: string
  reason: ValidationFailureReason
}

export interface ValidationResult {
  accepted: Attachment[]
  rejected: ValidationFailure[]
}

function isDenied(filename: string, mime: string): boolean {
  if (DENIED_MIME_PREFIXES.some((p) => mime === p || mime.startsWith(`${p}/`))) return true
  const lower = filename.toLowerCase()
  return DENIED_FILENAME_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function validateAttachments(
  candidates: File[],
  existing: Attachment[],
  limits: AttachmentLimits,
): ValidationResult {
  const accepted: Attachment[] = []
  const rejected: ValidationFailure[] = []

  let runningCount = existing.length
  let runningTotal = existing.reduce((n, a) => n + a.size, 0)

  for (const file of candidates) {
    const filename = file.name
    const mime = file.type || "application/octet-stream"

    if (file.size === 0) {
      rejected.push({ filename, reason: "unreadable" })
      continue
    }
    if (isDenied(filename, mime)) {
      rejected.push({ filename, reason: "denied-mime" })
      continue
    }
    if (file.size > limits.maxFileBytes) {
      rejected.push({ filename, reason: "too-large" })
      continue
    }
    if (runningCount + 1 > limits.maxCount) {
      rejected.push({ filename, reason: "count-exceeded" })
      continue
    }
    if (runningTotal + file.size > limits.maxTotalBytes) {
      rejected.push({ filename, reason: "total-exceeded" })
      continue
    }

    accepted.push({
      id: newId(),
      blob: file,
      filename,
      mime,
      size: file.size,
      isImage: mime.startsWith("image/"),
    })
    runningCount += 1
    runningTotal += file.size
  }

  return { accepted, rejected }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```
bun test packages/sdk-utils/src/attachments/
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Re-export from the package index.**

Modify `packages/sdk-utils/src/index.ts` — add a line for attachments:

```ts
export * from "./ring-buffer"
export * from "./redact"
export * from "./breadcrumbs"
export * from "./annotation"
export * from "./theme"
export * from "./attachments"
```

- [ ] **Step 6: Verify the package re-exports compile.**

```
cd packages/sdk-utils && bun build src/index.ts --target=node > /dev/null && cd ../..
```

Expected: no output (build success).

- [ ] **Step 7: Commit Tasks 2 + 3 together.**

```bash
git add packages/sdk-utils/src/attachments packages/sdk-utils/src/index.ts
git commit -m "feat(sdk-utils): add Attachment shape and validateAttachments helper"
```

---

## Phase 2 — Web wizard restructure (no attachments yet)

This phase moves `packages/ui` to the new shared controls + 3-step structure with the flame/mist palette, but does **not** add attachments. That isolation lets us catch any visual regression before mixing it with feature work.

### Task 4: Add `theme-css.ts` that emits CSS custom properties from tokens

**Files:**
- Create: `packages/ui/src/wizard/theme-css.ts`
- Create: `packages/ui/src/wizard/theme-css.test.ts`

- [ ] **Step 1: Write the failing test.**

`packages/ui/src/wizard/theme-css.test.ts`:

```ts
import { expect, test } from "bun:test"
import { tokens } from "@reprojs/sdk-utils"
import { themeToCssVars } from "./theme-css"

test("emits :host block with kebab-cased color custom properties", () => {
  const css = themeToCssVars(tokens)
  expect(css).toContain(":host {")
  expect(css).toContain("  --ft-color-primary: #ff9b51;")
  expect(css).toContain("  --ft-color-primary-pressed: #f27a1f;")
  expect(css).toContain("  --ft-color-text: #25343f;")
  expect(css).toContain("  --ft-color-bg: #ffffff;")
  expect(css.endsWith("}\n") || css.endsWith("}")).toBe(true)
})

test("emits radius custom properties with px units", () => {
  const css = themeToCssVars(tokens)
  expect(css).toContain("  --ft-radius-sm: 8px;")
  expect(css).toContain("  --ft-radius-md: 12px;")
  expect(css).toContain("  --ft-radius-pill: 999px;")
})

test("emits the hit target custom property", () => {
  const css = themeToCssVars(tokens)
  expect(css).toContain("  --ft-hit: 44px;")
})

test("output is deterministic — same input produces same output", () => {
  expect(themeToCssVars(tokens)).toBe(themeToCssVars(tokens))
})
```

- [ ] **Step 2: Run the test to verify it fails.**

```
bun test packages/ui/src/wizard/theme-css.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/ui/src/wizard/theme-css.ts`.**

```ts
import { tokens as defaultTokens, type Tokens } from "@reprojs/sdk-utils"

function kebab(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

/**
 * Render the token object as a `:host { … }` block of CSS custom properties.
 * The widget's stylesheet uses `var(--ft-color-*)` etc., which resolve at
 * runtime against whatever this function emits. Single source of truth lives
 * in @reprojs/sdk-utils — call sites pass the default `tokens` constant.
 */
export function themeToCssVars(theme: Tokens = defaultTokens): string {
  const lines: string[] = [":host {"]
  for (const [name, value] of Object.entries(theme.color)) {
    lines.push(`  --ft-color-${kebab(name)}: ${value};`)
  }
  for (const [name, value] of Object.entries(theme.radius)) {
    lines.push(`  --ft-radius-${name}: ${value}px;`)
  }
  lines.push(`  --ft-hit: ${theme.hit}px;`)
  lines.push("}")
  return lines.join("\n")
}
```

- [ ] **Step 4: Run the test.**

```
bun test packages/ui/src/wizard/theme-css.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit.**

```bash
git add packages/ui/src/wizard/theme-css.ts packages/ui/src/wizard/theme-css.test.ts
git commit -m "feat(ui): add themeToCssVars helper that emits flame/mist tokens as CSS vars"
```

---

### Task 5: Inject the theme vars into the shadow root at mount time

**Files:**
- Modify: `packages/ui/src/mount.ts`

- [ ] **Step 1: Update the import block in `packages/ui/src/mount.ts`.**

Change:
```ts
import { createShadowHost, injectStyles, unmountShadowHost } from "./shadow"
import cssText from "./styles-inline"
```

To:
```ts
import { createShadowHost, injectStyles, unmountShadowHost } from "./shadow"
import cssText from "./styles-inline"
import { themeToCssVars } from "./wizard/theme-css"
```

- [ ] **Step 2: Inject the theme block alongside the static stylesheet.**

In `packages/ui/src/mount.ts` find the `mount()` function. Replace this block:

```ts
  _root = createShadowHost()
  injectStyles(_root, cssText)
  _container = document.createElement("div")
  _root.appendChild(_container)
  render(h(App, null), _container)
```

With:

```ts
  _root = createShadowHost()
  injectStyles(_root, themeToCssVars())
  injectStyles(_root, cssText)
  _container = document.createElement("div")
  _root.appendChild(_container)
  render(h(App, null), _container)
```

(The theme block must come BEFORE `cssText` so cascade order has the vars defined when the static rules reference them.)

- [ ] **Step 3: Verify the demo still renders.**

```
cd packages/ui && bun run demo
```

Open the URL printed in stdout (typically `http://localhost:5173`). Click the launcher. The wizard should still appear, identical to before — at this point we've only injected the vars; the styles still use hex literals so nothing visible changes.

Stop the dev server with Ctrl+C.

- [ ] **Step 4: Commit.**

```bash
git add packages/ui/src/mount.ts
git commit -m "feat(ui): inject flame/mist CSS vars into shadow root at mount"
```

---

### Task 6: Switch `styles.css` from hex literals to CSS vars (no visual change)

**Files:**
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/src/styles-inline.ts` (regenerated)

This task is bookkeeping — every hex color in `styles.css` becomes a `var(--ft-*)` reference. Run the rebuild script after.

- [ ] **Step 1: Rewrite the file.**

Replace the entire contents of `packages/ui/src/styles.css` with:

```css
:host,
* {
  box-sizing: border-box;
}
.ft-launcher {
  position: fixed;
  width: 56px;
  height: 56px;
  border-radius: var(--ft-radius-pill);
  background: var(--ft-color-text);
  color: var(--ft-color-bg);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  z-index: 2147483640;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}
.ft-launcher:hover {
  background: color-mix(in oklch, var(--ft-color-text) 90%, black);
}
.ft-launcher.pos-bottom-right {
  right: 24px;
  bottom: 24px;
}
.ft-launcher.pos-bottom-left {
  left: 24px;
  bottom: 24px;
}
.ft-launcher.pos-top-right {
  right: 24px;
  top: 24px;
}
.ft-launcher.pos-top-left {
  left: 24px;
  top: 24px;
}

.ft-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2147483641;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}

/* === Wizard shell === */
.ft-wizard {
  position: fixed;
  inset: 0;
  z-index: 2147483641;
  background: var(--ft-color-bg);
  color: var(--ft-color-text);
  display: flex;
  flex-direction: column;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}
.ft-wizard-header {
  display: grid;
  grid-template-columns: 36px 1fr 36px;
  align-items: center;
  padding: 14px 20px 12px;
  background: var(--ft-color-bg);
  border-bottom: 1px solid var(--ft-color-border);
  gap: 8px;
}
.ft-wizard-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ft-color-primary);
  margin: 0 0 2px;
}
.ft-wizard-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--ft-color-text);
}
.ft-icon-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--ft-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ft-color-surface);
  border: 0;
  color: var(--ft-color-text-muted);
  cursor: pointer;
}
.ft-icon-btn:hover {
  background: var(--ft-color-surface-soft);
  color: var(--ft-color-text);
}

.ft-wizard-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.ft-wizard-annotate {
  background: var(--ft-color-surface-soft);
}

/* Details + Review share a centered column layout */
.ft-wizard-step {
  flex: 1;
  overflow: auto;
  padding: 24px;
}
.ft-wizard-step-inner {
  max-width: 520px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.ft-wizard-footer {
  background: var(--ft-color-bg);
  border-top: 1px solid var(--ft-color-border);
  padding: 14px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.ft-wizard-loading {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.75);
  color: var(--ft-color-bg);
  z-index: 2147483641;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}

/* === Buttons === */
.ft-btn-primary {
  background: var(--ft-color-primary);
  color: #ffffff;
  border: 0;
  border-radius: var(--ft-radius-md);
  padding: 14px 24px;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.2px;
  cursor: pointer;
  min-height: 44px;
  box-shadow:
    0 6px 14px -6px color-mix(in oklch, var(--ft-color-primary) 60%, transparent),
    0 0 0 1px color-mix(in oklch, var(--ft-color-primary) 30%, transparent);
}
.ft-btn-primary:hover:not(:disabled) {
  background: var(--ft-color-primary-pressed);
}
.ft-btn-primary:disabled {
  background: var(--ft-color-primary-disabled);
  box-shadow: none;
  cursor: not-allowed;
}
.ft-btn-secondary {
  background: transparent;
  color: var(--ft-color-text-muted);
  border: 0;
  border-radius: var(--ft-radius-md);
  padding: 14px 20px;
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  min-height: 44px;
}
.ft-btn-secondary:hover:not(:disabled) {
  color: var(--ft-color-text);
  background: var(--ft-color-surface);
}
.ft-btn-secondary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* === Step indicator === */
.ft-stepper {
  display: flex;
  align-items: flex-start;
  margin-top: 18px;
}
.ft-stepper-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 64px;
}
.ft-stepper-dot {
  width: 24px;
  height: 24px;
  border-radius: var(--ft-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ft-color-surface);
  color: var(--ft-color-text-faint);
  font-size: 11px;
  font-weight: 700;
}
.ft-stepper-dot.active,
.ft-stepper-dot.done {
  background: var(--ft-color-primary);
  color: #ffffff;
}
.ft-stepper-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--ft-color-text-faint);
  letter-spacing: 0.2px;
}
.ft-stepper-label.active {
  color: var(--ft-color-text);
  font-weight: 600;
}
.ft-stepper-label.done {
  color: var(--ft-color-text-muted);
}
.ft-stepper-bar {
  flex: 1;
  height: 2px;
  background: var(--ft-color-border);
  margin: 11px 6px 0;
  border-radius: 1px;
}
.ft-stepper-bar.done {
  background: var(--ft-color-primary);
}

/* === Field labels + inputs === */
.ft-field-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--ft-color-text);
}
.ft-field-label-optional {
  font-style: italic;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  font-size: 11px;
  color: var(--ft-color-text-faint);
}
.ft-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ft-field input,
.ft-field textarea {
  width: 100%;
  padding: 14px;
  background: var(--ft-color-surface-soft);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  font: inherit;
  font-size: 15px;
  color: var(--ft-color-text);
}
.ft-field textarea {
  min-height: 140px;
  resize: vertical;
}
.ft-field input:focus,
.ft-field textarea:focus {
  outline: none;
  border-color: var(--ft-color-primary);
}

/* === Review summary card === */
.ft-summary {
  background: var(--ft-color-surface-soft);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-lg);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ft-summary-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.3px;
  text-transform: uppercase;
  color: var(--ft-color-text-muted);
}
.ft-summary-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ft-summary-bullet {
  width: 5px;
  height: 5px;
  border-radius: var(--ft-radius-pill);
  background: var(--ft-color-primary);
}
.ft-summary-label {
  flex: 1;
  font-size: 14px;
  color: var(--ft-color-text);
}
.ft-summary-hint {
  font-size: 12px;
  color: var(--ft-color-text-muted);
  font-variant-numeric: tabular-nums;
}

/* === Inline messages === */
.ft-msg {
  font-size: 12px;
  margin-top: 8px;
}
.ft-msg.err {
  color: var(--ft-color-danger);
}
.ft-msg.ok {
  color: color-mix(in oklch, var(--ft-color-primary) 60%, var(--ft-color-text));
}
.ft-error-card {
  background: var(--ft-color-danger-soft);
  border: 1px solid var(--ft-color-danger-border);
  border-radius: var(--ft-radius-md);
  padding: 14px;
  color: var(--ft-color-danger);
  font-size: 14px;
}

/* === Tool picker === */
.ft-tool-picker {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}
.ft-tool-group {
  display: flex;
  gap: 4px;
  align-items: center;
}
.ft-tool {
  width: 36px;
  height: 36px;
  border: 1px solid var(--ft-color-border);
  background: var(--ft-color-bg);
  color: var(--ft-color-text);
  border-radius: var(--ft-radius-md);
  cursor: pointer;
  font-size: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ft-tool:hover {
  background: var(--ft-color-surface);
}
.ft-tool.active {
  background: var(--ft-color-text);
  color: var(--ft-color-bg);
  border-color: var(--ft-color-text);
}
.ft-tool[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}
.ft-swatch {
  width: 22px;
  height: 22px;
  border-radius: var(--ft-radius-pill);
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}
.ft-swatch.active {
  border-color: var(--ft-color-text);
  transform: scale(1.1);
}
.ft-stroke {
  background: var(--ft-color-bg);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  padding: 0 6px;
  height: 36px;
}
.ft-stroke-dot {
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  color: var(--ft-color-text-muted);
}
.ft-stroke-dot.active {
  color: var(--ft-color-text);
}

/* === Canvas container === */
.ft-canvas-container canvas {
  cursor: crosshair;
  touch-action: none;
}
.ft-text-input {
  box-sizing: border-box;
}
.ft-preview-full {
  max-width: 100%;
  max-height: 80vh;
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
}
```

- [ ] **Step 2: Regenerate the inline CSS export.**

```
bun run packages/ui/build-css.ts
```

This rewrites `packages/ui/src/styles-inline.ts` with the new CSS as a `String.raw` template.

- [ ] **Step 3: Open the demo and confirm the launcher + existing wizard still render.**

```
cd packages/ui && bun run demo
```

Open the URL. Click the launcher — the OS share-tab dialog should fire, after which the (still-2-step) wizard should appear. The launcher button should now be flame-orange-tinted; the wizard chrome should be on the lighter mist palette. Annotate + Describe steps still work (the existing components are not yet renamed). Stop the server.

- [ ] **Step 4: Commit.**

```bash
git add packages/ui/src/styles.css packages/ui/src/styles-inline.ts
git commit -m "refactor(ui): switch styles to CSS custom properties from sdk-utils tokens"
```

---

### Task 7: Add the shared control vocabulary (`controls.tsx`)

**Files:**
- Create: `packages/ui/src/wizard/controls.tsx`

These are Preact analogs of the Expo control set. Component prop names and shapes mirror Expo where possible.

- [ ] **Step 1: Create the file.**

`packages/ui/src/wizard/controls.tsx`:

```tsx
import { h, type ComponentChildren } from "preact"

interface PrimaryButtonProps {
  label: string
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
}

export function PrimaryButton({ label, onClick, disabled, loading }: PrimaryButtonProps) {
  return h(
    "button",
    {
      type: "button",
      class: "ft-btn-primary",
      onClick,
      disabled: disabled || loading,
    },
    loading ? "Sending…" : label,
  )
}

interface SecondaryButtonProps {
  label: string
  onClick?: () => void
  disabled?: boolean
}

export function SecondaryButton({ label, onClick, disabled }: SecondaryButtonProps) {
  return h(
    "button",
    { type: "button", class: "ft-btn-secondary", onClick, disabled },
    label,
  )
}

interface FieldLabelProps {
  label: string
  optional?: boolean
}

export function FieldLabel({ label, optional }: FieldLabelProps) {
  return h(
    "div",
    { class: "ft-field-label" },
    label,
    optional ? h("span", { class: "ft-field-label-optional" }, "optional") : null,
  )
}

interface StepIndicatorProps {
  steps: readonly string[]
  current: number
}

export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return h(
    "div",
    { class: "ft-stepper" },
    ...steps.flatMap((label, i) => {
      const active = i === current
      const done = i < current
      const dotClass = `ft-stepper-dot${active ? " active" : done ? " done" : ""}`
      const labelClass = `ft-stepper-label${active ? " active" : done ? " done" : ""}`
      const item = h(
        "div",
        { class: "ft-stepper-item", key: `item-${i}` },
        h("div", { class: dotClass }, String(i + 1)),
        h("div", { class: labelClass }, label),
      )
      if (i === steps.length - 1) return [item]
      const bar = h("div", {
        class: `ft-stepper-bar${done ? " done" : ""}`,
        key: `bar-${i}`,
      })
      return [item, bar]
    }),
  )
}

interface WizardHeaderProps {
  eyebrow: string
  title: string
  steps: readonly string[]
  current: number
  onClose: () => void
  leadingIcon?: ComponentChildren
}

export function WizardHeader({
  eyebrow,
  title,
  steps,
  current,
  onClose,
  leadingIcon,
}: WizardHeaderProps) {
  return h(
    "header",
    { class: "ft-wizard-header" },
    h("div", null, leadingIcon ?? null),
    h(
      "div",
      null,
      h("p", { class: "ft-wizard-eyebrow" }, eyebrow),
      h("h2", { class: "ft-wizard-title" }, title),
      h(StepIndicator, { steps, current }),
    ),
    h(
      "button",
      {
        type: "button",
        class: "ft-icon-btn",
        onClick: onClose,
        "aria-label": "Close",
      },
      "✕",
    ),
  )
}
```

- [ ] **Step 2: Confirm imports compile.**

```
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add packages/ui/src/wizard/controls.tsx
git commit -m "feat(ui): add PrimaryButton, SecondaryButton, FieldLabel, StepIndicator, WizardHeader"
```

---

### Task 8: Replace `step-describe.tsx` with `step-details.tsx` (no attachments yet)

**Files:**
- Create: `packages/ui/src/wizard/step-details.tsx`

- [ ] **Step 1: Write the failing test.**

`packages/ui/src/wizard/step-details.test.ts`:

```ts
/** @jsxImportSource preact */
import { describe, expect, test } from "bun:test"
import { render } from "preact"
import { Window } from "happy-dom"
import { StepDetails } from "./step-details"
import { h } from "preact"

function setupDom() {
  const win = new Window()
  // @ts-expect-error happy-dom Window has the DOM globals we need
  globalThis.document = win.document
  // @ts-expect-error
  globalThis.window = win
  // @ts-expect-error
  globalThis.HTMLElement = win.HTMLElement
  // @ts-expect-error
  globalThis.Event = win.Event
  return win
}

describe("StepDetails", () => {
  test("renders title + description fields with labels", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(
      h(StepDetails, {
        title: "",
        description: "",
        onTitleChange: () => {},
        onDescriptionChange: () => {},
      }),
      root as unknown as Element,
    )
    expect(root.textContent).toContain("Title")
    expect(root.textContent).toContain("Details")
    expect(root.querySelector("input[type='text']")).toBeTruthy()
    expect(root.querySelector("textarea")).toBeTruthy()
  })

  test("calls onTitleChange when input fires", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    let captured = ""
    render(
      h(StepDetails, {
        title: "",
        description: "",
        onTitleChange: (v: string) => {
          captured = v
        },
        onDescriptionChange: () => {},
      }),
      root as unknown as Element,
    )
    const input = root.querySelector("input[type='text']") as HTMLInputElement
    input.value = "hello"
    input.dispatchEvent(new win.Event("input", { bubbles: true }))
    expect(captured).toBe("hello")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

```
bun test packages/ui/src/wizard/step-details.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `step-details.tsx`.**

```tsx
import { h } from "preact"
import { FieldLabel } from "./controls"

interface Props {
  title: string
  description: string
  onTitleChange: (v: string) => void
  onDescriptionChange: (v: string) => void
}

export function StepDetails({
  title,
  description,
  onTitleChange,
  onDescriptionChange,
}: Props) {
  return h(
    "div",
    { class: "ft-wizard-body ft-wizard-step" },
    h(
      "div",
      { class: "ft-wizard-step-inner" },
      h(
        "div",
        { class: "ft-field" },
        h(FieldLabel, { label: "Title" }),
        h("input", {
          type: "text",
          value: title,
          maxLength: 120,
          placeholder: "What went wrong?",
          onInput: (e: Event) =>
            onTitleChange((e.target as HTMLInputElement).value),
        }),
      ),
      h(
        "div",
        { class: "ft-field" },
        h(FieldLabel, { label: "Details", optional: true }),
        h("textarea", {
          value: description,
          maxLength: 10000,
          rows: 6,
          placeholder: "Steps to reproduce, expected vs actual…",
          onInput: (e: Event) =>
            onDescriptionChange((e.target as HTMLTextAreaElement).value),
        }),
      ),
    ),
  )
}
```

- [ ] **Step 4: Run the test.**

```
bun test packages/ui/src/wizard/step-details.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit.**

```bash
git add packages/ui/src/wizard/step-details.tsx packages/ui/src/wizard/step-details.test.ts
git commit -m "feat(ui): add StepDetails (replaces step-describe in 3-step wizard)"
```

---

### Task 9: Add `step-review.tsx` with summary card

**Files:**
- Create: `packages/ui/src/wizard/step-review.tsx`
- Create: `packages/ui/src/wizard/step-review.test.ts`

- [ ] **Step 1: Write the failing test.**

`packages/ui/src/wizard/step-review.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { render } from "preact"
import { Window } from "happy-dom"
import { h } from "preact"
import { StepReview } from "./step-review"

function setupDom() {
  const win = new Window()
  // @ts-expect-error
  globalThis.document = win.document
  // @ts-expect-error
  globalThis.window = win
  return win
}

describe("StepReview", () => {
  test("renders the summary lines", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(
      h(StepReview, {
        summary: [
          { label: "Title & description" },
          { label: "Annotated screenshot" },
        ],
        error: null,
      }),
      root as unknown as Element,
    )
    expect(root.textContent).toContain("Included in this report")
    expect(root.textContent).toContain("Title & description")
    expect(root.textContent).toContain("Annotated screenshot")
  })

  test("renders an error card when error is present", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(
      h(StepReview, {
        summary: [{ label: "anything" }],
        error: "Something went wrong",
      }),
      root as unknown as Element,
    )
    expect(root.textContent).toContain("Something went wrong")
    expect(root.querySelector(".ft-error-card")).toBeTruthy()
  })

  test("renders a hint suffix when SummaryLine has hint", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(
      h(StepReview, {
        summary: [{ label: "Annotations", hint: "3" }],
        error: null,
      }),
      root as unknown as Element,
    )
    expect(root.textContent).toContain("3")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails.**

```
bun test packages/ui/src/wizard/step-review.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `step-review.tsx`.**

```tsx
import { h } from "preact"

export interface SummaryLine {
  label: string
  hint?: string
}

interface Props {
  summary: SummaryLine[]
  error: string | null
}

export function StepReview({ summary, error }: Props) {
  return h(
    "div",
    { class: "ft-wizard-body ft-wizard-step" },
    h(
      "div",
      { class: "ft-wizard-step-inner" },
      h(
        "div",
        { class: "ft-summary" },
        h("div", { class: "ft-summary-title" }, "Included in this report"),
        ...summary.map((line) =>
          h(
            "div",
            { class: "ft-summary-row", key: line.label },
            h("div", { class: "ft-summary-bullet" }),
            h("div", { class: "ft-summary-label" }, line.label),
            line.hint ? h("div", { class: "ft-summary-hint" }, line.hint) : null,
          ),
        ),
      ),
      error ? h("div", { class: "ft-error-card" }, error) : null,
    ),
  )
}
```

- [ ] **Step 4: Run the test.**

```
bun test packages/ui/src/wizard/step-review.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit.**

```bash
git add packages/ui/src/wizard/step-review.tsx packages/ui/src/wizard/step-review.test.ts
git commit -m "feat(ui): add StepReview with 'Included in this report' summary"
```

---

### Task 10: Restyle `step-annotate.tsx` to use the new header + control vocabulary

**Files:**
- Modify: `packages/ui/src/wizard/step-annotate.tsx`

- [ ] **Step 1: Replace the file with the new layout.**

Full new contents of `packages/ui/src/wizard/step-annotate.tsx`:

```tsx
import { h } from "preact"
import { useEffect } from "preact/hooks"
import { Canvas } from "../annotation/canvas"
import { flatten } from "../annotation/flatten"
import { DEFAULT_SHORTCUTS, registerShortcuts, type Action } from "../annotation/shortcuts"
import { clear, redo, shapes, tool, undo, viewport } from "../annotation/store"
import { ToolPicker } from "../annotation/tool-picker"
import type { Tool } from "@reprojs/sdk-utils"
import { fitTransform } from "../annotation/viewport"
import { PrimaryButton, SecondaryButton, WizardHeader } from "./controls"

interface Props {
  bg: HTMLImageElement
  steps: readonly string[]
  currentStep: number
  onSkip: () => void
  onNext: (annotatedBlob: Blob) => void
  onCancel: () => void
}

export function StepAnnotate({ bg, steps, currentStep, onSkip, onNext, onCancel }: Props) {
  useEffect(() => {
    const dispatch = (action: Action) => {
      switch (action) {
        case "tool.arrow":
        case "tool.rect":
        case "tool.pen":
        case "tool.highlight":
        case "tool.text":
          tool.value = action.split(".")[1] as Tool
          return
        case "undo":
          undo()
          return
        case "redo":
          redo()
          return
        case "clear":
          if (shapes.value.length > 0 && confirm("Clear all annotations?")) clear()
          return
        case "cancel.draft":
          return
        case "resetView": {
          const w = (bg as unknown as { naturalWidth?: number }).naturalWidth ?? bg.width
          const hh = (bg as unknown as { naturalHeight?: number }).naturalHeight ?? bg.height
          viewport.value = fitTransform(w, hh, window.innerWidth, window.innerHeight)
          return
        }
      }
    }
    const dispose = registerShortcuts(window, DEFAULT_SHORTCUTS, dispatch)
    return () => dispose()
  }, [bg])

  async function handleNext() {
    const blob = await flatten(bg, shapes.value)
    onNext(blob)
  }

  function handleClose() {
    if (shapes.value.length > 0 && !confirm("Discard annotations?")) return
    onCancel()
  }

  return h(
    "div",
    { class: "ft-wizard" },
    h(WizardHeader, {
      eyebrow: "Repro",
      title: "Report a bug",
      steps,
      current: currentStep,
      onClose: handleClose,
    }),
    h("div", { class: "ft-wizard-body ft-wizard-annotate" }, h(Canvas, { bg })),
    h(
      "footer",
      { class: "ft-wizard-footer" },
      h(ToolPicker, null),
      h(
        "div",
        { style: { display: "flex", gap: "8px" } },
        h(SecondaryButton, { label: "Skip", onClick: onSkip }),
        h(PrimaryButton, { label: "Continue", onClick: handleNext }),
      ),
    ),
  )
}
```

- [ ] **Step 2: Type-check.**

```
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: no errors. (Reporter still passes the old props — it's updated next task.)

- [ ] **Step 3: Don't commit yet.** This file's changes go with Task 11's reporter rewrite.

---

### Task 11: Rewrite `reporter.tsx` for the 3-step state machine

**Files:**
- Modify: `packages/ui/src/reporter.tsx`
- Delete: `packages/ui/src/wizard/step-describe.tsx`
- Delete: `packages/ui/src/wizard/step-annotate.test.ts` if existing assertions reference the old props (check first; preserve unrelated tests)

- [ ] **Step 1: Replace `packages/ui/src/reporter.tsx`.**

```tsx
import { h } from "preact"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import { reset, shapes } from "./annotation/store"
import { StepAnnotate } from "./wizard/step-annotate"
import { StepDetails } from "./wizard/step-details"
import { StepReview, type SummaryLine } from "./wizard/step-review"
import { PrimaryButton, SecondaryButton, WizardHeader } from "./wizard/controls"

export interface ReporterSubmitResult {
  ok: boolean
  message?: string
}

interface ReporterProps {
  onClose: () => void
  onCapture: () => Promise<Blob | null>
  onSubmit: (payload: {
    title: string
    description: string
    screenshot: Blob | null
    dwellMs: number
    honeypot: string
  }) => Promise<ReporterSubmitResult>
  openedAt: number
}

const STEPS = ["Annotate", "Details", "Review"] as const
type StepName = "annotate" | "details" | "review"
const STEP_INDEX: Record<StepName, number> = { annotate: 0, details: 1, review: 2 }

export function Reporter({ onClose, onCapture, onSubmit, openedAt }: ReporterProps) {
  const [bg, setBg] = useState<HTMLImageElement | null>(null)
  const [annotatedBlob, setAnnotatedBlob] = useState<Blob | null>(null)
  const [rawScreenshot, setRawScreenshot] = useState<Blob | null>(null)
  const [step, setStep] = useState<StepName>("annotate")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const hpRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let revoked = false
    let url: string | null = null
    const revokeOnce = () => {
      if (url) {
        URL.revokeObjectURL(url)
        url = null
      }
    }
    ;(async () => {
      const blob = await onCapture()
      if (!blob) {
        if (!revoked) onClose()
        return
      }
      setRawScreenshot(blob)
      url = URL.createObjectURL(blob)
      const img = new Image()
      img.addEventListener("load", () => {
        if (!revoked) setBg(img)
        revokeOnce()
      })
      img.addEventListener("error", revokeOnce)
      img.src = url
    })()
    return () => {
      revoked = true
      revokeOnce()
      reset()
    }
  }, [])

  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [])

  function handleNextFromAnnotate(blob: Blob) {
    setAnnotatedBlob(blob)
    setStep("details")
  }
  function handleSkipFromAnnotate() {
    setAnnotatedBlob(rawScreenshot)
    setStep("details")
  }
  function handleBack() {
    if (step === "review") setStep("details")
    else if (step === "details") setStep("annotate")
  }
  function handleContinueFromDetails() {
    setStep("review")
  }

  async function handleSend() {
    if (!title.trim() || submitting || success) return
    setSubmitting(true)
    setSubmitError(null)
    const res = await onSubmit({
      title: title.trim(),
      description: description.trim(),
      screenshot: annotatedBlob,
      dwellMs: Math.max(0, Math.round(performance.now() - openedAt)),
      honeypot: hpRef.current?.value ?? "",
    })
    setSubmitting(false)
    if (res.ok) {
      setSuccess(true)
      setTimeout(onClose, 1500)
    } else {
      setSubmitError(res.message ?? "Something went wrong.")
    }
  }

  const summary = useMemo<SummaryLine[]>(() => {
    const lines: SummaryLine[] = [{ label: "Title & description" }]
    if (annotatedBlob) {
      lines.push({
        label: shapes.value.length > 0 ? "Annotated screenshot" : "Screenshot",
        hint: shapes.value.length > 0 ? String(shapes.value.length) : undefined,
      })
    }
    lines.push({ label: "Console, network & breadcrumbs" })
    lines.push({ label: "Environment info" })
    return lines
  }, [annotatedBlob])

  if (!bg) {
    return h("div", { class: "ft-wizard-loading" }, "Capturing…")
  }

  if (step === "annotate") {
    return h(StepAnnotate, {
      bg,
      steps: STEPS,
      currentStep: STEP_INDEX.annotate,
      onSkip: handleSkipFromAnnotate,
      onNext: handleNextFromAnnotate,
      onCancel: onClose,
    })
  }

  // Shared shell for details + review
  const headerProps = {
    eyebrow: "Repro",
    title: "Report a bug",
    steps: STEPS,
    current: STEP_INDEX[step],
    onClose,
  }

  const body =
    step === "details"
      ? h(StepDetails, {
          title,
          description,
          onTitleChange: setTitle,
          onDescriptionChange: setDescription,
        })
      : h(StepReview, { summary, error: success ? null : submitError })

  const primary =
    step === "details"
      ? h(PrimaryButton, {
          label: "Continue",
          onClick: handleContinueFromDetails,
          disabled: !title.trim(),
        })
      : h(PrimaryButton, {
          label: success ? "Sent" : "Send report",
          onClick: handleSend,
          disabled: !title.trim() || success,
          loading: submitting,
        })

  return h(
    "div",
    { class: "ft-wizard" },
    h(WizardHeader, headerProps),
    body,
    h(
      "footer",
      { class: "ft-wizard-footer" },
      h(SecondaryButton, { label: "Back", onClick: handleBack, disabled: submitting }),
      // Hidden honeypot — keep position absolute; mounted always so spam bots
      // that fill `name=website` continue to be tarpitted server-side.
      h("input", {
        ref: hpRef,
        name: "website",
        type: "text",
        tabIndex: -1,
        autoComplete: "off",
        "aria-hidden": "true",
        style: {
          position: "absolute",
          left: "-9999px",
          top: "-9999px",
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
        },
      }),
      primary,
    ),
  )
}
```

- [ ] **Step 2: Delete the old `step-describe.tsx`.**

```bash
rm packages/ui/src/wizard/step-describe.tsx
```

- [ ] **Step 3: Update the existing `step-annotate.test.ts` if it asserts the old props.**

```
grep -n "onSkip\|currentStep\|steps:" packages/ui/src/wizard/step-annotate.test.ts
```

If the test passes a 2-step shape (without `steps`/`currentStep`), update those calls to pass `steps: ["Annotate", "Details", "Review"], currentStep: 0`. Run the test:

```
bun test packages/ui/src/wizard/step-annotate.test.ts
```

Expected: PASS.

- [ ] **Step 4: Type-check the whole package.**

```
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: no errors.

- [ ] **Step 5: Run all ui tests.**

```
bun test packages/ui/
```

Expected: PASS. (If `reporter.test.ts` exists and asserts the old 2-step state machine, update its assertions to expect `annotate → details → review`.)

- [ ] **Step 6: Demo walkthrough.**

```
cd packages/ui && bun run demo
```

Open the demo, click the launcher, walk through Annotate → Details → Review → Send. Confirm:
- Header shows "Repro" eyebrow + "Report a bug" + 3-step indicator with the correct dot active per step.
- Back button works between steps.
- Success state auto-closes after 1.5s.
- Cancel revokes object URLs (open DevTools, no warnings).

Stop the dev server.

- [ ] **Step 7: Commit Tasks 10 + 11 together.**

```bash
git add packages/ui/src/reporter.tsx packages/ui/src/wizard/step-annotate.tsx packages/ui/src/wizard/
git rm packages/ui/src/wizard/step-describe.tsx
git commit -m "feat(ui): replace 2-step wizard with annotate → details → review flow"
```

---

## Phase 3 — Backend: DB migration + intake server attachment parsing

### Task 12: Extend the `report_attachments` schema with a `filename` column and the new `user-file` kind

**Files:**
- Modify: `apps/dashboard/server/db/schema/reports.ts`
- Generated: `apps/dashboard/server/db/migrations/00XX_*.sql` and `meta/00XX_snapshot.json`

- [ ] **Step 1: Update the schema definition.**

In `apps/dashboard/server/db/schema/reports.ts`, replace the `reportAttachments` block:

```ts
export const reportAttachments = pgTable(
  "report_attachments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["screenshot", "annotated-screenshot", "replay", "logs", "user-file"],
    }).notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    filename: text("filename"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    kindCheck: check(
      "report_attachments_kind_check",
      sql`${table.kind} IN ('screenshot', 'annotated-screenshot', 'replay', 'logs', 'user-file')`,
    ),
    reportIdx: index("report_attachments_report_idx").on(table.reportId),
  }),
)
```

- [ ] **Step 2: Generate the migration.**

```
cd /Users/jiajingteoh/Documents/reprojs && bun run db:gen
```

Drizzle will emit `apps/dashboard/server/db/migrations/00XX_<funny-name>.sql` plus a `meta/00XX_snapshot.json`. Open the generated `.sql` file and confirm it contains:

```sql
ALTER TABLE "report_attachments" DROP CONSTRAINT IF EXISTS "report_attachments_kind_check";
ALTER TABLE "report_attachments" ADD COLUMN "filename" text;
ALTER TABLE "report_attachments" ADD CONSTRAINT "report_attachments_kind_check"
  CHECK ("kind" IN ('screenshot','annotated-screenshot','replay','logs','user-file'));
```

If the generated SQL is shaped differently (drizzle is occasionally chatty), edit the file to match — the key invariants are: drop old check, add nullable filename, add new check including `user-file`.

- [ ] **Step 3: Apply the migration locally.**

```
bun run db:migrate
```

Confirm via `psql` (or the existing Postgres client) that:

```
\d report_attachments
```

shows the `filename` column and the new check constraint.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/server/db/schema/reports.ts apps/dashboard/server/db/migrations/
git commit -m "feat(db): add report_attachments.filename and user-file kind"
```

---

### Task 13: Add the new env knobs for user-file size budgets

**Files:**
- Modify: `apps/dashboard/server/lib/env.ts`

- [ ] **Step 1: Locate the `Schema` block.**

Open `apps/dashboard/server/lib/env.ts` and find the `// Intake tuning` section.

- [ ] **Step 2: Add three knobs after `INTAKE_MAX_BYTES`.**

Insert these lines inside the `Schema = z.object({...})`, right after `INTAKE_MAX_BYTES: intString(5_242_880),`:

```ts
  INTAKE_USER_FILE_MAX_BYTES: intString(10 * 1024 * 1024),
  INTAKE_USER_FILES_TOTAL_MAX_BYTES: intString(25 * 1024 * 1024),
  INTAKE_USER_FILES_MAX_COUNT: intString(5),
```

- [ ] **Step 3: Type-check.**

```
cd apps/dashboard && bunx tsc --noEmit && cd ../..
```

Expected: no errors. (`env.INTAKE_USER_FILE_MAX_BYTES` etc. now type-check at every callsite.)

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/server/lib/env.ts
git commit -m "feat(env): add user-file intake size budgets"
```

---

### Task 14: Add filename sanitizer and partial-write rollback helpers

**Files:**
- Create: `apps/dashboard/server/lib/sanitize-filename.ts`
- Create: `apps/dashboard/server/lib/sanitize-filename.test.ts`
- Create: `apps/dashboard/server/lib/storage/rollback.ts`

- [ ] **Step 1: Write the failing sanitizer test.**

`apps/dashboard/server/lib/sanitize-filename.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { sanitizeFilename } from "./sanitize-filename"

describe("sanitizeFilename", () => {
  test("strips path separators", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("etcpasswd")
    expect(sanitizeFilename("a\\b\\c.png")).toBe("abc.png")
  })

  test("strips control bytes and NULs", () => {
    expect(sanitizeFilename("a bc.txt")).toBe("abc.txt")
  })

  test("truncates to 200 chars", () => {
    const long = "a".repeat(500) + ".png"
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(200)
  })

  test("returns fallback for empty input", () => {
    expect(sanitizeFilename("", 7)).toBe("attachment-7")
    expect(sanitizeFilename("///", 3)).toBe("attachment-3")
  })

  test("preserves unicode word characters", () => {
    expect(sanitizeFilename("rapport-é.png")).toBe("rapport-é.png")
  })
})
```

- [ ] **Step 2: Run to confirm failure.**

```
bun test apps/dashboard/server/lib/sanitize-filename.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the sanitizer.**

`apps/dashboard/server/lib/sanitize-filename.ts`:

```ts
const MAX_LEN = 200

/**
 * Make a user-supplied filename safe to put in a storage key. Strips path
 * separators (../, .\, /) and control bytes. Truncates to MAX_LEN. Returns
 * `attachment-${idx}` if nothing usable is left.
 */
export function sanitizeFilename(input: string, idx = 0): string {
  // eslint-disable-next-line no-control-regex
  let cleaned = input.replace(/[ -/\\]/g, "")
  if (cleaned.length > MAX_LEN) cleaned = cleaned.slice(0, MAX_LEN)
  if (cleaned.length === 0) return `attachment-${idx}`
  return cleaned
}
```

- [ ] **Step 4: Run the test.**

```
bun test apps/dashboard/server/lib/sanitize-filename.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Add the rollback helper.**

`apps/dashboard/server/lib/storage/rollback.ts`:

```ts
import type { StorageAdapter } from "."

/**
 * Best-effort delete of partially-written keys after a multi-write failure.
 * Each delete is awaited but errors are swallowed — orphaned blobs are
 * preferable to a half-failed report row, and the caller has already
 * decided to throw the original write error to the client.
 */
export async function rollbackPuts(storage: StorageAdapter, keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((key) =>
      storage.delete?.(key).catch((err) => {
        console.warn("[storage] rollback delete failed", { key, err: String(err) })
      }) ?? Promise.resolve(),
    ),
  )
}
```

(If `StorageAdapter` doesn't yet declare a `delete` method, search for the local-disk and S3 adapters and confirm they have one — the spec assumes blob storage adapters can delete. If the interface lacks it, add `delete(key: string): Promise<void>` to the adapter type and implement it in both adapters in this same step. For S3 use `DeleteObjectCommand` from `@aws-sdk/client-s3`; for local-disk use `Bun.file(path).unlink()` or `node:fs/promises.rm` per the existing pattern in that adapter.)

Run `bunx tsc --noEmit` from `apps/dashboard` to confirm the helper compiles. Fix any signature gaps.

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/server/lib/sanitize-filename.ts apps/dashboard/server/lib/sanitize-filename.test.ts apps/dashboard/server/lib/storage/
git commit -m "feat(server): add sanitizeFilename + rollbackPuts helpers"
```

---

### Task 15: Parse `attachment[N]` parts in the intake endpoint

**Files:**
- Modify: `apps/dashboard/server/api/intake/reports.ts`

- [ ] **Step 1: Add the imports + denylist constants near the top of the file.**

After the existing imports in `apps/dashboard/server/api/intake/reports.ts`, insert:

```ts
import { sanitizeFilename } from "../../lib/sanitize-filename"
import { rollbackPuts } from "../../lib/storage/rollback"

const DENIED_USER_FILE_MIMES = new Set([
  "application/x-msdownload",
  "application/x-sh",
  "text/x-shellscript",
  "application/x-executable",
])
const DENIED_USER_FILE_EXTS = [".exe", ".bat", ".cmd", ".com", ".scr", ".sh", ".ps1", ".vbs"]
```

- [ ] **Step 2: Find the existing screenshot/logs/replay storage block.**

Locate the `// P3: Call getStorage() once and fan out attachment writes with Promise.all.` comment and the surrounding code that writes `screenshot.png` and `logs.json`. We're going to add a new block that runs **after** that one but **before** the GitHub auto-create block.

- [ ] **Step 3: Insert the user-file parsing + persistence block.**

After the `await Promise.all(writes)` line that ends the existing screenshot/logs block, before `// Auto-create GitHub issue on intake when the toggle is on.`, add:

```ts
  // ── User-supplied additional attachments (kind = "user-file") ────────────
  // Multipart parts are named attachment[0], attachment[1], … so a single
  // report can carry multiple files without colliding on a fixed part name.
  const userParts = parts.flatMap((p) => {
    const m = p.name?.match(/^attachment\[(\d+)\]$/)
    if (!m || !p.data || p.data.length === 0) return []
    return [{ idx: Number(m[1]), part: p }]
  })

  if (userParts.length > 0) {
    if (userParts.length > env.INTAKE_USER_FILES_MAX_COUNT) {
      throw createError({
        statusCode: 413,
        statusMessage: `Too many attachments (max ${env.INTAKE_USER_FILES_MAX_COUNT})`,
      })
    }
    let totalUserBytes = 0
    for (const { part } of userParts) {
      if (part.data.length > env.INTAKE_USER_FILE_MAX_BYTES) {
        throw createError({ statusCode: 413, statusMessage: "Attachment too large" })
      }
      const mime = part.type ?? "application/octet-stream"
      const lower = (part.filename ?? "").toLowerCase()
      if (
        DENIED_USER_FILE_MIMES.has(mime) ||
        DENIED_USER_FILE_EXTS.some((ext) => lower.endsWith(ext))
      ) {
        throw createError({
          statusCode: 415,
          statusMessage: `Attachment type not allowed: ${part.filename ?? "unnamed"}`,
        })
      }
      totalUserBytes += part.data.length
    }
    if (totalUserBytes > env.INTAKE_USER_FILES_TOTAL_MAX_BYTES) {
      throw createError({ statusCode: 413, statusMessage: "Attachments exceed total budget" })
    }

    const storage = await getStorage()
    const writtenKeys: string[] = []
    try {
      await Promise.all(
        userParts.map(async ({ idx, part }) => {
          const safeName = sanitizeFilename(part.filename ?? "", idx)
          const mime = part.type ?? "application/octet-stream"
          const key = `${report.id}/user/${idx}-${safeName}`
          await storage.put(key, new Uint8Array(part.data), mime)
          writtenKeys.push(key)
          await db.insert(reportAttachments).values({
            reportId: report.id,
            kind: "user-file",
            storageKey: key,
            contentType: mime,
            sizeBytes: part.data.length,
            filename: safeName,
          })
        }),
      )
    } catch (err) {
      await rollbackPuts(storage, writtenKeys)
      throw err
    }
  }
```

- [ ] **Step 4: Type-check.**

```
cd apps/dashboard && bunx tsc --noEmit && cd ../..
```

Expected: no errors.

- [ ] **Step 5: Don't commit yet** — Task 16 adds the integration test that proves this code works end-to-end.

---

### Task 16: Integration test — intake accepts and persists user attachments

**Files:**
- Create: `apps/dashboard/tests/api/intake-attachments.test.ts`

- [ ] **Step 1: Write the test.**

`apps/dashboard/tests/api/intake-attachments.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import { reportAttachments, reports } from "../../server/db/schema"
import { apiFetch, seedProject, startNuxt, stopNuxt } from "../helpers"

describe("POST /api/intake/reports — user attachments", () => {
  beforeAll(startNuxt)
  afterAll(stopNuxt)

  async function postReportWithFiles(files: { name: string; type: string; bytes: Uint8Array }[]) {
    const project = await seedProject({ allowedOrigins: ["https://example.com"] })
    const form = new FormData()
    form.append(
      "report",
      JSON.stringify({
        projectKey: project.publicKey,
        title: "with files",
        description: "x",
        context: { source: "web", url: "https://example.com/page" },
        _dwellMs: 5000,
        _hp: "",
      }),
    )
    files.forEach((f, i) => {
      form.append(`attachment[${i}]`, new File([f.bytes], f.name, { type: f.type }))
    })
    const res = await apiFetch("/api/intake/reports", {
      method: "POST",
      headers: { origin: "https://example.com" },
      body: form,
    })
    return { res, project }
  }

  test("accepts up to 5 user files and persists them as kind='user-file'", async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      name: `file-${i}.png`,
      type: "image/png",
      bytes: new Uint8Array([i + 1, 2, 3, 4]),
    }))
    const { res } = await postReportWithFiles(files)
    expect(res.status).toBe(201)
    const body = await res.json()
    const rows = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, body.id))
    const userFiles = rows.filter((r) => r.kind === "user-file")
    expect(userFiles).toHaveLength(5)
    expect(userFiles.map((r) => r.filename).sort()).toEqual(
      ["file-0.png", "file-1.png", "file-2.png", "file-3.png", "file-4.png"],
    )
    expect(userFiles.every((r) => r.storageKey.includes("/user/"))).toBe(true)
  })

  test("rejects when more than 5 files are sent", async () => {
    const files = Array.from({ length: 6 }, (_, i) => ({
      name: `f${i}.png`,
      type: "image/png",
      bytes: new Uint8Array([1]),
    }))
    const { res } = await postReportWithFiles(files)
    expect(res.status).toBe(413)
  })

  test("rejects per-file > cap", async () => {
    const big = new Uint8Array(11 * 1024 * 1024)
    const { res } = await postReportWithFiles([{ name: "big.png", type: "image/png", bytes: big }])
    expect(res.status).toBe(413)
  })

  test("rejects denylisted mime", async () => {
    const { res } = await postReportWithFiles([
      { name: "evil.exe", type: "application/x-msdownload", bytes: new Uint8Array([1]) },
    ])
    expect(res.status).toBe(415)
  })

  test("sanitizes filenames", async () => {
    const { res } = await postReportWithFiles([
      { name: "../../etc/passwd", type: "text/plain", bytes: new Uint8Array([1, 2, 3]) },
    ])
    expect(res.status).toBe(201)
    const body = await res.json()
    const [row] = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, body.id))
    expect(row?.filename).toBe("etcpasswd")
    expect(row?.storageKey.endsWith("/user/0-etcpasswd")).toBe(true)
  })

  test("intake without attachment[N] parts behaves identically to today (regression guard)", async () => {
    const { res } = await postReportWithFiles([])
    expect(res.status).toBe(201)
    const body = await res.json()
    const rows = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, body.id))
    expect(rows.filter((r) => r.kind === "user-file")).toHaveLength(0)
  })
})
```

(`seedProject`, `startNuxt`, `stopNuxt`, `apiFetch` follow the conventions in the existing `apps/dashboard/tests/helpers.ts`. If `seedProject` doesn't accept `allowedOrigins`, follow the existing test patterns to set one — search `tests/api/intake.test.ts` for the canonical idiom.)

- [ ] **Step 2: Run the test.**

```
cd /Users/jiajingteoh/Documents/reprojs && bun test apps/dashboard/tests/api/intake-attachments.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 3: Re-run the existing intake test to confirm no regression.**

```
bun test apps/dashboard/tests/api/intake.test.ts
```

Expected: PASS — every existing test still green.

- [ ] **Step 4: Commit Tasks 15 + 16 together.**

```bash
git add apps/dashboard/server/api/intake/reports.ts apps/dashboard/tests/api/intake-attachments.test.ts
git commit -m "feat(intake): accept attachment[N] parts as user-file attachments"
```

---

## Phase 4 — Web SDK wiring (end-to-end happy path)

### Task 17: Add the `AttachmentList` component to the web widget

**Files:**
- Create: `packages/ui/src/wizard/attachment-list.tsx`
- Create: `packages/ui/src/wizard/attachment-list.test.ts`

The list owns the `<input type="file" multiple>` element, the chip/thumbnail rendering, and remove handling. It calls validation from sdk-utils on every picker change and surfaces rejected files inline.

- [ ] **Step 1: Add CSS for the list.**

Append to `packages/ui/src/styles.css`:

```css
.ft-attach {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ft-attach-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}
.ft-attach-item {
  position: relative;
  background: var(--ft-color-surface-soft);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--ft-color-text);
  word-break: break-word;
}
.ft-attach-thumb {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: var(--ft-radius-sm);
  background: var(--ft-color-surface);
}
.ft-attach-icon {
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: var(--ft-radius-sm);
  background: var(--ft-color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ft-color-text-muted);
  font-size: 22px;
}
.ft-attach-name {
  font-size: 12px;
  color: var(--ft-color-text);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ft-attach-meta {
  font-size: 11px;
  color: var(--ft-color-text-muted);
  font-variant-numeric: tabular-nums;
}
.ft-attach-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border-radius: var(--ft-radius-pill);
  background: var(--ft-color-bg);
  color: var(--ft-color-text-muted);
  border: 1px solid var(--ft-color-border);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ft-attach-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--ft-color-bg);
  border: 1px dashed var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  color: var(--ft-color-text-muted);
  font-size: 13px;
  cursor: pointer;
}
.ft-attach-add:hover:not(:disabled) {
  color: var(--ft-color-text);
  border-color: var(--ft-color-border-strong);
}
.ft-attach-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ft-attach-status {
  font-size: 12px;
  color: var(--ft-color-text-muted);
  font-variant-numeric: tabular-nums;
}
.ft-attach-error {
  font-size: 12px;
  color: var(--ft-color-danger);
}
```

- [ ] **Step 2: Regenerate inline CSS.**

```
bun run packages/ui/build-css.ts
```

- [ ] **Step 3: Write the failing component test.**

`packages/ui/src/wizard/attachment-list.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { render, h } from "preact"
import { Window } from "happy-dom"
import { AttachmentList } from "./attachment-list"
import { DEFAULT_ATTACHMENT_LIMITS, type Attachment } from "@reprojs/sdk-utils"

function setupDom() {
  const win = new Window()
  // @ts-expect-error
  globalThis.document = win.document
  // @ts-expect-error
  globalThis.window = win
  return win
}

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: overrides.id ?? "x",
    blob: new Blob([new Uint8Array(10)], { type: "image/png" }),
    filename: overrides.filename ?? "a.png",
    mime: "image/png",
    size: 10,
    isImage: true,
    ...overrides,
  }
}

describe("AttachmentList", () => {
  test("renders the add button when not at cap", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(
      h(AttachmentList, {
        attachments: [],
        limits: DEFAULT_ATTACHMENT_LIMITS,
        onAdd: () => {},
        onRemove: () => {},
      }),
      root as unknown as Element,
    )
    const addBtn = root.querySelector(".ft-attach-add") as HTMLButtonElement
    expect(addBtn).toBeTruthy()
    expect(addBtn.disabled).toBe(false)
  })

  test("disables the add button at maxCount", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    const five = Array.from({ length: 5 }, (_, i) => makeAttachment({ id: String(i) }))
    render(
      h(AttachmentList, {
        attachments: five,
        limits: DEFAULT_ATTACHMENT_LIMITS,
        onAdd: () => {},
        onRemove: () => {},
      }),
      root as unknown as Element,
    )
    const addBtn = root.querySelector(".ft-attach-add") as HTMLButtonElement
    expect(addBtn.disabled).toBe(true)
    expect(root.textContent).toContain("5 of 5")
  })

  test("calls onRemove with the attachment id", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    let removed: string | null = null
    render(
      h(AttachmentList, {
        attachments: [makeAttachment({ id: "abc" })],
        limits: DEFAULT_ATTACHMENT_LIMITS,
        onAdd: () => {},
        onRemove: (id: string) => {
          removed = id
        },
      }),
      root as unknown as Element,
    )
    const remove = root.querySelector(".ft-attach-remove") as HTMLButtonElement
    remove.click()
    expect(removed).toBe("abc")
  })

  test("renders a thumbnail for image attachments and a generic icon otherwise", () => {
    const win = setupDom()
    const root = win.document.createElement("div")
    win.document.body.appendChild(root as unknown as Node)
    render(
      h(AttachmentList, {
        attachments: [
          makeAttachment({ id: "img", filename: "a.png", isImage: true, previewUrl: "blob:x" }),
          makeAttachment({
            id: "doc",
            filename: "a.pdf",
            isImage: false,
            mime: "application/pdf",
          }),
        ],
        limits: DEFAULT_ATTACHMENT_LIMITS,
        onAdd: () => {},
        onRemove: () => {},
      }),
      root as unknown as Element,
    )
    expect(root.querySelectorAll(".ft-attach-thumb").length).toBe(1)
    expect(root.querySelectorAll(".ft-attach-icon").length).toBe(1)
  })
})
```

- [ ] **Step 4: Run to confirm failure.**

```
bun test packages/ui/src/wizard/attachment-list.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement `attachment-list.tsx`.**

```tsx
import { h } from "preact"
import { useEffect, useRef } from "preact/hooks"
import type { Attachment, AttachmentLimits } from "@reprojs/sdk-utils"

interface Props {
  attachments: Attachment[]
  limits: AttachmentLimits
  errors?: string[]
  onAdd: (files: File[]) => void
  onRemove: (id: string) => void
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentList({ attachments, limits, errors, onAdd, onRemove }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const totalBytes = attachments.reduce((n, a) => n + a.size, 0)
  const atCap = attachments.length >= limits.maxCount

  // Revoke object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const a of attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
    }
  }, [])

  function openPicker() {
    fileInputRef.current?.click()
  }

  function handleChange(e: Event) {
    const target = e.target as HTMLInputElement
    const files = target.files ? Array.from(target.files) : []
    if (files.length > 0) onAdd(files)
    // Reset so picking the same file twice fires change again.
    target.value = ""
  }

  return h(
    "div",
    { class: "ft-attach" },
    attachments.length > 0
      ? h(
          "div",
          { class: "ft-attach-grid" },
          ...attachments.map((a) =>
            h(
              "div",
              { class: "ft-attach-item", key: a.id },
              h(
                "button",
                {
                  type: "button",
                  class: "ft-attach-remove",
                  onClick: () => onRemove(a.id),
                  "aria-label": `Remove ${a.filename}`,
                },
                "✕",
              ),
              a.isImage && a.previewUrl
                ? h("img", { class: "ft-attach-thumb", src: a.previewUrl, alt: a.filename })
                : h("div", { class: "ft-attach-icon" }, "📄"),
              h("div", { class: "ft-attach-name", title: a.filename }, a.filename),
              h("div", { class: "ft-attach-meta" }, formatBytes(a.size)),
            ),
          ),
        )
      : null,
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
      h(
        "button",
        {
          type: "button",
          class: "ft-attach-add",
          disabled: atCap,
          onClick: openPicker,
        },
        atCap ? `${attachments.length} of ${limits.maxCount}` : "+ Add files",
      ),
      h(
        "div",
        { class: "ft-attach-status" },
        `${attachments.length} / ${limits.maxCount} · ${formatBytes(totalBytes)}`,
      ),
    ),
    h("input", {
      ref: fileInputRef,
      type: "file",
      multiple: true,
      style: { display: "none" },
      onChange: handleChange,
    }),
    errors && errors.length > 0
      ? h(
          "div",
          { class: "ft-attach-error" },
          ...errors.map((m) => h("div", { key: m }, m)),
        )
      : null,
  )
}
```

- [ ] **Step 6: Run the tests.**

```
bun test packages/ui/src/wizard/attachment-list.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Commit.**

```bash
git add packages/ui/src/wizard/attachment-list.tsx packages/ui/src/wizard/attachment-list.test.ts packages/ui/src/styles.css packages/ui/src/styles-inline.ts
git commit -m "feat(ui): add AttachmentList with hybrid thumbnail + chip rendering"
```

---

### Task 18: Wire `AttachmentList` into `step-details.tsx`

**Files:**
- Modify: `packages/ui/src/wizard/step-details.tsx`

- [ ] **Step 1: Replace the file.**

```tsx
import { h } from "preact"
import { FieldLabel } from "./controls"
import { AttachmentList } from "./attachment-list"
import {
  DEFAULT_ATTACHMENT_LIMITS,
  type Attachment,
  type AttachmentLimits,
} from "@reprojs/sdk-utils"

interface Props {
  title: string
  description: string
  attachments: Attachment[]
  attachmentErrors: string[]
  limits?: AttachmentLimits
  onTitleChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onAttachmentsAdd: (files: File[]) => void
  onAttachmentRemove: (id: string) => void
}

export function StepDetails({
  title,
  description,
  attachments,
  attachmentErrors,
  limits = DEFAULT_ATTACHMENT_LIMITS,
  onTitleChange,
  onDescriptionChange,
  onAttachmentsAdd,
  onAttachmentRemove,
}: Props) {
  return h(
    "div",
    { class: "ft-wizard-body ft-wizard-step" },
    h(
      "div",
      { class: "ft-wizard-step-inner" },
      h(
        "div",
        { class: "ft-field" },
        h(FieldLabel, { label: "Title" }),
        h("input", {
          type: "text",
          value: title,
          maxLength: 120,
          placeholder: "What went wrong?",
          onInput: (e: Event) =>
            onTitleChange((e.target as HTMLInputElement).value),
        }),
      ),
      h(
        "div",
        { class: "ft-field" },
        h(FieldLabel, { label: "Details", optional: true }),
        h("textarea", {
          value: description,
          maxLength: 10000,
          rows: 6,
          placeholder: "Steps to reproduce, expected vs actual…",
          onInput: (e: Event) =>
            onDescriptionChange((e.target as HTMLTextAreaElement).value),
        }),
      ),
      h(
        "div",
        { class: "ft-field" },
        h(FieldLabel, { label: "Attachments", optional: true }),
        h(AttachmentList, {
          attachments,
          limits,
          errors: attachmentErrors,
          onAdd: onAttachmentsAdd,
          onRemove: onAttachmentRemove,
        }),
      ),
    ),
  )
}
```

- [ ] **Step 2: Update `step-details.test.ts` to pass the new props.**

For each `h(StepDetails, {...})` call, add:

```ts
attachments: [],
attachmentErrors: [],
onAttachmentsAdd: () => {},
onAttachmentRemove: () => {},
```

Re-run:

```
bun test packages/ui/src/wizard/step-details.test.ts
```

Expected: PASS.

- [ ] **Step 3: Don't commit yet** — Task 19 wires the state through reporter.

---

### Task 19: Update `reporter.tsx` to manage attachment state and pass it through

**Files:**
- Modify: `packages/ui/src/reporter.tsx`

- [ ] **Step 1: Add attachment state to the component.**

Inside the `Reporter()` function body, after `const hpRef = useRef<HTMLInputElement>(null)`, add:

```ts
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([])
```

Add the import at the top of the file:

```ts
import {
  DEFAULT_ATTACHMENT_LIMITS,
  validateAttachments,
  type Attachment,
} from "@reprojs/sdk-utils"
```

- [ ] **Step 2: Add the add/remove handlers.**

After `function handleContinueFromDetails()`, add:

```ts
  function handleAttachmentsAdd(files: File[]) {
    const result = validateAttachments(files, attachments, DEFAULT_ATTACHMENT_LIMITS)
    if (result.accepted.length > 0) {
      const withPreviews = result.accepted.map((a) => ({
        ...a,
        previewUrl: a.isImage ? URL.createObjectURL(a.blob) : undefined,
      }))
      setAttachments((prev) => [...prev, ...withPreviews])
    }
    if (result.rejected.length > 0) {
      setAttachmentErrors(
        result.rejected.map(
          (r) =>
            `${r.filename}: ${
              r.reason === "too-large"
                ? "too large"
                : r.reason === "denied-mime"
                  ? "file type not allowed"
                  : r.reason === "count-exceeded"
                    ? "too many files (max 5)"
                    : r.reason === "total-exceeded"
                      ? "total budget exceeded"
                      : "couldn't read file"
            }`,
        ),
      )
    } else {
      setAttachmentErrors([])
    }
  }

  function handleAttachmentRemove(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }
```

- [ ] **Step 3: Update `handleSend` to thread attachments into `onSubmit`.**

The `onSubmit` callback accepts a fixed shape today. We need to add `attachments` to the payload. **First, update the prop type signature:**

```ts
interface ReporterProps {
  onClose: () => void
  onCapture: () => Promise<Blob | null>
  onSubmit: (payload: {
    title: string
    description: string
    screenshot: Blob | null
    attachments: Attachment[]
    dwellMs: number
    honeypot: string
  }) => Promise<ReporterSubmitResult>
  openedAt: number
}
```

Then update the `onSubmit` call inside `handleSend`:

```ts
    const res = await onSubmit({
      title: title.trim(),
      description: description.trim(),
      screenshot: annotatedBlob,
      attachments,
      dwellMs: Math.max(0, Math.round(performance.now() - openedAt)),
      honeypot: hpRef.current?.value ?? "",
    })
```

- [ ] **Step 4: Pass attachment state into `<StepDetails>`.**

Replace the `step === "details"` body branch with:

```ts
  const body =
    step === "details"
      ? h(StepDetails, {
          title,
          description,
          attachments,
          attachmentErrors,
          onTitleChange: setTitle,
          onDescriptionChange: setDescription,
          onAttachmentsAdd: handleAttachmentsAdd,
          onAttachmentRemove: handleAttachmentRemove,
        })
      : h(StepReview, { summary, error: success ? null : submitError })
```

- [ ] **Step 5: Update the summary lines so review shows attachment count.**

Replace the `summary` `useMemo`:

```ts
  const summary = useMemo<SummaryLine[]>(() => {
    const lines: SummaryLine[] = [{ label: "Title & description" }]
    if (annotatedBlob) {
      lines.push({
        label: shapes.value.length > 0 ? "Annotated screenshot" : "Screenshot",
        hint: shapes.value.length > 0 ? String(shapes.value.length) : undefined,
      })
    }
    lines.push({ label: "Console, network & breadcrumbs" })
    lines.push({ label: "Environment info" })
    if (attachments.length > 0) {
      lines.push({ label: "Additional attachments", hint: String(attachments.length) })
    }
    return lines
  }, [annotatedBlob, attachments.length])
```

- [ ] **Step 6: Cleanup attachments on unmount.**

In the existing `useEffect` cleanup that calls `revokeOnce(); reset()`, add:

```ts
      for (const a of attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
```

(Place this line right after `reset()`.)

Note: this needs `attachments` in the effect's closure. The cleanest fix is moving the cleanup logic to a separate `useEffect` that depends on `[attachments]`. Replace the original effect's `return () => { revoked = true; revokeOnce(); reset() }` with the simpler form, and add a new effect:

```ts
  useEffect(() => {
    return () => {
      for (const a of attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
    }
  }, [])
```

(Empty deps — runs only on unmount, captures the latest array via closure ref.)

Actually, since `attachments` is updated via `setAttachments`, the closure may be stale. Use a ref instead:

```ts
  const attachmentsRef = useRef<Attachment[]>([])
  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])
  useEffect(() => {
    return () => {
      for (const a of attachmentsRef.current) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
      }
    }
  }, [])
```

- [ ] **Step 7: Type-check.**

```
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: no errors. (`onSubmit` callsite shape changed — `mount.ts`/core will be updated next; the SDK demo currently in `packages/ui/demo` may also need to pass the new shape — fix it inline if so.)

- [ ] **Step 8: Don't commit yet** — Tasks 18 + 19 + 20 land together.

---

### Task 20: Update `mount.ts`'s `MountOptions` and `index.ts`'s exports to thread attachments

**Files:**
- Modify: `packages/ui/src/mount.ts`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Update `MountOptions.onSubmit` shape in `mount.ts`.**

Change the `onSubmit` signature inside `MountOptions`:

```ts
  onSubmit: (payload: {
    title: string
    description: string
    screenshot: Blob | null
    attachments: import("@reprojs/sdk-utils").Attachment[]
    dwellMs: number
    honeypot: string
  }) => Promise<ReporterSubmitResult>
```

(Or import `Attachment` at the top of the file and reference it directly — pick one.)

- [ ] **Step 2: Update the `_onSubmit` default.**

Change:

```ts
let _onSubmit: MountOptions["onSubmit"] = async () => ({
  ok: false,
  message: "not mounted",
})
```

(No change needed — default already returns the right shape since the param is unused.)

In `unmount()`, the assignment is the same shape — verify no compile error.

- [ ] **Step 3: Verify `packages/ui/src/index.ts` re-exports.**

It should already re-export `MountOptions` and `ReporterSubmitResult` — confirm. If `Attachment` isn't already exported from `@reprojs/sdk-utils`'s public API (it should be after Task 3), no changes needed here. Otherwise, add:

```ts
export type { Attachment, AttachmentLimits } from "@reprojs/sdk-utils"
```

- [ ] **Step 4: Type-check.**

```
cd packages/ui && bunx tsc --noEmit && cd ../..
```

Expected: no errors.

- [ ] **Step 5: Don't commit yet** — Task 21 finishes the wire-up in core.

---

### Task 21: Serialize attachments in `packages/core/src/intake-client.ts`

**Files:**
- Modify: `packages/core/src/intake-client.ts`

- [ ] **Step 1: Update `IntakeInput` to accept attachments.**

Add `Attachment` to the import block:

```ts
import type { Attachment } from "@reprojs/sdk-utils"
```

Add the field to `IntakeInput`:

```ts
export interface IntakeInput {
  title: string
  description: string
  context: ReportContext
  metadata?: Record<string, string | number | boolean>
  screenshot: Blob | null
  attachments?: Attachment[]
  logs?: LogsAttachment | null
  replayBytes?: Uint8Array | null
  dwellMs?: number
  honeypot?: string
}
```

- [ ] **Step 2: Append attachment parts to the FormData.**

Inside `postReport`, after the `replay` block but before the `try { const res = await fetch(...) }`, add:

```ts
  if (input.attachments && input.attachments.length > 0) {
    input.attachments.forEach((att, i) => {
      // Convert the Attachment.blob to a File so FormData preserves the
      // filename. (Setting the Blob with a filename argument also works,
      // but File is the canonical way and round-trips better in tests.)
      const file =
        att.blob instanceof File
          ? att.blob
          : new File([att.blob], att.filename, { type: att.mime })
      body.set(`attachment[${i}]`, file, att.filename)
    })
  }
```

- [ ] **Step 3: Add a unit test in `packages/core/src/intake-client.test.ts`.**

Either extend the existing `intake-client.test.ts` file (preferred — search for existing tests of `postReport`) or create one. Add the case:

```ts
import { expect, test } from "bun:test"
import { postReport } from "./intake-client"

test("postReport serializes attachments as attachment[N] parts", async () => {
  const calls: { url: string; body: FormData }[] = []
  const fakeFetch = async (input: string, init?: RequestInit) => {
    calls.push({ url: input, body: init?.body as FormData })
    return new Response(JSON.stringify({ id: "r1" }), { status: 201 })
  }
  ;(globalThis as { fetch: typeof fetch }).fetch = fakeFetch as unknown as typeof fetch

  const att = {
    id: "a",
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    filename: "foo.png",
    mime: "image/png",
    size: 3,
    isImage: true,
  }
  const result = await postReport(
    {
      endpoint: "https://example.com",
      projectKey: "pk",
      position: "bottom-right",
      launcher: true,
      replay: undefined,
    } as never,
    {
      title: "t",
      description: "",
      context: { source: "web" } as never,
      screenshot: null,
      attachments: [att],
    },
  )
  expect(result.ok).toBe(true)
  const body = calls[0]?.body
  expect(body?.has("attachment[0]")).toBe(true)
  const file = body?.get("attachment[0]") as File
  expect(file.name).toBe("foo.png")
  expect(file.type).toBe("image/png")
})

test("postReport without attachments produces a body without attachment[N] keys (regression guard)", async () => {
  const calls: { body: FormData }[] = []
  ;(globalThis as { fetch: typeof fetch }).fetch = (async (
    _input: string,
    init?: RequestInit,
  ) => {
    calls.push({ body: init?.body as FormData })
    return new Response(JSON.stringify({ id: "r1" }), { status: 201 })
  }) as unknown as typeof fetch
  await postReport(
    {
      endpoint: "https://example.com",
      projectKey: "pk",
      position: "bottom-right",
      launcher: true,
    } as never,
    {
      title: "t",
      description: "",
      context: { source: "web" } as never,
      screenshot: null,
    },
  )
  const body = calls[0]?.body
  for (const key of body?.keys() ?? []) expect(key).not.toMatch(/^attachment\[/)
})
```

(The `as never` casts are a tactical sidestep — the real `ResolvedConfig`/`ReportContext` shapes have many fields irrelevant to this test. If the existing tests in this file use a fixture builder, reuse it.)

- [ ] **Step 4: Run the test.**

```
bun test packages/core/src/intake-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Don't commit yet** — Task 22 wires it through `core/index.ts`.

---

### Task 22: Thread attachments through `core/index.ts`'s `onSubmit`

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Update the `mount({ onSubmit })` callback.**

Find the `onSubmit: async ({ title, description, screenshot, dwellMs, honeypot }) => {…}` block. Replace its destructuring and body with:

```ts
    onSubmit: async ({ title, description, screenshot, attachments, dwellMs, honeypot }) => {
      if (!_config || !_collectors) return { ok: false, message: "Not initialized" }
      const snap = _collectors.snapshotAll()
      const context = gatherContext(_reporter, _config.metadata, {
        systemInfo: snap.systemInfo,
        cookies: snap.cookies,
      })
      const pending = {
        title,
        description,
        context,
        logs: snap.logs,
        screenshot,
      }
      const final = _collectors.applyBeforeSend(pending)
      if (final === null) return { ok: false, message: "aborted by beforeSend" }
      const replay = await _collectors.flushReplay()
      const result = await postReport(_config, {
        title: final.title,
        description: final.description,
        context: final.context,
        metadata: _config.metadata,
        screenshot: final.screenshot,
        attachments,
        logs: final.logs,
        replayBytes: replay.bytes,
        dwellMs,
        honeypot,
      })
      if (result.ok && result.replayDisabled) {
        _collectors.markReplayDisabled()
      }
      return result.ok ? { ok: true } : { ok: false, message: result.message }
    },
```

- [ ] **Step 2: Type-check.**

```
cd packages/core && bunx tsc --noEmit && cd ../..
```

Expected: no errors.

- [ ] **Step 3: End-to-end demo verification.**

```
cd packages/ui && bun run demo
```

Open the demo. With the dashboard running locally at the default URL, click the launcher and walk:

1. Annotate (skip or scribble)
2. Details — type a title; click "+ Add files"; pick 2 files (one image, one PDF); confirm thumbnails + chips render; click "✕" on one and confirm it goes away
3. Review — confirm "Additional attachments" line appears with count "1"
4. Send report

Confirm in your local Postgres:

```sql
SELECT id, kind, filename, size_bytes FROM report_attachments
ORDER BY created_at DESC LIMIT 5;
```

You should see `kind='user-file'` rows with the original filenames.

- [ ] **Step 4: Commit Tasks 17–22 together.**

```bash
git add packages/ui/src/wizard/step-details.tsx packages/ui/src/reporter.tsx packages/ui/src/mount.ts packages/ui/src/index.ts packages/core/src/intake-client.ts packages/core/src/intake-client.test.ts packages/core/src/index.ts
git commit -m "feat(sdk-web): add user attachments end-to-end"
```

---

## Phase 5 — Dashboard render

### Task 23: Surface `filename` in `AttachmentDTO` + add `user-file` to the kind enum

**Files:**
- Modify: `packages/shared/src/reports.ts`
- Modify: `packages/shared/src/reports.test.ts` (extend)

- [ ] **Step 1: Update `AttachmentKind`.**

In `packages/shared/src/reports.ts`, find `AttachmentKind` and update:

```ts
export const AttachmentKind = z.enum([
  "screenshot",
  "annotated-screenshot",
  "replay",
  "logs",
  "user-file",
])
export type AttachmentKind = z.infer<typeof AttachmentKind>
```

- [ ] **Step 2: Add `filename` to `AttachmentDTO`.**

```ts
export const AttachmentDTO = z.object({
  // …existing fields…
  filename: z.string().nullable(),
})
export type AttachmentDTO = z.infer<typeof AttachmentDTO>
```

(Look at the existing AttachmentDTO definition first — `filename` should be added next to `kind`/`url`/`contentType`/`sizeBytes`. Match indent style.)

- [ ] **Step 3: Add a contract test.**

Append to `packages/shared/src/reports.test.ts`:

```ts
import { test, expect } from "bun:test"
import { AttachmentDTO, AttachmentKind } from "./reports"

test("AttachmentKind accepts user-file", () => {
  expect(AttachmentKind.safeParse("user-file").success).toBe(true)
})

test("AttachmentDTO.filename is nullable string", () => {
  const ok = AttachmentDTO.safeParse({
    kind: "user-file",
    url: "https://x",
    contentType: "image/png",
    sizeBytes: 100,
    filename: "a.png",
  })
  expect(ok.success).toBe(true)
  const okNull = AttachmentDTO.safeParse({
    kind: "screenshot",
    url: "https://x",
    contentType: "image/png",
    sizeBytes: 100,
    filename: null,
  })
  expect(okNull.success).toBe(true)
})
```

(If the existing AttachmentDTO has additional required fields, include them too — adjust to match the actual shape.)

- [ ] **Step 4: Run shared tests.**

```
bun test packages/shared/src/reports.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/shared/src/reports.ts packages/shared/src/reports.test.ts
git commit -m "feat(shared): add user-file kind and filename field to AttachmentDTO"
```

---

### Task 24: Plumb `filename` through the dashboard's report-detail endpoint

**Files:**
- Modify: `apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.get.ts`

- [ ] **Step 1: Locate the attachment selection.**

Open the file and find the block that builds the `attachments` array — it `SELECT`s from `reportAttachments` and maps each row to an `AttachmentDTO`. The select likely includes `kind, storageKey, contentType, sizeBytes`.

- [ ] **Step 2: Add `filename` to the select and the DTO mapping.**

Add `filename: reportAttachments.filename` to the `db.select({ … })` object. Add `filename: row.filename ?? null` to the resulting DTO.

- [ ] **Step 3: Run the existing reports test to confirm it still passes.**

```
bun test apps/dashboard/tests/api/reports.test.ts
```

Expected: PASS. (If the test asserts an exact attachment shape, update it to include `filename: null` for legacy rows.)

- [ ] **Step 4: Add a focused test for user-file attachments.**

Append to `apps/dashboard/tests/api/reports.test.ts`:

```ts
test("GET /reports/:id includes user-file attachments with filename", async () => {
  const project = await seedProject({})
  const [report] = await db
    .insert(reports)
    .values({ projectId: project.id, title: "x", context: { source: "web" } })
    .returning()
  await db.insert(reportAttachments).values({
    reportId: report.id,
    kind: "user-file",
    storageKey: `${report.id}/user/0-foo.png`,
    contentType: "image/png",
    sizeBytes: 100,
    filename: "foo.png",
  })
  const cookie = await signIn("admin@example.com", { admin: true })
  const res = await apiFetch(`/api/projects/${project.id}/reports/${report.id}`, {
    headers: { cookie },
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  const userFile = body.attachments.find((a: { kind: string }) => a.kind === "user-file")
  expect(userFile?.filename).toBe("foo.png")
})
```

(Adapt to local helper names — e.g. `seedProject`, `signIn`, `apiFetch`. If your helpers differ, search a sibling test for the canonical idiom.)

Run:

```
bun test apps/dashboard/tests/api/reports.test.ts
```

Expected: PASS, including the new case.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/server/api/projects/ apps/dashboard/tests/api/reports.test.ts
git commit -m "feat(dashboard): include user-file filename in report detail response"
```

---

### Task 25: Build the `<AttachmentsTab>` Vue component

**Files:**
- Create: `apps/dashboard/app/components/report-drawer/attachments-tab.vue`

- [ ] **Step 1: Create the component.**

```vue
<script setup lang="ts">
import type { AttachmentDTO } from "@reprojs/shared"

const props = defineProps<{
  attachments: AttachmentDTO[]
}>()

const userFiles = computed(() =>
  props.attachments.filter((a) => a.kind === "user-file"),
)
const images = computed(() =>
  userFiles.value.filter((a) => a.contentType.startsWith("image/")),
)
const others = computed(() =>
  userFiles.value.filter((a) => !a.contentType.startsWith("image/")),
)

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function truncate(name: string, max = 40): string {
  if (name.length <= max) return name
  const head = name.slice(0, Math.floor(max / 2) - 1)
  const tail = name.slice(-Math.floor(max / 2))
  return `${head}…${tail}`
}
</script>

<template>
  <div class="space-y-6 p-4">
    <p
      v-if="userFiles.length === 0"
      class="text-sm text-mist-500 italic"
    >
      No additional attachments on this report.
    </p>

    <section v-if="images.length > 0" class="space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-mist-500">
        Images ({{ images.length }})
      </h3>
      <div class="grid grid-cols-3 gap-3">
        <a
          v-for="img in images"
          :key="img.url"
          :href="img.url"
          target="_blank"
          rel="noopener"
          class="block aspect-square overflow-hidden rounded-md border border-mist-200 bg-mist-50"
          :title="img.filename ?? ''"
        >
          <img
            :src="img.url"
            :alt="img.filename ?? 'attachment'"
            class="h-full w-full object-cover"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
        </a>
      </div>
    </section>

    <section v-if="others.length > 0" class="space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-mist-500">
        Files ({{ others.length }})
      </h3>
      <ul class="divide-y divide-mist-200 rounded-md border border-mist-200">
        <li
          v-for="file in others"
          :key="file.url"
          class="flex items-center gap-3 px-3 py-2.5"
        >
          <span class="text-mist-400">📄</span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm text-mist-900" :title="file.filename ?? ''">
              {{ truncate(file.filename ?? "(unnamed)") }}
            </div>
            <div class="text-xs tabular-nums text-mist-500">
              {{ file.contentType }} · {{ formatBytes(file.sizeBytes) }}
            </div>
          </div>
          <a
            :href="file.url"
            :download="file.filename ?? ''"
            class="text-xs font-medium text-flame-600 hover:text-flame-700"
          >
            Download
          </a>
        </li>
      </ul>
    </section>
  </div>
</template>
```

- [ ] **Step 2: Verify the component compiles.**

```
cd apps/dashboard && bunx vue-tsc --noEmit && cd ../..
```

(Or whichever type-check script the dashboard uses — `bun run check` may also work.)

Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/app/components/report-drawer/attachments-tab.vue
git commit -m "feat(dashboard): add AttachmentsTab for user-file attachments"
```

---

### Task 26: Wire `<AttachmentsTab>` into the report drawer + add overview chip

**Files:**
- Modify: `apps/dashboard/app/pages/projects/[id]/reports/[reportId].vue`
- Modify: `apps/dashboard/app/components/report-drawer/overview-tab.vue`

- [ ] **Step 1: Add a tab in the report drawer page.**

Open `apps/dashboard/app/pages/projects/[id]/reports/[reportId].vue` and find where existing tabs (Overview, Console, Network, Cookies, Activity) are registered. Add `Attachments` to the same list and route to `<AttachmentsTab :attachments="report.attachments" />`. Match the existing pattern — don't reinvent the tab system.

If the tab list is computed from a constant, add `"Attachments"` to that constant. If each tab is a `<Component v-if="active === ...">` branch, add a new branch.

Example of what the addition looks like (adapt to actual file structure):

```vue
<AttachmentsTab v-if="activeTab === 'attachments'" :attachments="report.attachments" />
```

Add the import to `<script setup>`:

```ts
import AttachmentsTab from "~/components/report-drawer/attachments-tab.vue"
```

- [ ] **Step 2: Add a chip on the Overview tab.**

In `apps/dashboard/app/components/report-drawer/overview-tab.vue`, find the existing rendering of report metadata. Add a small chip when user-files exist:

```vue
<button
  v-if="userFileCount > 0"
  type="button"
  class="inline-flex items-center gap-1.5 rounded-full bg-flame-50 px-2.5 py-1 text-xs font-medium text-flame-700"
  @click="$emit('navigate-tab', 'attachments')"
>
  <span>📎</span>
  {{ userFileCount }} additional {{ userFileCount === 1 ? "file" : "files" }}
</button>
```

In the `<script setup>`:

```ts
const props = defineProps<{ report: ReportDetail /* whatever the existing prop is */ }>()
defineEmits<{ "navigate-tab": [tab: string] }>()
const userFileCount = computed(
  () => (props.report.attachments ?? []).filter((a) => a.kind === "user-file").length,
)
```

(The parent page must listen to `@navigate-tab="activeTab = $event"`. Add that handler if needed.)

- [ ] **Step 3: Manually verify in dev.**

```
bun run dev
```

Open the dashboard, navigate to a report that has user-file attachments (one was created in the Phase 4 demo walkthrough). Confirm:
- The Attachments tab is visible and selectable.
- Image attachments render in a grid with thumbnails.
- File attachments render with name + size + Download.
- Overview shows the chip; clicking it switches to Attachments.

Stop the dev server.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/app/pages/projects/ apps/dashboard/app/components/report-drawer/overview-tab.vue
git commit -m "feat(dashboard): expose user-file attachments tab in report drawer"
```

---

## Phase 6 — Expo parity

### Task 27: Re-export theme tokens from `packages/expo`'s `theme.ts`

**Files:**
- Modify: `packages/expo/src/wizard/theme.ts`

- [ ] **Step 1: Replace the file's contents.**

```ts
/**
 * The wizard's color/radius/hit tokens. The values now live in
 * @reprojs/sdk-utils so the web SDK can render the same palette via CSS
 * custom properties. This file is a thin re-export so existing call sites
 * (`theme.color.primary` etc.) keep working.
 */
export { tokens as theme } from "@reprojs/sdk-utils"
export type { Tokens as Theme } from "@reprojs/sdk-utils"
```

- [ ] **Step 2: Type-check + run tests.**

```
cd packages/expo && bunx tsc --noEmit && cd ../..
bun test packages/expo/
```

Expected: no errors, all existing expo tests pass. (If a test imports `theme` and asserts a specific value, that should still hold — the values are byte-identical.)

- [ ] **Step 3: Commit.**

```bash
git add packages/expo/src/wizard/theme.ts
git commit -m "refactor(expo): re-export shared theme tokens from sdk-utils"
```

---

### Task 28: Add `expo-document-picker` dependency + capture wrapper

**Files:**
- Modify: `packages/expo/package.json`
- Create: `packages/expo/src/capture/file-picker.ts`
- Create: `packages/expo/src/capture/file-picker.test.ts`

- [ ] **Step 1: Add `expo-document-picker` as a peer dep.**

In `packages/expo/package.json`, find the `peerDependencies` block and add:

```json
"expo-document-picker": "*"
```

(If `peerDependenciesMeta` is used to mark optionals, mirror its pattern.)

Run:

```
bun install
```

- [ ] **Step 2: Write the failing test.**

`packages/expo/src/capture/file-picker.test.ts`:

```ts
import { describe, expect, mock, test } from "bun:test"

describe("pickFiles", () => {
  test("returns an array of File-shaped Attachments from a successful pick", async () => {
    mock.module("expo-document-picker", () => ({
      getDocumentAsync: async () => ({
        canceled: false,
        assets: [
          { uri: "file:///tmp/a.png", name: "a.png", mimeType: "image/png", size: 100 },
          { uri: "file:///tmp/b.pdf", name: "b.pdf", mimeType: "application/pdf", size: 200 },
        ],
      }),
    }))
    const { pickFiles } = await import("./file-picker")
    const out = await pickFiles({ multiple: true })
    expect(out).toHaveLength(2)
    expect(out[0]?.filename).toBe("a.png")
    expect(out[0]?.mime).toBe("image/png")
    expect(out[0]?.size).toBe(100)
    expect(out[0]?.isImage).toBe(true)
  })

  test("returns empty array when canceled", async () => {
    mock.module("expo-document-picker", () => ({
      getDocumentAsync: async () => ({ canceled: true }),
    }))
    // bun:test's mock.module persists across tests; force a fresh import
    delete (await import("./file-picker.ts")) as unknown as Record<string, unknown>
    const { pickFiles } = await import("./file-picker")
    const out = await pickFiles({ multiple: true })
    expect(out).toEqual([])
  })
})
```

(Note: bun's `mock.module` semantics across tests can be finicky. If the second test fails due to stale module state, split into two test files or use `vi.unmock`-equivalent. See repo's `nuxt4-vitest-fullstack-setup` skill for patterns.)

- [ ] **Step 3: Run to confirm failure.**

```
bun test packages/expo/src/capture/file-picker.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `file-picker.ts`.**

`packages/expo/src/capture/file-picker.ts`:

```ts
import type { Attachment } from "@reprojs/sdk-utils"

interface PickerAsset {
  uri: string
  name: string
  mimeType?: string
  size?: number
}

/**
 * Wraps expo-document-picker.getDocumentAsync. Returns an empty array on
 * cancel or when the picker module is unavailable. Each asset is converted
 * to a partial Attachment — the blob field is set to a placeholder Blob; the
 * intake-client will fetch(uri).blob() at submit time so we don't read every
 * file into memory the moment it's picked.
 */
export async function pickFiles({
  multiple = true,
}: { multiple?: boolean } = {}): Promise<Attachment[]> {
  let getDocumentAsync: ((opts: unknown) => Promise<unknown>) | undefined
  try {
    const mod = await import("expo-document-picker")
    getDocumentAsync = (mod as { getDocumentAsync: typeof getDocumentAsync }).getDocumentAsync
  } catch {
    return []
  }
  if (!getDocumentAsync) return []

  const result = (await getDocumentAsync({
    multiple,
    copyToCacheDirectory: true,
  })) as { canceled?: boolean; assets?: PickerAsset[] }

  if (result.canceled || !result.assets) return []

  return result.assets.map((asset, i) => {
    const mime = asset.mimeType ?? "application/octet-stream"
    return {
      id: `picker-${Date.now()}-${i}`,
      blob: new Blob([], { type: mime }), // Placeholder — see intake-client.
      filename: asset.name,
      mime,
      size: asset.size ?? 0,
      isImage: mime.startsWith("image/"),
      previewUrl: asset.uri,
    } satisfies Attachment
  })
}
```

- [ ] **Step 5: Run the test.**

```
bun test packages/expo/src/capture/file-picker.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit.**

```bash
git add packages/expo/package.json packages/expo/src/capture/file-picker.ts packages/expo/src/capture/file-picker.test.ts bun.lock
git commit -m "feat(expo): add pickFiles wrapper over expo-document-picker"
```

---

### Task 29: Add the React Native `AttachmentList` component

**Files:**
- Create: `packages/expo/src/wizard/attachment-list.tsx`

- [ ] **Step 1: Create the file.**

```tsx
import React from "react"
import { Image, Pressable, ScrollView, Text, View } from "react-native"
import type { Attachment, AttachmentLimits } from "@reprojs/sdk-utils"
import { theme } from "./theme"

interface Props {
  attachments: Attachment[]
  limits: AttachmentLimits
  errors?: string[]
  onAdd: () => void
  onRemove: (id: string) => void
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentList({ attachments, limits, errors, onAdd, onRemove }: Props) {
  const totalBytes = attachments.reduce((n, a) => n + a.size, 0)
  const atCap = attachments.length >= limits.maxCount

  return (
    <View style={{ gap: 12 }}>
      {attachments.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {attachments.map((a) => (
            <View
              key={a.id}
              style={{
                width: 110,
                gap: 6,
                backgroundColor: theme.color.surfaceSoft,
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: theme.color.border,
                padding: 8,
              }}
            >
              <View
                style={{
                  width: "100%",
                  aspectRatio: 4 / 3,
                  borderRadius: theme.radius.sm,
                  backgroundColor: theme.color.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {a.isImage && a.previewUrl ? (
                  <Image
                    source={{ uri: a.previewUrl }}
                    style={{ width: "100%", height: "100%" }}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={{ fontSize: 22, color: theme.color.textMuted }}>📄</Text>
                )}
              </View>
              <Text
                numberOfLines={1}
                style={{ fontSize: 12, fontWeight: "600", color: theme.color.text }}
              >
                {a.filename}
              </Text>
              <Text
                style={{
                  fontSize: 11,
                  color: theme.color.textMuted,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatBytes(a.size)}
              </Text>
              <Pressable
                onPress={() => onRemove(a.id)}
                hitSlop={8}
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 22,
                  height: 22,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.color.bg,
                  borderWidth: 1,
                  borderColor: theme.color.border,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                accessibilityLabel={`Remove ${a.filename}`}
              >
                <Text style={{ fontSize: 12, color: theme.color.textMuted }}>✕</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Pressable
          onPress={onAdd}
          disabled={atCap}
          style={({ pressed }) => ({
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: theme.color.border,
            backgroundColor: theme.color.bg,
            opacity: atCap ? 0.5 : pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ fontSize: 13, color: theme.color.textMuted }}>
            {atCap ? `${attachments.length} of ${limits.maxCount}` : "+ Add files"}
          </Text>
        </Pressable>
        <Text
          style={{
            fontSize: 12,
            color: theme.color.textMuted,
            fontVariant: ["tabular-nums"],
          }}
        >
          {`${attachments.length} / ${limits.maxCount} · ${formatBytes(totalBytes)}`}
        </Text>
      </View>

      {errors && errors.length > 0 && (
        <View style={{ gap: 4 }}>
          {errors.map((m) => (
            <Text key={m} style={{ fontSize: 12, color: theme.color.danger }}>
              {m}
            </Text>
          ))}
        </View>
      )}
    </View>
  )
}
```

- [ ] **Step 2: Type-check.**

```
cd packages/expo && bunx tsc --noEmit && cd ../..
```

Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add packages/expo/src/wizard/attachment-list.tsx
git commit -m "feat(expo): add AttachmentList for the mobile wizard"
```

---

### Task 30: Wire attachments into the Expo wizard's Details step

**Files:**
- Modify: `packages/expo/src/wizard/step-form.tsx`
- Modify: `packages/expo/src/wizard/sheet.tsx`

- [ ] **Step 1: Update `step-form.tsx`.**

Replace the file with:

```tsx
import React from "react"
import { ScrollView, TextInput, View } from "react-native"
import { FieldLabel, inputStyle } from "./controls"
import { AttachmentList } from "./attachment-list"
import { theme } from "./theme"
import {
  DEFAULT_ATTACHMENT_LIMITS,
  type Attachment,
  type AttachmentLimits,
} from "@reprojs/sdk-utils"

interface Props {
  title: string
  description: string
  attachments: Attachment[]
  attachmentErrors: string[]
  limits?: AttachmentLimits
  onTitleChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onAttachmentsAdd: () => void
  onAttachmentRemove: (id: string) => void
}

export function StepForm({
  title,
  description,
  attachments,
  attachmentErrors,
  limits = DEFAULT_ATTACHMENT_LIMITS,
  onTitleChange,
  onDescriptionChange,
  onAttachmentsAdd,
  onAttachmentRemove,
}: Props) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 20 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <View style={{ gap: 8 }}>
        <FieldLabel label="Title" />
        <TextInput
          value={title}
          onChangeText={onTitleChange}
          placeholder="What went wrong?"
          placeholderTextColor={theme.color.textFaint}
          maxLength={120}
          returnKeyType="next"
          style={inputStyle}
        />
      </View>
      <View style={{ gap: 8 }}>
        <FieldLabel label="Details" optional />
        <TextInput
          value={description}
          onChangeText={onDescriptionChange}
          placeholder="Steps to reproduce, expected vs actual…"
          placeholderTextColor={theme.color.textFaint}
          multiline
          maxLength={10000}
          style={[inputStyle, { minHeight: 140, textAlignVertical: "top" }]}
        />
      </View>
      <View style={{ gap: 8 }}>
        <FieldLabel label="Attachments" optional />
        <AttachmentList
          attachments={attachments}
          limits={limits}
          errors={attachmentErrors}
          onAdd={onAttachmentsAdd}
          onRemove={onAttachmentRemove}
        />
      </View>
    </ScrollView>
  )
}
```

- [ ] **Step 2: Update `sheet.tsx` to manage attachment state.**

In `packages/expo/src/wizard/sheet.tsx`:

1. Add imports:
   ```ts
   import { pickFiles } from "../capture/file-picker"
   import {
     DEFAULT_ATTACHMENT_LIMITS,
     validateAttachments,
     type Attachment,
   } from "@reprojs/sdk-utils"
   ```

2. Update `WizardArgs.onSubmit` signature to include `attachments`:
   ```ts
   onSubmit: (result: {
     title: string
     description: string
     annotatedUri: string | null
     rawUri: string | null
     attachments: Attachment[]
   }) => Promise<void>
   ```

3. Inside `WizardSheet({...})`, add state:
   ```ts
   const [attachments, setAttachments] = useState<Attachment[]>([])
   const [attachmentErrors, setAttachmentErrors] = useState<string[]>([])
   ```

4. Add handlers:
   ```ts
   async function handleAttachmentsAdd() {
     const picked = await pickFiles({ multiple: true })
     if (picked.length === 0) return
     // Convert picker output → File[] for validateAttachments. Each picked
     // Attachment already has size/mime/filename; we mirror them onto a stub
     // File so the validator's File contract type-checks.
     const asFiles: File[] = picked.map(
       (a) =>
         new File([new Uint8Array(0)], a.filename, { type: a.mime }) as unknown as File,
     )
     // Override sizes since picker already told us
     picked.forEach((p, i) => Object.defineProperty(asFiles[i]!, "size", { value: p.size }))
     const result = validateAttachments(asFiles, attachments, DEFAULT_ATTACHMENT_LIMITS)
     const accepted = result.accepted.map((a, i) => ({
       ...a,
       previewUrl: picked[i]?.previewUrl,
       blob: picked[i]?.blob ?? a.blob,
     }))
     setAttachments((prev) => [...prev, ...accepted])
     setAttachmentErrors(
       result.rejected.map((r) => `${r.filename}: ${r.reason.replace("-", " ")}`),
     )
   }
   function handleAttachmentRemove(id: string) {
     setAttachments((prev) => prev.filter((a) => a.id !== id))
   }
   ```

5. Update the `<StepForm ... />` usage to pass the new props:
   ```tsx
   <StepForm
     title={title}
     description={description}
     attachments={attachments}
     attachmentErrors={attachmentErrors}
     onTitleChange={setTitle}
     onDescriptionChange={setDescription}
     onAttachmentsAdd={handleAttachmentsAdd}
     onAttachmentRemove={handleAttachmentRemove}
   />
   ```

6. Update the summary in `useMemo` to include attachment count:
   ```ts
   const summary: SummaryLine[] = useMemo(() => {
     const lines: SummaryLine[] = []
     if (title.trim()) lines.push({ label: "Title & description" })
     if (screenshot) {
       lines.push({
         label: shapes.length > 0 ? "Annotated screenshot" : "Screenshot",
         hint: shapes.length > 0 ? String(shapes.length) : undefined,
       })
     }
     lines.push({ label: "Console, network & breadcrumbs" })
     lines.push({ label: "Device & environment info" })
     if (attachments.length > 0) {
       lines.push({ label: "Additional attachments", hint: String(attachments.length) })
     }
     return lines
   }, [title, screenshot, shapes.length, attachments.length])
   ```

7. Update `handleSubmit` to pass attachments through:
   ```ts
   await onSubmit({
     title,
     description,
     annotatedUri: annotated,
     rawUri: screenshot?.uri ?? null,
     attachments,
   })
   ```

- [ ] **Step 3: Type-check.**

```
cd packages/expo && bunx tsc --noEmit && cd ../..
```

Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add packages/expo/src/wizard/step-form.tsx packages/expo/src/wizard/sheet.tsx
git commit -m "feat(expo): add attachments to the wizard's Details step"
```

---

### Task 31: Extend Expo's intake-client + queue to carry user-files

**Files:**
- Modify: `packages/expo/src/queue/storage.ts`
- Modify: `packages/expo/src/intake-client.ts`
- Modify: `packages/expo/src/provider.tsx` (or wherever `onSubmit` is wired into the queue — search for the existing call)

- [ ] **Step 1: Allow `QueueItemAttachment` to carry a filename.**

In `packages/expo/src/queue/storage.ts`:

```ts
export interface QueueItemAttachment {
  kind: AttachmentKind
  uri: string
  bytes: number
  filename?: string
}
```

(`filename` is optional since legacy queue entries don't have it.)

- [ ] **Step 2: Update `intake-client.ts` to use indexed naming for `user-file`.**

Replace the `for (const a of attachments)` loop with:

```ts
let userFileIdx = 0
for (const a of attachments) {
  const part = { uri: a.uri, name: a.filename ?? `${a.kind}.bin`, type: a.contentType } as unknown as Blob
  if (a.kind === "user-file") {
    form.append(`attachment[${userFileIdx}]`, part)
    userFileIdx += 1
  } else {
    form.append(a.kind, part)
  }
}
```

- [ ] **Step 3: Convert wizard `Attachment[]` → `QueueItemAttachment[]` in the provider's submit handler.**

Find where the wizard's `onSubmit` callback is implemented (likely `provider.tsx` or `singleton.ts`). It currently builds a `QueueItemAttachment[]` from the screenshot + replay. Add user-files:

```ts
const queueAttachments: QueueItemAttachment[] = [
  // …existing screenshot / replay entries…
  ...result.attachments.map((a) => ({
    kind: "user-file" as const,
    uri: a.previewUrl ?? URL.createObjectURL(a.blob),
    bytes: a.size,
    filename: a.filename,
  })),
]
```

(Search `provider.tsx` for `kind: "screenshot"` to find the current builder.)

- [ ] **Step 4: Type-check.**

```
cd packages/expo && bunx tsc --noEmit && cd ../..
```

Expected: no errors.

- [ ] **Step 5: Run the existing intake-client test.**

```
bun test packages/expo/src/intake-client.test.ts
```

Expected: PASS. (If the test asserts the form keys explicitly, add a new case for user-files mirroring Task 21's web test.)

- [ ] **Step 6: Add a new test case.**

Append to `packages/expo/src/intake-client.test.ts`:

```ts
test("submits user-file attachments as attachment[N] parts", async () => {
  const calls: { body: FormData }[] = []
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    calls.push({ body: init?.body as FormData })
    return new Response(JSON.stringify({ id: "x" }), { status: 201 })
  }) as typeof fetch
  const client = createIntakeClient({ intakeUrl: "https://x", fetchImpl: fakeFetch })
  await client.submit({
    idempotencyKey: "k",
    input: { projectKey: "p", title: "t", context: { source: "expo" } } as never,
    attachments: [
      { kind: "user-file", uri: "file:///a.png", bytes: 10, contentType: "image/png", filename: "a.png" },
      { kind: "user-file", uri: "file:///b.pdf", bytes: 20, contentType: "application/pdf", filename: "b.pdf" },
    ],
  })
  const body = calls[0]?.body
  expect(body?.has("attachment[0]")).toBe(true)
  expect(body?.has("attachment[1]")).toBe(true)
})
```

Run:

```
bun test packages/expo/src/intake-client.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/expo/src/queue/storage.ts packages/expo/src/intake-client.ts packages/expo/src/intake-client.test.ts packages/expo/src/provider.tsx packages/expo/src/singleton.ts
git commit -m "feat(expo): submit user-file attachments as attachment[N] multipart parts"
```

---

## Closeout

### Task 32: Final whole-repo test sweep

- [ ] **Step 1: Run lint + format.**

```
bun run check
```

Expected: clean. (If your branch picked up unrelated lint fixes, leave them out of this commit — see the plan's TDD discipline.)

- [ ] **Step 2: Run all tests.**

```
bun test
```

Expected: PASS across all packages.

- [ ] **Step 3: End-to-end smoke against a fresh DB.**

```
bun run db:push
bun run dev:docker
bun run dev
```

In a separate terminal:

```
cd packages/ui && bun run demo
```

Walk the full flow: launcher → annotate → details (add 2 files: 1 image + 1 PDF) → review (confirm count chip) → send. Check the dashboard for the report; click Attachments tab; confirm both files render with download links. Repeat with the Expo demo if available.

Stop both servers.

- [ ] **Step 4: Cross-browser smoke (web only, manual).**

In Chrome, Firefox, and Safari (whichever you have installed), repeat the demo flow once each. File-input behavior can differ across vendors. Note any rendering oddities in a follow-up issue — they're not blocking.

- [ ] **Step 5: Final commit if needed.**

If anything turned up in steps 1–4, fix and commit; otherwise the plan is complete.

---

## Self-review notes

- All 32 tasks have explicit file paths, complete code blocks, and exact commands.
- Phase ordering matches the spec's risk sequencing: foundations → wizard restructure → backend → web wiring → dashboard render → Expo parity.
- `themeToCssVars`, `validateAttachments`, `sanitizeFilename`, `rollbackPuts` all have failing-test-first steps before implementation.
- Backward compatibility is preserved: the `filename` column is nullable, the new enum value is additive, the multipart parser ignores unknown parts (so old SDKs are unaffected and new SDKs against an old server silently drop attachments rather than error).
- The Expo intake-client carries a known footgun (RN's `FormData` doesn't accept Blobs). Task 31 leaves the existing kind-as-name approach for screenshots/replays/logs and only switches to `attachment[N]` for `user-file` items, which preserves the contract for everything else.
