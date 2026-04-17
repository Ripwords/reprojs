# Annotation Canvas — Design

**Sub-project:** C (third slice of the feedback-tool platform)
**Status:** Design approved, awaiting spec review
**Date:** 2026-04-17
**Depends on:** `v0.2.0-sdk` (sub-project B)

## 1. Purpose & Scope

Sub-project C adds annotation over the auto-captured screenshot and replaces the centered Reporter modal from B with a full-screen two-step wizard. End users can draw arrows, rectangles, highlights, freehand pen strokes, and text labels on the screenshot before filling the existing title/description form and submitting. Pointer Events unify mouse, touch, and stylus (Apple Pencil pressure drives variable pen stroke width).

**In scope:**
- Commit-on-release vector annotation model (no post-hoc selection/resize).
- Five tools: arrow, rectangle, pen, highlight, text.
- Fixed 5-swatch color palette (red / orange / yellow / green / blue) + discrete stroke widths (2/4/6/8 px).
- Undo / redo / clear with an in-memory vector stack.
- Fit-to-container canvas sizing with Cmd/Ctrl-scroll zoom (25–400%) and drag-to-pan (Space+drag or touch pinch).
- Two-step wizard replacing the existing Reporter: step 1 annotate, step 2 describe.
- Eager flatten on Next → PNG at the screenshot's native resolution, submitted via B's existing intake endpoint unchanged.
- Raw Canvas 2D rendering (no Konva / Fabric); Preact signals for reactive state.
- Pointer Events for unified mouse/touch/stylus input.
- Remappable keyboard shortcuts (single config map).

**Out of scope (deferred):**
- Shape selection / move / resize after commit (sub-project future).
- Separate vectors + screenshot on the wire (sub-project future — would let the dashboard re-render / re-annotate).
- Console / network / cookie collectors (D).
- 30-second session replay (E).
- Ticket inbox enhancements (F).
- GitHub sync (G).
- Mobile soft-keyboard quirks beyond iOS Safari (Android behavior is best-effort in v1).
- Visual-regression tests against reference PNGs (font-metric drift makes maintenance painful).

## 2. Decisions (from brainstorming)

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Commit-on-release + vector undo stack + raw Canvas 2D | Minimal deps; matches "quick feedback" ethos; keeps IIFE bundle lean |
| 2 | Tool set: arrow, rect, pen, text, highlight + fixed palette + 4 stroke widths | Covers ~95% of bug-report annotation; drops line (arrow subsumes); adds highlight (high real-world value) |
| 3 | Two-step wizard + full-screen overlay + Pointer Events for stylus | Gives canvas real room, natural linear flow, unified input handling |
| 4 | Fit-by-default + Cmd/Ctrl-scroll zoom + drag-to-pan | Power-user-friendly; fits-by-default means low friction for the common case |
| 5 | Text: drag a box, type in `<textarea>`, multi-line with manual word wrap on flatten | Richer than single-line prompt; wrap math is deterministic across display + flatten |
| 6 | Eager flatten on Next (not lazy on Send, not two-blob) | Simplest mental model; one blob goes over the wire; B's intake contract untouched |

Additional locked constraints:
- Keyboard shortcuts live in a single remappable map.
- Store annotations in screenshot-native (world) coordinates; apply pan/zoom as a render transform only.

## 3. Architecture

New directories marked ★.

```
packages/ui/src/
├── launcher.tsx                     (unchanged)
├── reporter.tsx                     ★ replaced — wizard shell
├── shadow.ts                        (unchanged)
├── mount.ts                         ★ small diff (pass annotatedBlob through)
├── styles.css                       ★ expanded for wizard + canvas + tool picker
├── index.ts                         (unchanged public surface)
│
├── wizard/                          ★ new
│   ├── step-annotate.tsx
│   ├── step-describe.tsx
│   └── step-annotate.test.ts
│
└── annotation/                      ★ new
    ├── types.ts
    ├── store.ts
    ├── shortcuts.ts
    ├── canvas.tsx
    ├── render.ts
    ├── flatten.ts
    ├── viewport.ts
    ├── text-wrap.ts
    ├── tool-picker.tsx
    ├── *.test.ts                    (per-module unit tests)
    └── tools/
        ├── index.ts
        ├── arrow.ts
        ├── pen.ts
        ├── rect.ts
        ├── highlight.ts
        ├── text.ts
        └── *.test.ts
```

**Invariants:**
1. Shapes stored exclusively in world coordinates (screenshot-native pixels).
2. `render(ctx, bg, shapes, transform)` is pure — used for both on-screen draw and flatten. Display + artifact can't diverge.
3. Display-only effects (pan, zoom, DPR) live in the transform, never in the shape data.

**No public API changes.** `packages/core`, `packages/shared`, dashboard, and `tsdown.config.ts` are untouched. The existing `mount(opts)` contract (`capture`, `onSubmit`) is preserved; the Reporter component internally decides when to call `capture` (once at step 1 open) and what to pass to `onSubmit` (the flattened blob at Send).

## 4. Data model

### 4.1 `Shape` union (`annotation/types.ts`)

```ts
export type Tool = "arrow" | "rect" | "pen" | "highlight" | "text"

export interface ShapeBase {
  id: string              // uuidv4 — identity for undo/redo
  color: string           // hex from 5-swatch palette
  strokeWidth: number     // 2 | 4 | 6 | 8
}

export type Shape =
  | (ShapeBase & { kind: "arrow";     x1: number; y1: number; x2: number; y2: number })
  | (ShapeBase & { kind: "rect";      x: number;  y: number;  w: number;  h: number })
  | (ShapeBase & { kind: "pen";       points: Array<{ x: number; y: number; p: number }> })
  | (ShapeBase & { kind: "highlight"; x: number;  y: number;  w: number;  h: number })
  | (ShapeBase & { kind: "text";      x: number;  y: number;  w: number;  h: number;
                                      content: string; fontSize: number })

export interface Transform {
  scale: number           // default 1 (fit-computed); 0.25 ≤ scale ≤ 4
  panX: number            // css pixels
  panY: number
}
```

### 4.2 State store (`annotation/store.ts`)

Preact signals at module scope. Canvas and UI components subscribe independently for fine-grained reactivity (no whole-wizard re-renders on pointer move).

```ts
import { signal, computed } from "@preact/signals"

export const shapes   = signal<Shape[]>([])
export const undone   = signal<Shape[]>([])
export const tool     = signal<Tool>("arrow")
export const color    = signal<string>("#e53935")
export const strokeW  = signal<number>(4)
export const viewport = signal<Transform>({ scale: 1, panX: 0, panY: 0 })
export const draft    = signal<Shape | null>(null)

export const canUndo = computed(() => shapes.value.length > 0)
export const canRedo = computed(() => undone.value.length > 0)

export function commit(s: Shape): void
export function undo(): void
export function redo(): void
export function clear(): void
export function reset(): void            // wipes everything; called on wizard close
```

## 5. Rendering pipeline

### 5.1 Pure renderer (`annotation/render.ts`)

```ts
export function render(
  ctx: CanvasRenderingContext2D,
  bg: HTMLImageElement | HTMLCanvasElement,
  shapes: Shape[],
  transform: Transform,
): void
```

Applies the transform, clears the canvas, draws the background image at world (0,0), then calls `drawShape(ctx, shape)` for each shape in order. Returns nothing; mutates the context.

The on-screen canvas redraws via `requestAnimationFrame` whenever any of `shapes`, `draft`, `viewport` changes. Multiple signal updates in one microtask batch into one frame.

### 5.2 Flatten (`annotation/flatten.ts`)

```ts
export async function flatten(
  bg: HTMLImageElement,
  shapes: Shape[],
): Promise<Blob>
```

Creates an offscreen `HTMLCanvasElement` at `bg.naturalWidth × bg.naturalHeight`, calls `render(ctx, bg, shapes, { scale: 1, panX: 0, panY: 0 })`, then `canvas.toBlob(_, "image/png")`. Fires on Next button click. The resulting blob is passed to `onSubmit` on step 2's Send.

### 5.3 HiDPI sharpness

On-screen canvas `width`/`height` attributes are set to `cssSize × devicePixelRatio`; context is pre-scaled by DPR. The viewport transform multiplies on top. Flatten target is at native pixels without DPR scaling (the raw screenshot already is).

## 6. Tools

### 6.1 `ToolHandler` interface

```ts
export interface ToolContext {
  worldX: number
  worldY: number
  pressure: number        // 0–1; 0.5 default for non-pen pointers
  color: string
  strokeWidth: number
  shape?: Shape           // in-progress draft (present on move/up)
}

export interface ToolHandler {
  onPointerDown(ctx: ToolContext): Shape
  onPointerMove(ctx: ToolContext): Shape
  onPointerUp(ctx: ToolContext): Shape | null
}
```

### 6.2 Per-tool notes

- **arrow.ts** — drag A→B. Draft updates `{x2, y2}` on move. Render: line + two ±30° arrowhead lines at (x2, y2). Commit on up.
- **rect.ts** — drag corner→corner. Normalize to positive w/h at commit. Render: `strokeRect`, no fill.
- **highlight.ts** — same geometry as rect; render with `globalCompositeOperation = "multiply"` and `globalAlpha = 0.4`. Stroke-width slider hidden when this tool is active (width = rect height).
- **pen.ts** — points downsampled during `onPointerMove` (skip if distance to previous ≤ 2 world-px). Variable stroke per segment: `strokeWidth × (0.5 + pressure × 0.5)`. Render: per-segment stroke.
- **text.ts** — handles only the drag-rect phase. The textarea-input phase is orchestrated by the canvas component, which positions a `<textarea>` over the rect, reads value on blur/Escape, then calls `wrapText(...)` + `commit({ kind: "text", ... })`. Stored `content` is the original user-typed string; wrap is reapplied at render time so zoom behavior stays consistent.

### 6.3 Text wrap (`annotation/text-wrap.ts`)

```ts
export function wrapText(
  ctx: CanvasRenderingContext2D,  // for measureText; caller sets font first
  text: string,
  maxWidth: number,
): string[]
```

Algorithm:
1. Split on `\n` → paragraphs.
2. Per paragraph, split on spaces → words.
3. Greedily append words to the current line; if `measureText(line + " " + word) > maxWidth`, push line and start a new one.
4. If a single word exceeds `maxWidth`, break it at character boundaries.
5. Preserve empty lines from consecutive `\n\n` in the source.

Render iterates `wrapText()` output and `fillText(line, x, y + i × lineHeight)` with `lineHeight = fontSize × 1.3`.

## 7. Input handling

### 7.1 Pointer Events

Single `pointerdown` listener on the canvas. `setPointerCapture(pointerId)` on down so drags off the canvas keep receiving events.

Input arbitration (in this order):
1. **Ignore** if `event.button === 1` (middle) or `=== 2` (right).
2. **Pan mode** if: Space key held, OR active tool is null, OR this is the second simultaneous touch pointer. → `startPan(e)`.
3. **Draw mode** otherwise. → look up `toolHandlers[tool.value]`, compute world coords, call `handler.onPointerDown(ctx)`, write result to `draft`.

`pointermove` / `pointerup` route based on `activePointerId` so secondary pointers don't hijack mid-draw.

### 7.2 Pan

Drag-pan updates `viewport.panX/panY` by the raw screen-pixel delta (the render transform handles world conversion). Clamped so at least 100 px of image remains on screen:
```
panX ∈ [-bgWidth × scale + 100, canvasWidth - 100]
panY ∈ [-bgHeight × scale + 100, canvasHeight - 100]
```

### 7.3 Zoom

Mouse/trackpad: `wheel` event with `event.ctrlKey || event.metaKey` (trackpad pinch fires with `ctrlKey`). Plain scroll without modifier is ignored — we don't hijack page scroll inside the wizard overlay either; the wizard itself doesn't scroll because the canvas fills its region.

```ts
function zoomAt(cx: number, cy: number, factor: number): void {
  const { scale, panX, panY } = viewport.value
  const nextScale = clamp(scale * factor, 0.25, 4)
  const worldX = (cx - panX) / scale
  const worldY = (cy - panY) / scale
  viewport.value = {
    scale: nextScale,
    panX: cx - worldX * nextScale,
    panY: cy - worldY * nextScale,
  }
}
```

Touch pinch-zoom: track two simultaneous pointers; reference distance at second `pointerdown`; on `pointermove`, `factor = currentDist / refDist`; apply `zoomAt(midpoint, factor)`.

### 7.4 Coordinate helpers (`viewport.ts`)

```ts
export function screenToWorld(
  screenX: number, screenY: number,
  canvasRect: DOMRect, t: Transform,
): { worldX: number; worldY: number }

export function isInsideImage(
  worldX: number, worldY: number,
  bgWidth: number, bgHeight: number,
): boolean

export function fitTransform(
  bgWidth: number, bgHeight: number,
  canvasWidth: number, canvasHeight: number,
): Transform
```

`fitTransform` runs on step-1 open to compute the initial fit-scale and center-pan. A "Reset view" mini-button in the top-right of the canvas re-applies it.

### 7.5 Shortcut map (`annotation/shortcuts.ts`)

Single remappable config. Consumers dispatch intents by name.

```ts
export type Action =
  | "tool.arrow" | "tool.rect" | "tool.pen" | "tool.highlight" | "tool.text"
  | "undo" | "redo" | "clear" | "cancel.draft" | "resetView"

export const DEFAULT_SHORTCUTS: Record<string, Action> = {
  "a":         "tool.arrow",
  "r":         "tool.rect",
  "p":         "tool.pen",
  "h":         "tool.highlight",
  "t":         "tool.text",
  "mod+z":     "undo",
  "mod+shift+z": "redo",
  "mod+y":     "redo",
  "backspace": "clear",
  "delete":    "clear",
  "escape":    "cancel.draft",
  "mod+0":     "resetView",
}

export function registerShortcuts(map: Record<string, Action>): () => void
```

`mod` = Meta on macOS, Ctrl elsewhere. The host page's shortcuts are preserved: listeners only fire when the wizard has focus. Returns a dispose function.

## 8. Wizard layout

### 8.1 Step 1 — Annotate (full-screen)

```
┌───────────────────────────────────────────────────────────┐
│ Report a bug                                       ✕      │
├───────────────────────────────────────────────────────────┤
│                                                            │
│                [ annotation canvas ]        [Reset view]   │
│                                                            │
├───────────────────────────────────────────────────────────┤
│ [↗][▢][✎][≡][T]  ●●●●●  ──●──  [↶][↷][🗑]   [Skip] [Next]│
└───────────────────────────────────────────────────────────┘
```

- Top bar: 48 px, title left, ✕ right.
- Canvas region: flex-grow, light gray background behind the letterbox.
- Tool picker row: 5 tool icons (A/R/P/H/T), 5-swatch palette, 4-dot stroke slider (hidden for highlight tool), undo, redo, clear. Right-aligned: Skip, Next.
- **Skip** — jumps to step 2 with empty shapes array. Flatten just returns the raw screenshot.
- **Next** — invokes `flatten(bg, shapes)`, stores the resulting Blob as `annotatedBlob`, transitions to step 2. Disabled while text input is focused.
- **✕** — if `shapes.length === 0`, close immediately. Otherwise inline confirm ("Discard annotations?").
- **< 900 px wide**: tool picker wraps onto a second row above the footer actions.

### 8.2 Step 2 — Describe

```
┌───────────────────────────────────────────────────────────┐
│ ← Back                                             ✕      │
├──────────────────────┬────────────────────────────────────┤
│                      │ Title                               │
│  [annotated preview] │ [_______________________________]   │
│  (click → open       │                                     │
│   full-size new tab) │ What happened?                      │
│                      │ [_______________________________]   │
│                      │ [_______________________________]   │
│                      │                                     │
│                      │             [Cancel]  [Send report] │
└──────────────────────┴────────────────────────────────────┘
```

- Left: `<img>` at fit-scale of the flattened PNG. Click opens in a new tab.
- Right: title (required, 1–120), description (optional, 0–10 000).
- **← Back**: returns to step 1 with vectors intact.
- **Cancel**: closes the wizard entirely (inline confirm if any shapes exist).
- **Send report**: calls `onSubmit({ title, description })`. `mount.ts` supplies `annotatedBlob` as the screenshot to the intake client. Shows "Thanks!" flash on success; error text inline on failure.
- **< 900 px wide**: stacks (preview above form).

### 8.3 Cross-step behaviors

- **Scroll lock**: `document.body.style.overflow = "hidden"` on wizard open; restored on close.
- **Focus trap**: initial focus on ✕; `Tab`/`Shift+Tab` cycles within the wizard; Escape routed per-step (cancel draft → close confirm).
- **Widget self-hiding**: `screenshot.ts` already hides the widget host during capture; unchanged.
- **Store lifecycle**: `reset()` on wizard close so a second open starts clean.

## 9. Mount diff (`mount.ts`)

Contract preserved: `mount(opts)` / `open()` / `close()` / `unmount()` unchanged. Internally, the new `<Wizard />` component:
1. On first open, calls `opts.capture()` once to get the raw screenshot Blob; converts to `HTMLImageElement` via `createImageBitmap` + `<canvas>` → Data URL, or directly `new Image(); img.src = URL.createObjectURL(blob)`.
2. On step 1 Next: runs `flatten(bg, shapes.value)` → stores `annotatedBlob`.
3. On step 2 Send: calls `opts.onSubmit({ title, description })`. The Wizard itself passes `annotatedBlob` through by monkey-patching the `capture` used by `postReport`, OR — cleaner — the Wizard accepts an additional `onSubmitWithScreenshot` callback from `mount` and `packages/core/src/index.ts` threads `annotatedBlob` through to `postReport`.

Clean path: widen `MountOptions.onSubmit`'s contract to accept a screenshot parameter, and let the Wizard supply it. `packages/core/src/index.ts`'s adapter updates accordingly. This is a minor API shift inside the SDK package boundary; no external consumer notices.

```ts
// packages/ui/src/mount.ts
export interface MountOptions {
  config: { position: "bottom-right"|"bottom-left"|"top-right"|"top-left"; launcher: boolean }
  capture: () => Promise<Blob | null>
  onSubmit: (payload: { title: string; description: string; screenshot: Blob | null }) => Promise<ReporterSubmitResult>
}
```

`packages/core/src/index.ts`'s `init()` passes an `onSubmit` that receives `{ title, description, screenshot }` (previously captured inside `onSubmit`; now supplied by the wizard after flatten). No public contract change for the SDK's `init()` / `open()` / `close()` / `identify()`.

## 10. Testing

### 10.1 Unit (bun test + happy-dom already a SDK devDep)

- `viewport.test.ts` — screen↔world mapping, `zoomAt` invariant ("point under cursor stays fixed"), `fitTransform` correctness, `isInsideImage` bounds.
- `store.test.ts` — commit, undo, redo, clear, new-action-clears-redo.
- `text-wrap.test.ts` — word boundary, long-word break, preserves `\n\n`.
- `render.test.ts` — assert expected pixels via in-memory `OffscreenCanvas` + `getImageData` for each shape kind.
- `flatten.test.ts` — roundtrip a fixed shape set on a 100×100 bg, assert output dimensions + pixel at known point.
- `tools/*.test.ts` — one per tool; assert pure `onPointerDown/Move/Up` behavior.
- `shortcuts.test.ts` — key-to-action lookup; mod-key normalization.

Target: 25–30 new tests.

### 10.2 Integration

- `wizard/step-annotate.test.ts` — render the step, dispatch synthetic `PointerEvent`s, assert shape committed to the store. One test per tool (5 tests). Assert undo/redo updates the store.

### 10.3 Smoke (manual — §11)

Laptop Chrome + iPad Safari with Apple Pencil. Visual pixel-perfect regression deliberately out of scope (flaky across font rendering).

## 11. Definition of done

§7 Design Section 7 verbatim. Summary:

- `bun run check` passes (0 errors).
- `bun test` — full suite passes (45 dashboard + 10 from B + ~25–30 new = ~80+).
- `bun run sdk:build` — IIFE < 30 KB gzipped.
- Laptop smoke test (all 9 steps) passes on Chrome.
- iPad smoke test (all 6 steps) passes on Safari with Apple Pencil pressure visibly affecting pen strokes.
- Keyboard-only flow completes Skip/Next/Send without mouse.
- Sub-project B regression check passes (Skip path produces a plain screenshot identical to v0.2.0 behavior).
- Tag `v0.3.0-annotation`.

## 12. Risks

- **Text wrap drift between `<textarea>` preview and canvas flatten.** Canvas `measureText` uses the same font the CSS applies to the textarea, but glyph-advance differences between subpixel-aware CSS layout and canvas measurement can lead to off-by-one wraps. Mitigation: use the same `font-size`, `font-family`, `letter-spacing`, `line-height` on both; apply `font-kerning: none` on the textarea to match canvas default. If still drifty in the smoke test, switch to `ctx.measureText` for preview too by rendering the textarea's wrapped output in real time via canvas.
- **Pointer Events inconsistencies across browsers.** Firefox's `pressure` is less accurate than Chrome; iOS Safari emits synthetic mouse events alongside pointer events. Mitigation: call `e.preventDefault()` inside pointer handlers to suppress synthetic mouse, and clamp `pressure` to `[0.1, 1.0]` in the pen tool.
- **Zoom + high-DPR + pan-clamp interactions.** Easy to introduce off-by-one jitter where the image drifts by a fraction each zoom step. Mitigation: zoom math always derives new pan from the "point under cursor is world-invariant" equation; unit test covers the invariant.
- **Bundle size.** Budget is +12 KB gzipped over v0.2.0-sdk's 16.6 KB. Measure after every task; if we exceed, trim first by dropping the inline tool icons (use Unicode glyphs instead of SVG).
- **`<textarea>` focus inside Shadow DOM.** `document.activeElement` inside a closed shadow root returns the shadow host, not the inner textarea. Our shadow root is `mode: "open"`, so this works — but if we ever flip to closed mode, focus detection breaks. Noted.
