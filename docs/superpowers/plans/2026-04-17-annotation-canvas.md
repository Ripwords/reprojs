# Annotation Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v0.2.0-sdk centered Reporter modal with a full-screen two-step wizard. Step 1 overlays the auto-captured screenshot with a Canvas 2D annotation layer (5 tools — arrow, rect, pen, highlight, text — plus palette, stroke slider, undo/redo/clear, pan/zoom, Apple-Pencil-aware pressure). Step 2 is the existing title/description form with the flattened PNG as a preview. Send submits the flattened annotated PNG through the same intake contract.

**Architecture:** Commit-on-release + vector undo stack + pure `render(ctx, bg, shapes, transform)` reused for both display and flatten. State lives in Preact signals at module scope (`annotation/store.ts`). Pointer Events unify mouse/touch/stylus. Shapes stored exclusively in screenshot-native (world) coordinates; pan/zoom is a render-time transform. No new public API; `MountOptions.onSubmit` gains a `screenshot` parameter (internal-to-SDK widening).

**Tech Stack:** Preact + `@preact/signals`, raw Canvas 2D, Pointer Events API, tsdown (dual IIFE+ESM), `bun test` + `happy-dom`.

**Reference spec:** `docs/superpowers/specs/2026-04-17-annotation-canvas-design.md`

**Baseline:** tag `v0.2.0-sdk`. SDK IIFE is currently 43 KB raw / 16.6 KB gzipped; budget for C adds ~12 KB gzipped max.

---

## Phase 1 — Dependencies + pure building blocks

### Task 1: Install `@preact/signals` and write `annotation/types.ts`

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/package.json`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/types.ts`

- [ ] **Step 1: Add dependency**

Edit `packages/ui/package.json` to add `@preact/signals` to `dependencies`:

```json
{
  "name": "@feedback-tool/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "module": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "scripts": {
    "demo": "bun run demo/serve.ts"
  },
  "dependencies": {
    "@feedback-tool/shared": "workspace:*",
    "@preact/signals": "^1.3.0",
    "preact": "^10.23.0"
  }
}
```

Run:
```bash
cd /Users/jiajingteoh/Documents/feedback-tool && bun install
```
Expected: installs `@preact/signals`.

- [ ] **Step 2: Create `packages/ui/src/annotation/types.ts`**

```ts
export type Tool = "arrow" | "rect" | "pen" | "highlight" | "text"

export interface ShapeBase {
  id: string
  color: string
  strokeWidth: number
}

export interface ArrowShape extends ShapeBase {
  kind: "arrow"
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface RectShape extends ShapeBase {
  kind: "rect"
  x: number
  y: number
  w: number
  h: number
}

export interface PenPoint {
  x: number
  y: number
  p: number
}

export interface PenShape extends ShapeBase {
  kind: "pen"
  points: PenPoint[]
}

export interface HighlightShape extends ShapeBase {
  kind: "highlight"
  x: number
  y: number
  w: number
  h: number
}

export interface TextShape extends ShapeBase {
  kind: "text"
  x: number
  y: number
  w: number
  h: number
  content: string
  fontSize: number
}

export type Shape = ArrowShape | RectShape | PenShape | HighlightShape | TextShape

export interface Transform {
  scale: number
  panX: number
  panY: number
}

export const IDENTITY_TRANSFORM: Transform = { scale: 1, panX: 0, panY: 0 }

export const PALETTE = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5"] as const
export type Swatch = (typeof PALETTE)[number]

export const STROKE_WIDTHS = [2, 4, 6, 8] as const
export type StrokeWidth = (typeof STROKE_WIDTHS)[number]

export const MIN_SCALE = 0.25
export const MAX_SCALE = 4
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bunx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/package.json packages/ui/src/annotation/types.ts bun.lock
git commit -m "feat(sdk-ui): add annotation types and install @preact/signals"
```

---

### Task 2: Shortcut map with TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/shortcuts.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/shortcuts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/annotation/shortcuts.test.ts
import { describe, expect, test, mock } from "bun:test"
import { DEFAULT_SHORTCUTS, matchShortcut, type Action } from "./shortcuts"

function ev(key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ...opts })
}

describe("matchShortcut", () => {
  test("matches a plain letter key", () => {
    expect(matchShortcut(ev("a"), DEFAULT_SHORTCUTS)).toBe<Action>("tool.arrow")
    expect(matchShortcut(ev("r"), DEFAULT_SHORTCUTS)).toBe<Action>("tool.rect")
    expect(matchShortcut(ev("t"), DEFAULT_SHORTCUTS)).toBe<Action>("tool.text")
  })

  test("matches mod+z (metaKey on mac, ctrlKey elsewhere)", () => {
    expect(matchShortcut(ev("z", { metaKey: true }), DEFAULT_SHORTCUTS)).toBe<Action>("undo")
    expect(matchShortcut(ev("z", { ctrlKey: true }), DEFAULT_SHORTCUTS)).toBe<Action>("undo")
  })

  test("matches mod+shift+z as redo", () => {
    expect(
      matchShortcut(ev("z", { metaKey: true, shiftKey: true }), DEFAULT_SHORTCUTS),
    ).toBe<Action>("redo")
  })

  test("ignores shortcuts inside text input", () => {
    const target = document.createElement("textarea")
    const e = new KeyboardEvent("keydown", { key: "a" })
    Object.defineProperty(e, "target", { value: target })
    expect(matchShortcut(e, DEFAULT_SHORTCUTS)).toBeNull()
  })

  test("returns null when no shortcut matches", () => {
    expect(matchShortcut(ev("q"), DEFAULT_SHORTCUTS)).toBeNull()
  })
})
```

- [ ] **Step 2: Confirm failure**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/annotation/shortcuts.test.ts
```
Expected: module not found.

- [ ] **Step 3: Implement `shortcuts.ts`**

```ts
// packages/ui/src/annotation/shortcuts.ts
export type Action =
  | "tool.arrow"
  | "tool.rect"
  | "tool.pen"
  | "tool.highlight"
  | "tool.text"
  | "undo"
  | "redo"
  | "clear"
  | "cancel.draft"
  | "resetView"

export const DEFAULT_SHORTCUTS: Record<string, Action> = {
  a: "tool.arrow",
  r: "tool.rect",
  p: "tool.pen",
  h: "tool.highlight",
  t: "tool.text",
  "mod+z": "undo",
  "mod+shift+z": "redo",
  "mod+y": "redo",
  backspace: "clear",
  delete: "clear",
  escape: "cancel.draft",
  "mod+0": "resetView",
}

function serializeEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push("mod")
  if (e.shiftKey) parts.push("shift")
  if (e.altKey) parts.push("alt")
  parts.push(e.key.toLowerCase())
  return parts.join("+")
}

function isInsideInput(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if ((t as HTMLElement).isContentEditable) return true
  return false
}

export function matchShortcut(
  e: KeyboardEvent,
  map: Record<string, Action>,
): Action | null {
  if (isInsideInput(e)) return null
  const serialized = serializeEvent(e)
  return map[serialized] ?? null
}

export function registerShortcuts(
  target: EventTarget,
  map: Record<string, Action>,
  dispatch: (action: Action, e: KeyboardEvent) => void,
): () => void {
  const handler = (raw: Event) => {
    const e = raw as KeyboardEvent
    const action = matchShortcut(e, map)
    if (action) {
      e.preventDefault()
      dispatch(action, e)
    }
  }
  target.addEventListener("keydown", handler)
  return () => target.removeEventListener("keydown", handler)
}
```

- [ ] **Step 4: Confirm pass**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/annotation/shortcuts.test.ts
```
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/annotation/shortcuts.ts packages/ui/src/annotation/shortcuts.test.ts
git commit -m "feat(sdk-ui): add remappable shortcut map with tests"
```

---

## Phase 2 — Coord math + state

### Task 3: `viewport.ts` with TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/viewport.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/viewport.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/ui/src/annotation/viewport.test.ts
import { describe, expect, test } from "bun:test"
import {
  clampPan,
  fitTransform,
  isInsideImage,
  screenToWorld,
  zoomAt,
} from "./viewport"
import type { Transform } from "./types"

const rect = { left: 0, top: 0, width: 1000, height: 700 } as DOMRect
const identity: Transform = { scale: 1, panX: 0, panY: 0 }

describe("screenToWorld", () => {
  test("identity transform is a no-op (minus rect offset)", () => {
    expect(screenToWorld(250, 100, rect, identity)).toEqual({ worldX: 250, worldY: 100 })
  })

  test("accounts for scale and pan", () => {
    const t: Transform = { scale: 2, panX: 100, panY: 50 }
    expect(screenToWorld(300, 250, rect, t)).toEqual({ worldX: 100, worldY: 100 })
  })

  test("accounts for non-zero rect offset", () => {
    const shifted = { left: 40, top: 20, width: 1000, height: 700 } as DOMRect
    expect(screenToWorld(140, 120, shifted, identity)).toEqual({ worldX: 100, worldY: 100 })
  })
})

describe("zoomAt", () => {
  test("world point under cursor stays fixed across zoom", () => {
    const before: Transform = { scale: 1, panX: 0, panY: 0 }
    const beforeWorld = screenToWorld(500, 300, rect, before)
    const after = zoomAt(500, 300, 2, before)
    const afterWorld = screenToWorld(500, 300, rect, after)
    expect(afterWorld.worldX).toBeCloseTo(beforeWorld.worldX, 5)
    expect(afterWorld.worldY).toBeCloseTo(beforeWorld.worldY, 5)
  })

  test("clamps to MIN_SCALE and MAX_SCALE", () => {
    const zoomedOut = zoomAt(500, 300, 0.001, identity)
    expect(zoomedOut.scale).toBe(0.25)
    const zoomedIn = zoomAt(500, 300, 1000, identity)
    expect(zoomedIn.scale).toBe(4)
  })
})

describe("fitTransform", () => {
  test("scales down a large image to fit the canvas", () => {
    const t = fitTransform(2000, 1400, 1000, 700)
    expect(t.scale).toBe(0.5)
    expect(t.panX).toBe(0)
    expect(t.panY).toBe(0)
  })

  test("centers a small image inside the canvas", () => {
    const t = fitTransform(200, 100, 1000, 700)
    expect(t.scale).toBe(1)
    expect(t.panX).toBe(400)
    expect(t.panY).toBe(300)
  })

  test("fits the longer dimension", () => {
    const t = fitTransform(2000, 100, 1000, 700)
    expect(t.scale).toBe(0.5)
  })
})

describe("clampPan", () => {
  test("prevents panning the image fully off-screen", () => {
    const t: Transform = { scale: 1, panX: -9999, panY: 0 }
    const clamped = clampPan(t, 500, 400, 1000, 700)
    // Leftmost edge of image at panX; want at least 100 px visible
    expect(clamped.panX).toBe(-500 + 100)
  })
})

describe("isInsideImage", () => {
  test("returns true for points inside", () => {
    expect(isInsideImage(50, 50, 100, 100)).toBe(true)
  })
  test("returns false for points outside", () => {
    expect(isInsideImage(-1, 50, 100, 100)).toBe(false)
    expect(isInsideImage(50, 101, 100, 100)).toBe(false)
  })
})
```

- [ ] **Step 2: Confirm failure**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/annotation/viewport.test.ts
```

- [ ] **Step 3: Implement `viewport.ts`**

```ts
// packages/ui/src/annotation/viewport.ts
import { MAX_SCALE, MIN_SCALE, type Transform } from "./types"

export function screenToWorld(
  screenX: number,
  screenY: number,
  canvasRect: DOMRect,
  t: Transform,
): { worldX: number; worldY: number } {
  const localX = screenX - canvasRect.left
  const localY = screenY - canvasRect.top
  return {
    worldX: (localX - t.panX) / t.scale,
    worldY: (localY - t.panY) / t.scale,
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function zoomAt(cx: number, cy: number, factor: number, t: Transform): Transform {
  const nextScale = clamp(t.scale * factor, MIN_SCALE, MAX_SCALE)
  const worldX = (cx - t.panX) / t.scale
  const worldY = (cy - t.panY) / t.scale
  return {
    scale: nextScale,
    panX: cx - worldX * nextScale,
    panY: cy - worldY * nextScale,
  }
}

export function fitTransform(
  bgW: number,
  bgH: number,
  canvasW: number,
  canvasH: number,
): Transform {
  const scale = Math.min(canvasW / bgW, canvasH / bgH, 1)
  const panX = Math.max(0, (canvasW - bgW * scale) / 2)
  const panY = Math.max(0, (canvasH - bgH * scale) / 2)
  return { scale, panX, panY }
}

const PAN_EDGE_BUFFER = 100

export function clampPan(
  t: Transform,
  bgW: number,
  bgH: number,
  canvasW: number,
  canvasH: number,
): Transform {
  const scaledW = bgW * t.scale
  const scaledH = bgH * t.scale
  return {
    scale: t.scale,
    panX: clamp(t.panX, -scaledW + PAN_EDGE_BUFFER, canvasW - PAN_EDGE_BUFFER),
    panY: clamp(t.panY, -scaledH + PAN_EDGE_BUFFER, canvasH - PAN_EDGE_BUFFER),
  }
}

export function isInsideImage(
  worldX: number,
  worldY: number,
  bgW: number,
  bgH: number,
): boolean {
  return worldX >= 0 && worldX <= bgW && worldY >= 0 && worldY <= bgH
}
```

- [ ] **Step 4: Confirm pass**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/annotation/viewport.test.ts
```
Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/annotation/viewport.ts packages/ui/src/annotation/viewport.test.ts
git commit -m "feat(sdk-ui): add viewport transform helpers with tests"
```

---

### Task 4: `store.ts` with TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/store.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/ui/src/annotation/store.test.ts
import { beforeEach, describe, expect, test } from "bun:test"
import {
  canRedo,
  canUndo,
  clear,
  commit,
  reset,
  shapes,
  undo,
  undone,
  redo,
} from "./store"
import type { ArrowShape } from "./types"

const makeArrow = (id: string): ArrowShape => ({
  kind: "arrow",
  id,
  color: "#e53935",
  strokeWidth: 4,
  x1: 0,
  y1: 0,
  x2: 10,
  y2: 10,
})

describe("annotation store", () => {
  beforeEach(() => reset())

  test("commit appends a shape", () => {
    commit(makeArrow("a"))
    expect(shapes.value).toHaveLength(1)
    expect(shapes.value[0].id).toBe("a")
    expect(canUndo.value).toBe(true)
    expect(canRedo.value).toBe(false)
  })

  test("undo moves latest shape to the redo stack", () => {
    commit(makeArrow("a"))
    commit(makeArrow("b"))
    undo()
    expect(shapes.value.map((s) => s.id)).toEqual(["a"])
    expect(undone.value.map((s) => s.id)).toEqual(["b"])
    expect(canRedo.value).toBe(true)
  })

  test("redo pushes back onto shapes", () => {
    commit(makeArrow("a"))
    undo()
    redo()
    expect(shapes.value.map((s) => s.id)).toEqual(["a"])
    expect(canRedo.value).toBe(false)
  })

  test("a new commit clears the redo stack", () => {
    commit(makeArrow("a"))
    undo()
    expect(canRedo.value).toBe(true)
    commit(makeArrow("b"))
    expect(canRedo.value).toBe(false)
  })

  test("clear empties both stacks", () => {
    commit(makeArrow("a"))
    commit(makeArrow("b"))
    undo()
    clear()
    expect(shapes.value).toHaveLength(0)
    expect(undone.value).toHaveLength(0)
  })

  test("undo on empty stack is a no-op", () => {
    undo()
    expect(shapes.value).toHaveLength(0)
    expect(undone.value).toHaveLength(0)
  })

  test("redo on empty stack is a no-op", () => {
    redo()
    expect(shapes.value).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `store.ts`**

```ts
// packages/ui/src/annotation/store.ts
import { computed, signal } from "@preact/signals"
import {
  IDENTITY_TRANSFORM,
  PALETTE,
  type Shape,
  type Tool,
  type Transform,
} from "./types"

export const shapes = signal<Shape[]>([])
export const undone = signal<Shape[]>([])
export const tool = signal<Tool>("arrow")
export const color = signal<string>(PALETTE[0])
export const strokeW = signal<number>(4)
export const viewport = signal<Transform>(IDENTITY_TRANSFORM)
export const draft = signal<Shape | null>(null)

export const canUndo = computed(() => shapes.value.length > 0)
export const canRedo = computed(() => undone.value.length > 0)

export function commit(s: Shape): void {
  shapes.value = [...shapes.value, s]
  undone.value = []
}

export function undo(): void {
  if (shapes.value.length === 0) return
  const next = [...shapes.value]
  const popped = next.pop() as Shape
  shapes.value = next
  undone.value = [...undone.value, popped]
}

export function redo(): void {
  if (undone.value.length === 0) return
  const next = [...undone.value]
  const popped = next.pop() as Shape
  undone.value = next
  shapes.value = [...shapes.value, popped]
}

export function clear(): void {
  shapes.value = []
  undone.value = []
}

export function reset(): void {
  shapes.value = []
  undone.value = []
  draft.value = null
  tool.value = "arrow"
  color.value = PALETTE[0]
  strokeW.value = 4
  viewport.value = IDENTITY_TRANSFORM
}

export function newShapeId(): string {
  return crypto.randomUUID()
}
```

- [ ] **Step 4: Confirm pass**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/annotation/store.test.ts
```
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/annotation/store.ts packages/ui/src/annotation/store.test.ts
git commit -m "feat(sdk-ui): add annotation store with undo/redo via Preact signals"
```

---

### Task 5: `text-wrap.ts` with TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/text-wrap.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/text-wrap.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/ui/src/annotation/text-wrap.test.ts
import { describe, expect, test } from "bun:test"
import { wrapText, type MeasureFn } from "./text-wrap"

const fixedWidth =
  (px: number): MeasureFn =>
  (s) => ({ width: s.length * px })

describe("wrapText", () => {
  test("returns one line when text fits", () => {
    expect(wrapText(fixedWidth(7), "hello world", 200)).toEqual(["hello world"])
  })

  test("wraps at word boundary", () => {
    // "hello world foo bar" at 7px/char = 133px. Max 77px → break after "hello"
    expect(wrapText(fixedWidth(7), "hello world foo bar", 77)).toEqual([
      "hello",
      "world",
      "foo bar",
    ])
  })

  test("breaks a single long word that exceeds maxWidth", () => {
    // "supercalifragilistic" = 20 chars × 7 = 140px. Max = 49px → break at char 7, 14.
    expect(wrapText(fixedWidth(7), "supercalifragilistic", 49)).toEqual([
      "superca",
      "lifragi",
      "listic",
    ])
  })

  test("preserves explicit newlines", () => {
    expect(wrapText(fixedWidth(7), "line one\nline two", 200)).toEqual([
      "line one",
      "line two",
    ])
  })

  test("preserves empty lines (paragraph breaks)", () => {
    expect(wrapText(fixedWidth(7), "a\n\nb", 200)).toEqual(["a", "", "b"])
  })

  test("empty input returns empty array", () => {
    expect(wrapText(fixedWidth(7), "", 200)).toEqual([])
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `text-wrap.ts`**

```ts
// packages/ui/src/annotation/text-wrap.ts
export type MeasureFn = (text: string) => { width: number }

export function wrapText(measure: MeasureFn, text: string, maxWidth: number): string[] {
  if (text.length === 0) return []

  const lines: string[] = []
  const paragraphs = text.split("\n")

  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push("")
      continue
    }

    const words = para.split(" ")
    let current = ""

    for (const word of words) {
      const candidate = current.length > 0 ? `${current} ${word}` : word
      if (measure(candidate).width <= maxWidth) {
        current = candidate
        continue
      }

      if (current.length > 0) {
        lines.push(current)
        current = ""
      }

      if (measure(word).width <= maxWidth) {
        current = word
        continue
      }

      // Long word: break at character boundaries
      let piece = ""
      for (const ch of word) {
        const cand = piece + ch
        if (measure(cand).width <= maxWidth) {
          piece = cand
        } else {
          if (piece.length > 0) lines.push(piece)
          piece = ch
        }
      }
      current = piece
    }

    lines.push(current)
  }

  return lines
}
```

- [ ] **Step 4: Confirm pass**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/annotation/text-wrap.test.ts
```
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/annotation/text-wrap.ts packages/ui/src/annotation/text-wrap.test.ts
git commit -m "feat(sdk-ui): add deterministic word-wrap with tests"
```

---

## Phase 3 — Rendering pipeline

### Task 6: `render.ts` — pure renderer with pixel tests

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/render.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/render.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/ui/src/annotation/render.test.ts
import { describe, expect, test, beforeAll } from "bun:test"
import { render } from "./render"
import { IDENTITY_TRANSFORM, type Shape } from "./types"

let bg: HTMLCanvasElement
beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window()
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    HTMLCanvasElement: win.HTMLCanvasElement,
    OffscreenCanvas: (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas,
  })
  bg = document.createElement("canvas")
  bg.width = 100
  bg.height = 100
  const bgCtx = bg.getContext("2d")!
  bgCtx.fillStyle = "#ffffff"
  bgCtx.fillRect(0, 0, 100, 100)
})

function makeCtx(w = 100, h = 100): CanvasRenderingContext2D {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  return c.getContext("2d")!
}

describe("render", () => {
  test("draws the background at world (0,0)", () => {
    const ctx = makeCtx()
    render(ctx, bg, [], IDENTITY_TRANSFORM)
    const px = ctx.getImageData(50, 50, 1, 1).data
    // background is white
    expect(px[0]).toBe(255)
    expect(px[1]).toBe(255)
    expect(px[2]).toBe(255)
  })

  test("draws a red arrow", () => {
    const ctx = makeCtx()
    const arrow: Shape = {
      kind: "arrow",
      id: "a",
      color: "#ff0000",
      strokeWidth: 4,
      x1: 10,
      y1: 50,
      x2: 90,
      y2: 50,
    }
    render(ctx, bg, [arrow], IDENTITY_TRANSFORM)
    const px = ctx.getImageData(50, 50, 1, 1).data
    expect(px[0]).toBeGreaterThan(200) // red channel strong
  })

  test("draws a rectangle outline", () => {
    const ctx = makeCtx()
    const rect: Shape = {
      kind: "rect",
      id: "r",
      color: "#0000ff",
      strokeWidth: 4,
      x: 20,
      y: 20,
      w: 60,
      h: 60,
    }
    render(ctx, bg, [rect], IDENTITY_TRANSFORM)
    const onEdge = ctx.getImageData(20, 20, 1, 1).data
    expect(onEdge[2]).toBeGreaterThan(100) // blue on edge
    const inside = ctx.getImageData(50, 50, 1, 1).data
    expect(inside[2]).toBe(255) // unfilled: untouched white (blue=255 because white)
  })

  test("highlight renders with alpha blending", () => {
    const ctx = makeCtx()
    const hl: Shape = {
      kind: "highlight",
      id: "h",
      color: "#fdd835",
      strokeWidth: 0,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    }
    render(ctx, bg, [hl], IDENTITY_TRANSFORM)
    const px = ctx.getImageData(50, 50, 1, 1).data
    // multiply mode over white = the highlight color. Red > 200, blue low.
    expect(px[0]).toBeGreaterThan(200)
    expect(px[2]).toBeLessThan(100)
  })

  test("pen draws a visible stroke along points", () => {
    const ctx = makeCtx()
    const pen: Shape = {
      kind: "pen",
      id: "p",
      color: "#00ff00",
      strokeWidth: 4,
      points: [
        { x: 10, y: 50, p: 1 },
        { x: 50, y: 50, p: 1 },
        { x: 90, y: 50, p: 1 },
      ],
    }
    render(ctx, bg, [pen], IDENTITY_TRANSFORM)
    const px = ctx.getImageData(50, 50, 1, 1).data
    expect(px[1]).toBeGreaterThan(200)
  })

  test("applies transform so shapes shift with pan", () => {
    const ctx = makeCtx()
    const arrow: Shape = {
      kind: "arrow",
      id: "a",
      color: "#ff0000",
      strokeWidth: 4,
      x1: 0,
      y1: 50,
      x2: 40,
      y2: 50,
    }
    render(ctx, bg, [arrow], { scale: 1, panX: 50, panY: 0 })
    // the arrow is drawn from (50, 50) to (90, 50) in screen coords
    const early = ctx.getImageData(20, 50, 1, 1).data
    const later = ctx.getImageData(70, 50, 1, 1).data
    expect(early[0]).toBe(255) // white — no shift in pan-space before 50
    expect(later[0]).toBeGreaterThan(200) // red — arrow is here
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `render.ts`**

```ts
// packages/ui/src/annotation/render.ts
import { wrapText } from "./text-wrap"
import type { Shape, Transform } from "./types"

export function render(
  ctx: CanvasRenderingContext2D,
  bg: HTMLImageElement | HTMLCanvasElement,
  shapes: Shape[],
  t: Transform,
): void {
  const { canvas } = ctx
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  ctx.setTransform(t.scale, 0, 0, t.scale, t.panX, t.panY)
  ctx.drawImage(bg, 0, 0)

  for (const s of shapes) drawShape(ctx, s)

  ctx.restore()
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape): void {
  switch (s.kind) {
    case "arrow":
      drawArrow(ctx, s)
      return
    case "rect":
      drawRect(ctx, s)
      return
    case "highlight":
      drawHighlight(ctx, s)
      return
    case "pen":
      drawPen(ctx, s)
      return
    case "text":
      drawText(ctx, s)
      return
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  s: Extract<Shape, { kind: "arrow" }>,
): void {
  ctx.save()
  ctx.strokeStyle = s.color
  ctx.lineWidth = s.strokeWidth
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(s.x1, s.y1)
  ctx.lineTo(s.x2, s.y2)
  ctx.stroke()
  // arrowhead
  const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
  const head = Math.max(8, s.strokeWidth * 3)
  ctx.beginPath()
  ctx.moveTo(s.x2, s.y2)
  ctx.lineTo(
    s.x2 - head * Math.cos(angle - Math.PI / 6),
    s.y2 - head * Math.sin(angle - Math.PI / 6),
  )
  ctx.moveTo(s.x2, s.y2)
  ctx.lineTo(
    s.x2 - head * Math.cos(angle + Math.PI / 6),
    s.y2 - head * Math.sin(angle + Math.PI / 6),
  )
  ctx.stroke()
  ctx.restore()
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  s: Extract<Shape, { kind: "rect" }>,
): void {
  ctx.save()
  ctx.strokeStyle = s.color
  ctx.lineWidth = s.strokeWidth
  ctx.strokeRect(s.x, s.y, s.w, s.h)
  ctx.restore()
}

function drawHighlight(
  ctx: CanvasRenderingContext2D,
  s: Extract<Shape, { kind: "highlight" }>,
): void {
  ctx.save()
  ctx.globalCompositeOperation = "multiply"
  ctx.globalAlpha = 0.4
  ctx.fillStyle = s.color
  ctx.fillRect(s.x, s.y, s.w, s.h)
  ctx.restore()
}

function drawPen(
  ctx: CanvasRenderingContext2D,
  s: Extract<Shape, { kind: "pen" }>,
): void {
  if (s.points.length < 2) return
  ctx.save()
  ctx.strokeStyle = s.color
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1]!
    const b = s.points[i]!
    const pressure = (a.p + b.p) / 2
    ctx.lineWidth = s.strokeWidth * (0.5 + pressure * 0.5)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawText(
  ctx: CanvasRenderingContext2D,
  s: Extract<Shape, { kind: "text" }>,
): void {
  ctx.save()
  ctx.fillStyle = s.color
  ctx.font = `${s.fontSize}px system-ui, -apple-system, sans-serif`
  ctx.textBaseline = "top"
  const lineHeight = s.fontSize * 1.3
  const lines = wrapText((text) => ctx.measureText(text), s.content, s.w)
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, s.x, s.y + i * lineHeight)
  }
  ctx.restore()
}
```

- [ ] **Step 4: Confirm pass**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/annotation/render.test.ts
```
Expected: 6 tests PASS. (Pixel thresholds are loose; if any fails in CI due to anti-aliasing, tighten the assertion or move to a larger canvas.)

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/annotation/render.ts packages/ui/src/annotation/render.test.ts
git commit -m "feat(sdk-ui): add pure render function with per-shape drawing and tests"
```

---

### Task 7: `flatten.ts` with TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/flatten.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/flatten.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/ui/src/annotation/flatten.test.ts
import { describe, expect, test, beforeAll } from "bun:test"
import { flatten } from "./flatten"
import type { Shape } from "./types"

let bg: HTMLCanvasElement

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window()
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    HTMLCanvasElement: win.HTMLCanvasElement,
  })
  bg = document.createElement("canvas")
  bg.width = 200
  bg.height = 100
  const ctx = bg.getContext("2d")!
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, 200, 100)
  // fake naturalWidth/Height on the canvas itself via closure
  Object.defineProperty(bg, "naturalWidth", { value: 200, configurable: true })
  Object.defineProperty(bg, "naturalHeight", { value: 100, configurable: true })
})

describe("flatten", () => {
  test("produces a Blob of type image/png at native bg dimensions", async () => {
    const blob = await flatten(bg as unknown as HTMLImageElement, [])
    expect(blob.type).toBe("image/png")
    expect(blob.size).toBeGreaterThan(0)
  })

  test("applies shapes at native resolution (identity transform)", async () => {
    const arrow: Shape = {
      kind: "arrow",
      id: "a",
      color: "#ff0000",
      strokeWidth: 4,
      x1: 10,
      y1: 50,
      x2: 190,
      y2: 50,
    }
    const blob = await flatten(bg as unknown as HTMLImageElement, [arrow])
    expect(blob.size).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `flatten.ts`**

```ts
// packages/ui/src/annotation/flatten.ts
import { render } from "./render"
import { IDENTITY_TRANSFORM, type Shape } from "./types"

export async function flatten(bg: HTMLImageElement, shapes: Shape[]): Promise<Blob> {
  const width = (bg as unknown as { naturalWidth?: number }).naturalWidth ?? bg.width
  const height = (bg as unknown as { naturalHeight?: number }).naturalHeight ?? bg.height

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("flatten: 2d context unavailable")

  render(ctx, bg, shapes, IDENTITY_TRANSFORM)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error("toBlob returned null"))
    }, "image/png")
  })
}
```

- [ ] **Step 4: Confirm pass**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/annotation/flatten.test.ts
```
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/annotation/flatten.ts packages/ui/src/annotation/flatten.test.ts
git commit -m "feat(sdk-ui): add flatten(bg, shapes) for submit-time rasterization"
```

---

## Phase 4 — Tools

### Task 8: `tools/index.ts` + `arrow` + test

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/tools/index.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/tools/arrow.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/tools/arrow.test.ts`

- [ ] **Step 1: Write the tool interface**

```ts
// packages/ui/src/annotation/tools/index.ts
import type { Shape } from "../types"

export interface ToolContext {
  worldX: number
  worldY: number
  pressure: number
  color: string
  strokeWidth: number
  shape?: Shape
}

export interface ToolHandler {
  onPointerDown(ctx: ToolContext): Shape
  onPointerMove(ctx: ToolContext): Shape
  onPointerUp(ctx: ToolContext): Shape | null
}
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/ui/src/annotation/tools/arrow.test.ts
import { describe, expect, test } from "bun:test"
import { arrowTool } from "./arrow"
import type { ArrowShape } from "../types"

const baseCtx = {
  pressure: 1,
  color: "#e53935",
  strokeWidth: 4,
}

describe("arrowTool", () => {
  test("onPointerDown returns shape with x1==x2 and y1==y2", () => {
    const s = arrowTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 20 }) as ArrowShape
    expect(s.kind).toBe("arrow")
    expect(s.x1).toBe(10)
    expect(s.y1).toBe(20)
    expect(s.x2).toBe(10)
    expect(s.y2).toBe(20)
    expect(s.color).toBe("#e53935")
  })

  test("onPointerMove updates x2,y2 only", () => {
    const down = arrowTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 20 }) as ArrowShape
    const move = arrowTool.onPointerMove({
      ...baseCtx,
      worldX: 100,
      worldY: 200,
      shape: down,
    }) as ArrowShape
    expect(move.x1).toBe(10)
    expect(move.y1).toBe(20)
    expect(move.x2).toBe(100)
    expect(move.y2).toBe(200)
    expect(move.id).toBe(down.id)
  })

  test("onPointerUp commits if arrow has nonzero length", () => {
    const down = arrowTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 20 }) as ArrowShape
    const up = arrowTool.onPointerUp({
      ...baseCtx,
      worldX: 100,
      worldY: 100,
      shape: { ...down, x2: 100, y2: 100 },
    })
    expect(up).not.toBeNull()
  })

  test("onPointerUp discards a zero-length arrow", () => {
    const down = arrowTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 20 }) as ArrowShape
    const up = arrowTool.onPointerUp({ ...baseCtx, worldX: 10, worldY: 20, shape: down })
    expect(up).toBeNull()
  })
})
```

- [ ] **Step 3: Implement `arrow.ts`**

```ts
// packages/ui/src/annotation/tools/arrow.ts
import { newShapeId } from "../store"
import type { ArrowShape, Shape } from "../types"
import type { ToolContext, ToolHandler } from "./index"

const MIN_LENGTH_SQ = 4 * 4 // ignore tiny arrows (<4px)

export const arrowTool: ToolHandler = {
  onPointerDown(ctx: ToolContext): Shape {
    const s: ArrowShape = {
      kind: "arrow",
      id: newShapeId(),
      color: ctx.color,
      strokeWidth: ctx.strokeWidth,
      x1: ctx.worldX,
      y1: ctx.worldY,
      x2: ctx.worldX,
      y2: ctx.worldY,
    }
    return s
  },
  onPointerMove(ctx: ToolContext): Shape {
    const s = ctx.shape as ArrowShape
    return { ...s, x2: ctx.worldX, y2: ctx.worldY }
  },
  onPointerUp(ctx: ToolContext): Shape | null {
    const s = ctx.shape as ArrowShape
    const final: ArrowShape = { ...s, x2: ctx.worldX, y2: ctx.worldY }
    const dx = final.x2 - final.x1
    const dy = final.y2 - final.y1
    if (dx * dx + dy * dy < MIN_LENGTH_SQ) return null
    return final
  },
}
```

- [ ] **Step 4: Confirm pass**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/annotation/tools/arrow.test.ts
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/annotation/tools
git commit -m "feat(sdk-ui): add ToolHandler interface and arrow tool with tests"
```

---

### Task 9: `rect` tool + test

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/tools/rect.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/tools/rect.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/ui/src/annotation/tools/rect.test.ts
import { describe, expect, test } from "bun:test"
import { rectTool } from "./rect"
import type { RectShape } from "../types"

const baseCtx = { pressure: 1, color: "#1e88e5", strokeWidth: 4 }

describe("rectTool", () => {
  test("onPointerDown returns a zero-size rect at origin", () => {
    const s = rectTool.onPointerDown({ ...baseCtx, worldX: 50, worldY: 50 }) as RectShape
    expect(s.kind).toBe("rect")
    expect(s.x).toBe(50)
    expect(s.y).toBe(50)
    expect(s.w).toBe(0)
    expect(s.h).toBe(0)
  })

  test("onPointerMove expands w/h from origin", () => {
    const down = rectTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 10 }) as RectShape
    const move = rectTool.onPointerMove({
      ...baseCtx,
      worldX: 60,
      worldY: 30,
      shape: down,
    }) as RectShape
    expect(move.w).toBe(50)
    expect(move.h).toBe(20)
  })

  test("onPointerUp normalizes negative dimensions", () => {
    // Drag from (100, 100) to (60, 40) should land at x=60, y=40, w=40, h=60
    const down = rectTool.onPointerDown({ ...baseCtx, worldX: 100, worldY: 100 }) as RectShape
    const up = rectTool.onPointerUp({
      ...baseCtx,
      worldX: 60,
      worldY: 40,
      shape: down,
    }) as RectShape
    expect(up.x).toBe(60)
    expect(up.y).toBe(40)
    expect(up.w).toBe(40)
    expect(up.h).toBe(60)
  })

  test("onPointerUp discards a tiny rect", () => {
    const down = rectTool.onPointerDown({ ...baseCtx, worldX: 50, worldY: 50 }) as RectShape
    const up = rectTool.onPointerUp({ ...baseCtx, worldX: 51, worldY: 51, shape: down })
    expect(up).toBeNull()
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `rect.ts`**

```ts
// packages/ui/src/annotation/tools/rect.ts
import { newShapeId } from "../store"
import type { RectShape, Shape } from "../types"
import type { ToolContext, ToolHandler } from "./index"

const MIN_SIDE = 4

export const rectTool: ToolHandler = {
  onPointerDown(ctx: ToolContext): Shape {
    const s: RectShape = {
      kind: "rect",
      id: newShapeId(),
      color: ctx.color,
      strokeWidth: ctx.strokeWidth,
      x: ctx.worldX,
      y: ctx.worldY,
      w: 0,
      h: 0,
    }
    return s
  },
  onPointerMove(ctx: ToolContext): Shape {
    const s = ctx.shape as RectShape
    // Note: we keep x/y fixed at origin and just set w/h so move stays O(1).
    // We normalize on Up.
    return { ...s, w: ctx.worldX - s.x, h: ctx.worldY - s.y }
  },
  onPointerUp(ctx: ToolContext): Shape | null {
    const s = ctx.shape as RectShape
    const x = Math.min(s.x, ctx.worldX)
    const y = Math.min(s.y, ctx.worldY)
    const w = Math.abs(ctx.worldX - s.x)
    const h = Math.abs(ctx.worldY - s.y)
    if (w < MIN_SIDE || h < MIN_SIDE) return null
    return { ...s, x, y, w, h }
  },
}
```

- [ ] **Step 4: Confirm pass**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/annotation/tools/rect.test.ts
```
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/annotation/tools/rect.ts packages/ui/src/annotation/tools/rect.test.ts
git commit -m "feat(sdk-ui): add rect tool with normalization and tests"
```

---

### Task 10: `pen` tool + test

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/tools/pen.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/tools/pen.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/ui/src/annotation/tools/pen.test.ts
import { describe, expect, test } from "bun:test"
import { penTool } from "./pen"
import type { PenShape } from "../types"

const baseCtx = { pressure: 0.8, color: "#43a047", strokeWidth: 4 }

describe("penTool", () => {
  test("onPointerDown seeds a single point", () => {
    const s = penTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 10 }) as PenShape
    expect(s.kind).toBe("pen")
    expect(s.points).toHaveLength(1)
    expect(s.points[0]).toEqual({ x: 10, y: 10, p: 0.8 })
  })

  test("onPointerMove appends points > 2px away", () => {
    const down = penTool.onPointerDown({ ...baseCtx, worldX: 0, worldY: 0 }) as PenShape
    const m1 = penTool.onPointerMove({
      ...baseCtx,
      worldX: 5,
      worldY: 0,
      shape: down,
    }) as PenShape
    expect(m1.points).toHaveLength(2)
  })

  test("onPointerMove skips points within 2px of previous", () => {
    const down = penTool.onPointerDown({ ...baseCtx, worldX: 0, worldY: 0 }) as PenShape
    const m1 = penTool.onPointerMove({
      ...baseCtx,
      worldX: 1,
      worldY: 0,
      shape: down,
    }) as PenShape
    expect(m1.points).toHaveLength(1)
  })

  test("onPointerUp commits if stroke has ≥ 2 points", () => {
    const down = penTool.onPointerDown({ ...baseCtx, worldX: 0, worldY: 0 }) as PenShape
    const withTwo: PenShape = {
      ...down,
      points: [
        { x: 0, y: 0, p: 1 },
        { x: 10, y: 10, p: 1 },
      ],
    }
    const up = penTool.onPointerUp({
      ...baseCtx,
      worldX: 20,
      worldY: 20,
      shape: withTwo,
    }) as PenShape
    expect(up).not.toBeNull()
    expect(up.points.length).toBeGreaterThanOrEqual(2)
  })

  test("onPointerUp discards a single-tap stroke", () => {
    const down = penTool.onPointerDown({ ...baseCtx, worldX: 0, worldY: 0 }) as PenShape
    const up = penTool.onPointerUp({ ...baseCtx, worldX: 0, worldY: 0, shape: down })
    expect(up).toBeNull()
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `pen.ts`**

```ts
// packages/ui/src/annotation/tools/pen.ts
import { newShapeId } from "../store"
import type { PenShape, Shape } from "../types"
import type { ToolContext, ToolHandler } from "./index"

const MIN_DISTANCE_SQ = 2 * 2

export const penTool: ToolHandler = {
  onPointerDown(ctx: ToolContext): Shape {
    const s: PenShape = {
      kind: "pen",
      id: newShapeId(),
      color: ctx.color,
      strokeWidth: ctx.strokeWidth,
      points: [{ x: ctx.worldX, y: ctx.worldY, p: ctx.pressure }],
    }
    return s
  },
  onPointerMove(ctx: ToolContext): Shape {
    const s = ctx.shape as PenShape
    const last = s.points[s.points.length - 1]!
    const dx = ctx.worldX - last.x
    const dy = ctx.worldY - last.y
    if (dx * dx + dy * dy < MIN_DISTANCE_SQ) return s
    return {
      ...s,
      points: [...s.points, { x: ctx.worldX, y: ctx.worldY, p: ctx.pressure }],
    }
  },
  onPointerUp(ctx: ToolContext): Shape | null {
    const s = ctx.shape as PenShape
    const last = s.points[s.points.length - 1]!
    const addLast =
      last.x !== ctx.worldX || last.y !== ctx.worldY
        ? [...s.points, { x: ctx.worldX, y: ctx.worldY, p: ctx.pressure }]
        : s.points
    if (addLast.length < 2) return null
    return { ...s, points: addLast }
  },
}
```

- [ ] **Step 4: Confirm pass**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/annotation/tools/pen.test.ts
```
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/annotation/tools/pen.ts packages/ui/src/annotation/tools/pen.test.ts
git commit -m "feat(sdk-ui): add pen tool with pressure-aware downsampling and tests"
```

---

### Task 11: `highlight` tool + test

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/tools/highlight.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/tools/highlight.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/ui/src/annotation/tools/highlight.test.ts
import { describe, expect, test } from "bun:test"
import { highlightTool } from "./highlight"
import type { HighlightShape } from "../types"

const baseCtx = { pressure: 1, color: "#fdd835", strokeWidth: 4 }

describe("highlightTool", () => {
  test("onPointerDown creates highlight with zero size", () => {
    const s = highlightTool.onPointerDown({
      ...baseCtx,
      worldX: 10,
      worldY: 10,
    }) as HighlightShape
    expect(s.kind).toBe("highlight")
    expect(s.x).toBe(10)
    expect(s.y).toBe(10)
    expect(s.w).toBe(0)
    expect(s.h).toBe(0)
  })

  test("onPointerUp normalizes negative dimensions", () => {
    const down = highlightTool.onPointerDown({
      ...baseCtx,
      worldX: 100,
      worldY: 100,
    }) as HighlightShape
    const up = highlightTool.onPointerUp({
      ...baseCtx,
      worldX: 40,
      worldY: 60,
      shape: down,
    }) as HighlightShape
    expect(up.x).toBe(40)
    expect(up.y).toBe(60)
    expect(up.w).toBe(60)
    expect(up.h).toBe(40)
  })

  test("onPointerUp discards a tiny highlight", () => {
    const down = highlightTool.onPointerDown({
      ...baseCtx,
      worldX: 10,
      worldY: 10,
    }) as HighlightShape
    const up = highlightTool.onPointerUp({
      ...baseCtx,
      worldX: 11,
      worldY: 11,
      shape: down,
    })
    expect(up).toBeNull()
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `highlight.ts`**

```ts
// packages/ui/src/annotation/tools/highlight.ts
import { newShapeId } from "../store"
import type { HighlightShape, Shape } from "../types"
import type { ToolContext, ToolHandler } from "./index"

const MIN_SIDE = 4

export const highlightTool: ToolHandler = {
  onPointerDown(ctx: ToolContext): Shape {
    const s: HighlightShape = {
      kind: "highlight",
      id: newShapeId(),
      color: ctx.color,
      strokeWidth: 0,
      x: ctx.worldX,
      y: ctx.worldY,
      w: 0,
      h: 0,
    }
    return s
  },
  onPointerMove(ctx: ToolContext): Shape {
    const s = ctx.shape as HighlightShape
    return { ...s, w: ctx.worldX - s.x, h: ctx.worldY - s.y }
  },
  onPointerUp(ctx: ToolContext): Shape | null {
    const s = ctx.shape as HighlightShape
    const x = Math.min(s.x, ctx.worldX)
    const y = Math.min(s.y, ctx.worldY)
    const w = Math.abs(ctx.worldX - s.x)
    const h = Math.abs(ctx.worldY - s.y)
    if (w < MIN_SIDE || h < MIN_SIDE) return null
    return { ...s, x, y, w, h }
  },
}
```

- [ ] **Step 4: Confirm pass**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/annotation/tools/highlight.test.ts
```
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/annotation/tools/highlight.ts packages/ui/src/annotation/tools/highlight.test.ts
git commit -m "feat(sdk-ui): add highlight tool with tests"
```

---

### Task 12: `text` tool + test

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/tools/text.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/tools/text.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/ui/src/annotation/tools/text.test.ts
import { describe, expect, test } from "bun:test"
import { textTool } from "./text"
import type { TextShape } from "../types"

const baseCtx = { pressure: 1, color: "#111111", strokeWidth: 2 }

describe("textTool (drag-rect phase only)", () => {
  test("onPointerDown creates a text shape with empty content", () => {
    const s = textTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 10 }) as TextShape
    expect(s.kind).toBe("text")
    expect(s.content).toBe("")
    expect(s.fontSize).toBe(14)
  })

  test("onPointerUp normalizes w/h and discards tiny boxes", () => {
    const down = textTool.onPointerDown({ ...baseCtx, worldX: 100, worldY: 100 }) as TextShape
    const ok = textTool.onPointerUp({
      ...baseCtx,
      worldX: 40,
      worldY: 40,
      shape: down,
    }) as TextShape
    expect(ok.x).toBe(40)
    expect(ok.y).toBe(40)
    expect(ok.w).toBe(60)
    expect(ok.h).toBe(60)

    const tiny = textTool.onPointerUp({
      ...baseCtx,
      worldX: 101,
      worldY: 101,
      shape: down,
    })
    expect(tiny).toBeNull()
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement `text.ts`**

```ts
// packages/ui/src/annotation/tools/text.ts
import { newShapeId } from "../store"
import type { Shape, TextShape } from "../types"
import type { ToolContext, ToolHandler } from "./index"

const MIN_SIDE = 12
const DEFAULT_FONT_SIZE = 14

export const textTool: ToolHandler = {
  onPointerDown(ctx: ToolContext): Shape {
    const s: TextShape = {
      kind: "text",
      id: newShapeId(),
      color: ctx.color,
      strokeWidth: ctx.strokeWidth,
      x: ctx.worldX,
      y: ctx.worldY,
      w: 0,
      h: 0,
      content: "",
      fontSize: DEFAULT_FONT_SIZE,
    }
    return s
  },
  onPointerMove(ctx: ToolContext): Shape {
    const s = ctx.shape as TextShape
    return { ...s, w: ctx.worldX - s.x, h: ctx.worldY - s.y }
  },
  onPointerUp(ctx: ToolContext): Shape | null {
    const s = ctx.shape as TextShape
    const x = Math.min(s.x, ctx.worldX)
    const y = Math.min(s.y, ctx.worldY)
    const w = Math.abs(ctx.worldX - s.x)
    const h = Math.abs(ctx.worldY - s.y)
    if (w < MIN_SIDE || h < MIN_SIDE) return null
    // Commit the empty-content box. The canvas component replaces this
    // draft with a <textarea> for the input phase, then updates .content
    // before pushing to the store.
    return { ...s, x, y, w, h }
  },
}
```

- [ ] **Step 4: Confirm pass**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/annotation/tools/text.test.ts
```
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/annotation/tools/text.ts packages/ui/src/annotation/tools/text.test.ts
git commit -m "feat(sdk-ui): add text tool drag-rect phase with tests"
```

---

## Phase 5 — Interactive canvas + UI

### Task 13: `canvas.tsx` — pointer plumbing + draft + text input overlay

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/canvas.tsx`

- [ ] **Step 1: Write `canvas.tsx`**

```tsx
// packages/ui/src/annotation/canvas.tsx
/* eslint-disable no-await-in-loop */
import { effect } from "@preact/signals"
import { h } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { render as renderAll } from "./render"
import { color, commit, draft, shapes, strokeW, tool, viewport } from "./store"
import { arrowTool } from "./tools/arrow"
import { highlightTool } from "./tools/highlight"
import { penTool } from "./tools/pen"
import { rectTool } from "./tools/rect"
import { textTool } from "./tools/text"
import type { ToolHandler } from "./tools"
import type { Shape, TextShape, Tool, Transform } from "./types"
import {
  clampPan,
  fitTransform,
  isInsideImage,
  screenToWorld,
  zoomAt,
} from "./viewport"

const HANDLERS: Record<Tool, ToolHandler> = {
  arrow: arrowTool,
  rect: rectTool,
  pen: penTool,
  highlight: highlightTool,
  text: textTool,
}

export interface CanvasProps {
  bg: HTMLImageElement
}

export function Canvas({ bg }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const activePointer = useRef<number | null>(null)
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const spaceHeld = useRef(false)
  const textInput = useState<{
    shape: TextShape
    value: string
  } | null>(null)
  const [editingText, setEditingText] = textInput

  // Fit + resize observer
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const applyFit = () => {
      viewport.value = fitTransform(
        (bg as unknown as { naturalWidth?: number }).naturalWidth ?? bg.width,
        (bg as unknown as { naturalHeight?: number }).naturalHeight ?? bg.height,
        el.clientWidth,
        el.clientHeight,
      )
    }
    applyFit()
    const ro = new ResizeObserver(applyFit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [bg])

  // Keep the canvas backing size in sync with CSS size (HiDPI)
  useEffect(() => {
    const canvas = canvasRef.current
    const el = containerRef.current
    if (!canvas || !el) return
    const sync = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = el.clientWidth * dpr
      canvas.height = el.clientHeight * dpr
      canvas.style.width = `${el.clientWidth}px`
      canvas.style.height = `${el.clientHeight}px`
      const ctx = canvas.getContext("2d")
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      scheduleDraw()
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // RAF-driven draw loop reacting to signal changes
  const drawScheduled = useRef(false)
  const scheduleDraw = () => {
    if (drawScheduled.current) return
    drawScheduled.current = true
    requestAnimationFrame(() => {
      drawScheduled.current = false
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      const visible = draft.value
        ? [...shapes.value, draft.value]
        : shapes.value
      renderAll(ctx, bg, visible, viewport.value)
    })
  }

  useEffect(() => {
    const dispose = effect(() => {
      // Touch each reactive source so the effect re-runs on change
      void shapes.value
      void draft.value
      void viewport.value
      scheduleDraw()
    })
    return () => dispose()
  }, [])

  // Keyboard: space held = pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeld.current = true
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeld.current = false
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])

  function onPointerDown(e: PointerEvent) {
    if (e.button === 1 || e.button === 2) return
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    activePointer.current = e.pointerId

    const rect = canvas.getBoundingClientRect()
    const { worldX, worldY } = screenToWorld(e.clientX, e.clientY, rect, viewport.value)

    // Pan if space held or outside image
    if (
      spaceHeld.current ||
      !isInsideImage(
        worldX,
        worldY,
        (bg as unknown as { naturalWidth?: number }).naturalWidth ?? bg.width,
        (bg as unknown as { naturalHeight?: number }).naturalHeight ?? bg.height,
      )
    ) {
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        panX: viewport.value.panX,
        panY: viewport.value.panY,
      }
      return
    }

    const handler = HANDLERS[tool.value]
    const s = handler.onPointerDown({
      worldX,
      worldY,
      pressure: e.pressure || 0.5,
      color: color.value,
      strokeWidth: strokeW.value,
    })
    draft.value = s
  }

  function onPointerMove(e: PointerEvent) {
    if (activePointer.current !== e.pointerId) return
    const canvas = canvasRef.current
    if (!canvas) return

    // Pan
    if (panStart.current) {
      const dx = e.clientX - panStart.current.x
      const dy = e.clientY - panStart.current.y
      const rect = canvas.getBoundingClientRect()
      viewport.value = clampPan(
        {
          scale: viewport.value.scale,
          panX: panStart.current.panX + dx,
          panY: panStart.current.panY + dy,
        },
        (bg as unknown as { naturalWidth?: number }).naturalWidth ?? bg.width,
        (bg as unknown as { naturalHeight?: number }).naturalHeight ?? bg.height,
        rect.width,
        rect.height,
      )
      return
    }

    if (!draft.value) return
    const rect = canvas.getBoundingClientRect()
    const { worldX, worldY } = screenToWorld(e.clientX, e.clientY, rect, viewport.value)
    const handler = HANDLERS[draft.value.kind as Tool]
    draft.value = handler.onPointerMove({
      worldX,
      worldY,
      pressure: e.pressure || 0.5,
      color: color.value,
      strokeWidth: strokeW.value,
      shape: draft.value,
    })
  }

  function onPointerUp(e: PointerEvent) {
    if (activePointer.current !== e.pointerId) return
    activePointer.current = null

    if (panStart.current) {
      panStart.current = null
      return
    }

    if (!draft.value) return
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const { worldX, worldY } = screenToWorld(e.clientX, e.clientY, rect, viewport.value)
    const handler = HANDLERS[draft.value.kind as Tool]
    const committed = handler.onPointerUp({
      worldX,
      worldY,
      pressure: e.pressure || 0.5,
      color: color.value,
      strokeWidth: strokeW.value,
      shape: draft.value,
    })

    if (committed && committed.kind === "text") {
      // Start text-input phase
      setEditingText({ shape: committed, value: "" })
      draft.value = null
      return
    }

    if (committed) commit(committed)
    draft.value = null
  }

  function onWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    viewport.value = zoomAt(cx, cy, factor, viewport.value)
  }

  function commitText() {
    if (!editingText) return
    const value = editingText.value.trim()
    if (value.length === 0) {
      setEditingText(null)
      return
    }
    commit({ ...editingText.shape, content: value })
    setEditingText(null)
  }

  function cancelText() {
    setEditingText(null)
  }

  // Render the text input overlay in screen coords
  const overlay = editingText
    ? (() => {
        const { shape } = editingText
        const { scale, panX, panY } = viewport.value
        const left = shape.x * scale + panX
        const top = shape.y * scale + panY
        const width = shape.w * scale
        const height = shape.h * scale
        return h(
          "textarea",
          {
            class: "ft-text-input",
            style: `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-size:${shape.fontSize * scale}px;color:${shape.color};resize:none;background:transparent;outline:2px solid ${shape.color};border:none;padding:2px;font-family:system-ui,-apple-system,sans-serif;overflow:hidden;`,
            autoFocus: true,
            onInput: (e: Event) =>
              setEditingText({
                ...editingText,
                value: (e.target as HTMLTextAreaElement).value,
              }),
            onBlur: commitText,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Escape") {
                e.preventDefault()
                cancelText()
              }
            },
          },
          editingText.value,
        )
      })()
    : null

  return h(
    "div",
    {
      ref: containerRef,
      class: "ft-canvas-container",
      style: "position:relative;flex-grow:1;overflow:hidden;background:#f0f0f0;",
    },
    h("canvas", {
      ref: canvasRef,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onWheel,
      style: "display:block;",
    }),
    overlay,
  )
}
```

- [ ] **Step 2: Sanity check — tsc compiles**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bunx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/annotation/canvas.tsx
git commit -m "feat(sdk-ui): add interactive Canvas with Pointer Events, pan, zoom, and text input overlay"
```

---

### Task 14: `tool-picker.tsx` — tool bar + palette + stroke slider + undo/redo/clear

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/annotation/tool-picker.tsx`

- [ ] **Step 1: Write `tool-picker.tsx`**

```tsx
// packages/ui/src/annotation/tool-picker.tsx
import { h } from "preact"
import { canRedo, canUndo, clear, color, redo, strokeW, tool, undo } from "./store"
import { PALETTE, STROKE_WIDTHS, type Tool } from "./types"

const TOOLS: Array<{ id: Tool; label: string; icon: string }> = [
  { id: "arrow", label: "Arrow (A)", icon: "↗" },
  { id: "rect", label: "Rectangle (R)", icon: "▢" },
  { id: "pen", label: "Pen (P)", icon: "✎" },
  { id: "highlight", label: "Highlight (H)", icon: "≡" },
  { id: "text", label: "Text (T)", icon: "T" },
]

export function ToolPicker() {
  const active = tool.value
  const activeColor = color.value
  const activeStroke = strokeW.value

  return h(
    "div",
    { class: "ft-tool-picker" },
    h(
      "div",
      { class: "ft-tool-group" },
      TOOLS.map((t) =>
        h(
          "button",
          {
            type: "button",
            class: `ft-tool ${active === t.id ? "active" : ""}`,
            "aria-label": t.label,
            "aria-pressed": active === t.id,
            title: t.label,
            onClick: () => {
              tool.value = t.id
            },
          },
          t.icon,
        ),
      ),
    ),
    h(
      "div",
      { class: "ft-tool-group" },
      PALETTE.map((c) =>
        h("button", {
          type: "button",
          class: `ft-swatch ${activeColor === c ? "active" : ""}`,
          style: `background:${c};`,
          "aria-label": `color ${c}`,
          onClick: () => {
            color.value = c
          },
        }),
      ),
    ),
    active !== "highlight" &&
      h(
        "div",
        { class: "ft-tool-group ft-stroke" },
        STROKE_WIDTHS.map((w) =>
          h(
            "button",
            {
              type: "button",
              class: `ft-stroke-dot ${activeStroke === w ? "active" : ""}`,
              "aria-label": `stroke ${w}`,
              onClick: () => {
                strokeW.value = w
              },
            },
            h("span", {
              style: `width:${w * 2}px;height:${w * 2}px;background:currentColor;border-radius:50%;display:inline-block;`,
            }),
          ),
        ),
      ),
    h(
      "div",
      { class: "ft-tool-group" },
      h(
        "button",
        {
          type: "button",
          class: "ft-tool",
          "aria-label": "Undo",
          title: "Undo (⌘Z)",
          disabled: !canUndo.value,
          onClick: undo,
        },
        "↶",
      ),
      h(
        "button",
        {
          type: "button",
          class: "ft-tool",
          "aria-label": "Redo",
          title: "Redo (⌘⇧Z)",
          disabled: !canRedo.value,
          onClick: redo,
        },
        "↷",
      ),
      h(
        "button",
        {
          type: "button",
          class: "ft-tool",
          "aria-label": "Clear all",
          title: "Clear",
          onClick: () => {
            if (confirm("Clear all annotations?")) clear()
          },
        },
        "🗑",
      ),
    ),
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/annotation/tool-picker.tsx
git commit -m "feat(sdk-ui): add tool picker (tools + palette + stroke + undo/redo/clear)"
```

---

### Task 15: `wizard/step-describe.tsx` — form step (reuses v0.2.0 patterns)

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/wizard/step-describe.tsx`

- [ ] **Step 1: Write the component**

```tsx
// packages/ui/src/wizard/step-describe.tsx
import { h } from "preact"
import { useState } from "preact/hooks"
import type { ReporterSubmitResult } from "../reporter"

interface Props {
  annotatedBlob: Blob | null
  onBack: () => void
  onCancel: () => void
  onSubmit: (payload: {
    title: string
    description: string
  }) => Promise<ReporterSubmitResult>
}

export function StepDescribe({ annotatedBlob, onBack, onCancel, onSubmit }: Props) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const previewUrl = annotatedBlob ? URL.createObjectURL(annotatedBlob) : null

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    setError(null)
    const res = await onSubmit({ title: title.trim(), description: description.trim() })
    setSubmitting(false)
    if (res.ok) {
      setSuccess(true)
    } else {
      setError(res.message ?? "Something went wrong.")
    }
  }

  return h(
    "div",
    { class: "ft-wizard" },
    h(
      "header",
      { class: "ft-wizard-header" },
      h("button", { type: "button", class: "ft-back", onClick: onBack, disabled: submitting }, "← Back"),
      h("h2", null, "Describe"),
      h("button", { type: "button", class: "ft-close", onClick: onCancel, "aria-label": "Close" }, "✕"),
    ),
    h(
      "form",
      { class: "ft-wizard-body ft-wizard-describe", onSubmit: handleSubmit },
      h(
        "div",
        { class: "ft-preview-wrap" },
        previewUrl
          ? h("a", { href: previewUrl, target: "_blank", rel: "noopener" },
              h("img", { src: previewUrl, alt: "annotated screenshot", class: "ft-preview-full" }))
          : h("div", { class: "ft-preview-placeholder" }, "No screenshot"),
      ),
      h(
        "div",
        { class: "ft-form" },
        h(
          "label",
          { class: "ft-field" },
          h("span", null, "Title"),
          h("input", {
            value: title,
            onInput: (e: Event) => setTitle((e.target as HTMLInputElement).value),
            maxLength: 120,
            required: true,
            disabled: submitting || success,
          }),
        ),
        h(
          "label",
          { class: "ft-field" },
          h("span", null, "What happened?"),
          h("textarea", {
            value: description,
            onInput: (e: Event) => setDescription((e.target as HTMLTextAreaElement).value),
            maxLength: 10000,
            rows: 6,
            disabled: submitting || success,
          }),
        ),
        error && h("div", { class: "ft-msg err" }, error),
        success && h("div", { class: "ft-msg ok" }, "Thanks! Report sent."),
        h(
          "div",
          { class: "ft-actions" },
          h(
            "button",
            { type: "button", class: "ft-btn", onClick: onCancel, disabled: submitting },
            "Cancel",
          ),
          h(
            "button",
            {
              type: "submit",
              class: "ft-btn primary",
              disabled: submitting || success || !title.trim(),
            },
            submitting ? "Sending…" : "Send report",
          ),
        ),
      ),
    ),
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/wizard/step-describe.tsx
git commit -m "feat(sdk-ui): add wizard step 2 (describe + annotated preview)"
```

---

### Task 16: `wizard/step-annotate.tsx`

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/wizard/step-annotate.tsx`

- [ ] **Step 1: Write the component**

```tsx
// packages/ui/src/wizard/step-annotate.tsx
import { h } from "preact"
import { useEffect } from "preact/hooks"
import { Canvas } from "../annotation/canvas"
import { fitTransform } from "../annotation/viewport"
import { flatten } from "../annotation/flatten"
import { registerShortcuts, DEFAULT_SHORTCUTS, type Action } from "../annotation/shortcuts"
import { clear, redo, shapes, tool, undo, viewport } from "../annotation/store"
import { ToolPicker } from "../annotation/tool-picker"
import type { Tool } from "../annotation/types"

interface Props {
  bg: HTMLImageElement
  onSkip: () => void
  onNext: (annotatedBlob: Blob) => void
  onCancel: () => void
}

export function StepAnnotate({ bg, onSkip, onNext, onCancel }: Props) {
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
        case "resetView":
          viewport.value = fitTransform(
            (bg as unknown as { naturalWidth?: number }).naturalWidth ?? bg.width,
            (bg as unknown as { naturalHeight?: number }).naturalHeight ?? bg.height,
            window.innerWidth,
            window.innerHeight,
          )
          return
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
    h(
      "header",
      { class: "ft-wizard-header" },
      h("h2", null, "Report a bug"),
      h("button", { type: "button", class: "ft-close", onClick: handleClose, "aria-label": "Close" }, "✕"),
    ),
    h("div", { class: "ft-wizard-body ft-wizard-annotate" }, h(Canvas, { bg })),
    h(
      "footer",
      { class: "ft-wizard-footer" },
      h(ToolPicker, null),
      h(
        "div",
        { class: "ft-wizard-next" },
        h("button", { type: "button", class: "ft-btn", onClick: onSkip }, "Skip"),
        h("button", { type: "button", class: "ft-btn primary", onClick: handleNext }, "Next →"),
      ),
    ),
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/wizard/step-annotate.tsx
git commit -m "feat(sdk-ui): add wizard step 1 (annotation canvas + tool picker + shortcuts)"
```

---

### Task 17: Replace `reporter.tsx` with the wizard shell + update `mount.ts` + styles

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/reporter.tsx`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/mount.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/styles.css`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/index.ts`

- [ ] **Step 1: Replace `reporter.tsx` with the wizard shell**

```tsx
// packages/ui/src/reporter.tsx
import { h } from "preact"
import { useEffect, useState } from "preact/hooks"
import { reset } from "./annotation/store"
import { StepAnnotate } from "./wizard/step-annotate"
import { StepDescribe } from "./wizard/step-describe"

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
  }) => Promise<ReporterSubmitResult>
}

export function Reporter({ onClose, onCapture, onSubmit }: ReporterProps) {
  const [bg, setBg] = useState<HTMLImageElement | null>(null)
  const [annotatedBlob, setAnnotatedBlob] = useState<Blob | null>(null)
  const [step, setStep] = useState<"annotate" | "describe">("annotate")
  const [rawScreenshot, setRawScreenshot] = useState<Blob | null>(null)
  const [captureFailed, setCaptureFailed] = useState(false)

  useEffect(() => {
    let url: string | null = null
    ;(async () => {
      const blob = await onCapture()
      if (!blob) {
        setCaptureFailed(true)
        return
      }
      setRawScreenshot(blob)
      url = URL.createObjectURL(blob)
      const img = new Image()
      img.onload = () => setBg(img)
      img.src = url
    })()
    return () => {
      if (url) URL.revokeObjectURL(url)
      reset()
    }
  }, [])

  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = ""
    }
  }, [])

  function handleCancel() {
    onClose()
  }

  async function handleNext(blob: Blob) {
    setAnnotatedBlob(blob)
    setStep("describe")
  }

  function handleSkip() {
    setAnnotatedBlob(rawScreenshot)
    setStep("describe")
  }

  function handleBack() {
    setStep("annotate")
  }

  async function handleSubmit(payload: { title: string; description: string }) {
    const result = await onSubmit({ ...payload, screenshot: annotatedBlob })
    if (result.ok) {
      setTimeout(onClose, 1500)
    }
    return result
  }

  if (captureFailed) {
    // Fallback — no screenshot available; use a minimal describe-only flow.
    return h(StepDescribe, {
      annotatedBlob: null,
      onBack: handleCancel,
      onCancel: handleCancel,
      onSubmit: async ({ title, description }) => handleSubmit({ title, description }),
    })
  }

  if (!bg) {
    return h("div", { class: "ft-wizard-loading" }, "Capturing…")
  }

  if (step === "annotate") {
    return h(StepAnnotate, {
      bg,
      onSkip: handleSkip,
      onNext: handleNext,
      onCancel: handleCancel,
    })
  }

  return h(StepDescribe, {
    annotatedBlob,
    onBack: handleBack,
    onCancel: handleCancel,
    onSubmit: async ({ title, description }) => handleSubmit({ title, description }),
  })
}
```

- [ ] **Step 2: Update `packages/ui/src/mount.ts`'s `MountOptions.onSubmit` signature**

Replace the existing `MountOptions` and `App` (see the relevant section only; rest of file unchanged):

```ts
// packages/ui/src/mount.ts  (REPLACEMENT — full file)
import { h, render } from "preact"
import { useState } from "preact/hooks"
import { Launcher } from "./launcher"
import { Reporter, type ReporterSubmitResult } from "./reporter"
import { createShadowHost, injectStyles, unmountShadowHost } from "./shadow"
// @ts-ignore — tsdown bundles this as a string via { ".css": "text" } loader
import cssText from "./styles.css" with { type: "text" }

export interface MountOptions {
  config: {
    position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
    launcher: boolean
  }
  capture: () => Promise<Blob | null>
  onSubmit: (payload: {
    title: string
    description: string
    screenshot: Blob | null
  }) => Promise<ReporterSubmitResult>
}

let _setOpenExternal: ((v: boolean) => void) | null = null
let _capture: () => Promise<Blob | null> = async () => null
let _onSubmit: MountOptions["onSubmit"] = async () => ({
  ok: false,
  message: "not mounted",
})
let _position: MountOptions["config"]["position"] = "bottom-right"
let _launcher = true
let _root: ShadowRoot | null = null
let _container: HTMLElement | null = null

function App() {
  const [isOpen, setOpen] = useState(false)
  _setOpenExternal = setOpen
  return h(
    "div",
    null,
    _launcher
      ? h(Launcher, { position: _position, onClick: () => setOpen(true) })
      : null,
    isOpen
      ? h(Reporter, {
          onClose: () => setOpen(false),
          onCapture: _capture,
          onSubmit: _onSubmit,
        })
      : null,
  )
}

export function mount(opts: MountOptions) {
  _position = opts.config.position
  _launcher = opts.config.launcher
  _capture = opts.capture
  _onSubmit = opts.onSubmit
  _root = createShadowHost()
  injectStyles(_root, cssText as unknown as string)
  _container = document.createElement("div")
  _root.appendChild(_container)
  render(h(App, null), _container)
}

export function open() {
  _setOpenExternal?.(true)
}

export function close() {
  _setOpenExternal?.(false)
}

export function unmount() {
  if (_container) render(null, _container)
  unmountShadowHost()
  _container = null
  _root = null
  _setOpenExternal = null
}
```

- [ ] **Step 3: Update `packages/core/src/index.ts` to pass the screenshot through**

Replace the `onSubmit` wiring in `init()`. Full file:

```ts
// packages/core/src/index.ts
import type { ReporterIdentity } from "@feedback-tool/shared"
import { close as uiClose, mount, open as uiOpen, unmount } from "@feedback-tool/ui"
import { resolveConfig, type InitOptions, type ResolvedConfig } from "./config"
import { gatherContext } from "./context"
import { capture } from "./screenshot"
import { postReport } from "./intake-client"

let _config: ResolvedConfig | null = null
let _reporter: ReporterIdentity | null = null
let _mounted = false

export function init(options: InitOptions): void {
  const cfg = resolveConfig(options)
  _config = cfg
  if (_mounted) unmount()
  mount({
    config: { position: cfg.position, launcher: cfg.launcher },
    capture,
    onSubmit: async ({ title, description, screenshot }) => {
      if (!_config) return { ok: false, message: "Not initialized" }
      const context = gatherContext(_reporter, _config.metadata)
      const result = await postReport(_config, {
        title,
        description,
        context,
        metadata: _config.metadata,
        screenshot,
      })
      return result.ok ? { ok: true } : { ok: false, message: result.message }
    },
  })
  _mounted = true
}

export function open(): void {
  if (!_config) throw new Error("FeedbackTool.open called before init")
  uiOpen()
}

export function close(): void {
  uiClose()
}

export function identify(reporter: ReporterIdentity | null): void {
  _reporter = reporter
}

export function _unmount(): void {
  if (_mounted) unmount()
  _mounted = false
  _config = null
  _reporter = null
}
```

- [ ] **Step 4: Expand `packages/ui/src/styles.css`**

Append to the existing CSS (keep everything already there for the launcher; add wizard + canvas + tool picker styles):

```css
/* === Wizard === */
.ft-wizard {
  position: fixed;
  inset: 0;
  z-index: 2147483641;
  background: #fff;
  color: #111;
  display: flex;
  flex-direction: column;
  font-family: system-ui, -apple-system, sans-serif;
}
.ft-wizard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 48px;
  background: #111;
  color: #fff;
  border-bottom: 1px solid #000;
}
.ft-wizard-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.ft-wizard-header .ft-close,
.ft-wizard-header .ft-back {
  background: transparent;
  border: 0;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
}
.ft-wizard-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.ft-wizard-annotate {
  background: #f4f4f4;
}
.ft-wizard-describe {
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: 16px;
  padding: 24px;
  overflow: auto;
}
@media (max-width: 900px) {
  .ft-wizard-describe {
    grid-template-columns: 1fr;
  }
}
.ft-preview-wrap {
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
.ft-preview-full {
  max-width: 100%;
  max-height: 80vh;
  border: 1px solid #eee;
  border-radius: 8px;
}
.ft-preview-placeholder {
  padding: 24px;
  background: #f0f0f0;
  border-radius: 8px;
  color: #888;
}
.ft-form {
  display: flex;
  flex-direction: column;
}
.ft-wizard-footer {
  background: #f8f8f8;
  border-top: 1px solid #e0e0e0;
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.ft-wizard-next {
  display: flex;
  gap: 8px;
}
.ft-wizard-loading {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  z-index: 2147483641;
  font-family: system-ui, -apple-system, sans-serif;
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
  width: 34px;
  height: 34px;
  border: 1px solid #ddd;
  background: #fff;
  color: #111;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ft-tool:hover {
  background: #f0f0f0;
}
.ft-tool.active {
  background: #111;
  color: #fff;
  border-color: #111;
}
.ft-tool[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}
.ft-swatch {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}
.ft-swatch.active {
  border-color: #111;
  transform: scale(1.1);
}
.ft-stroke {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 0 6px;
  height: 34px;
}
.ft-stroke-dot {
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  color: #888;
}
.ft-stroke-dot.active {
  color: #111;
}

/* === Canvas container === */
.ft-canvas-container canvas {
  cursor: crosshair;
  touch-action: none;
}
.ft-text-input {
  box-sizing: border-box;
}
```

- [ ] **Step 5: Build and verify size**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run sdk:build 2>&1 | tail -5
wc -c packages/core/dist/feedback-tool.iife.js
gzip -c packages/core/dist/feedback-tool.iife.js | wc -c
```
Expected: raw size < 80 KB, gzipped < 30 KB. Report actual values in your summary.

- [ ] **Step 6: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/reporter.tsx packages/ui/src/mount.ts packages/ui/src/styles.css packages/core/src/index.ts
git commit -m "feat(sdk-ui): replace Reporter with two-step wizard; widen onSubmit with screenshot"
```

---

## Phase 6 — Integration test + verification

### Task 18: `wizard/step-annotate.test.ts` — pointer-flow integration test

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/wizard/step-annotate.test.ts`

- [ ] **Step 1: Write the test**

```ts
// packages/ui/src/wizard/step-annotate.test.ts
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { h, render } from "preact"
import { reset, shapes, tool } from "../annotation/store"
import { StepAnnotate } from "./step-annotate"

let bg: HTMLImageElement

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window()
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    HTMLCanvasElement: win.HTMLCanvasElement,
    Image: win.Image,
    PointerEvent: win.PointerEvent ?? win.MouseEvent,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  })
  // Use a canvas as the stand-in for HTMLImageElement — render() accepts both.
  const c = document.createElement("canvas")
  c.width = 400
  c.height = 300
  Object.defineProperty(c, "naturalWidth", { value: 400 })
  Object.defineProperty(c, "naturalHeight", { value: 300 })
  bg = c as unknown as HTMLImageElement
})

beforeEach(() => {
  reset()
  document.body.innerHTML = ""
})

function mountStep() {
  const host = document.createElement("div")
  Object.defineProperty(host, "clientWidth", { value: 800, configurable: true })
  Object.defineProperty(host, "clientHeight", { value: 600, configurable: true })
  document.body.appendChild(host)
  render(
    h(StepAnnotate, {
      bg,
      onSkip: () => {},
      onNext: () => {},
      onCancel: () => {},
    }),
    host,
  )
  return host
}

function fireDrag(canvas: HTMLCanvasElement, fromX: number, fromY: number, toX: number, toY: number) {
  const mkEvt = (type: string, x: number, y: number) => {
    const e = new Event(type, { bubbles: true }) as PointerEvent & Event
    Object.assign(e, { clientX: x, clientY: y, pointerId: 1, button: 0, pressure: 0.5 })
    return e
  }
  canvas.dispatchEvent(mkEvt("pointerdown", fromX, fromY))
  canvas.dispatchEvent(mkEvt("pointermove", toX, toY))
  canvas.dispatchEvent(mkEvt("pointerup", toX, toY))
}

describe("step-annotate pointer flows", () => {
  test("arrow tool: drag commits one arrow", () => {
    const host = mountStep()
    const canvas = host.querySelector("canvas")!
    tool.value = "arrow"
    fireDrag(canvas, 100, 100, 300, 200)
    expect(shapes.value).toHaveLength(1)
    expect(shapes.value[0].kind).toBe("arrow")
  })

  test("rect tool: drag commits one rect", () => {
    const host = mountStep()
    const canvas = host.querySelector("canvas")!
    tool.value = "rect"
    fireDrag(canvas, 100, 100, 300, 300)
    expect(shapes.value).toHaveLength(1)
    expect(shapes.value[0].kind).toBe("rect")
  })

  test("pen tool: drag commits one pen stroke", () => {
    const host = mountStep()
    const canvas = host.querySelector("canvas")!
    tool.value = "pen"
    fireDrag(canvas, 100, 100, 300, 200)
    expect(shapes.value).toHaveLength(1)
    expect(shapes.value[0].kind).toBe("pen")
  })

  test("highlight tool: drag commits one highlight", () => {
    const host = mountStep()
    const canvas = host.querySelector("canvas")!
    tool.value = "highlight"
    fireDrag(canvas, 100, 100, 300, 200)
    expect(shapes.value).toHaveLength(1)
    expect(shapes.value[0].kind).toBe("highlight")
  })

  test("text tool: drag opens a <textarea> and does not commit until blur", () => {
    const host = mountStep()
    const canvas = host.querySelector("canvas")!
    tool.value = "text"
    fireDrag(canvas, 100, 100, 300, 200)
    expect(shapes.value).toHaveLength(0)
    const ta = host.querySelector("textarea")
    expect(ta).not.toBeNull()
  })
})
```

- [ ] **Step 2: Confirm the test passes**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/wizard/step-annotate.test.ts
```
Expected: 5 tests PASS. (If happy-dom's PointerEvent is missing, the shim in the test falls back to MouseEvent-typed events; Canvas component reads `clientX`/`clientY`/`pointerId` which both provide.)

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/wizard/step-annotate.test.ts
git commit -m "test(sdk-ui): add pointer-flow integration tests for each annotation tool"
```

---

### Task 19: End-to-end manual smoke + tag

**Files:** none.

- [ ] **Step 1: Rebuild the SDK and restart everything**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run sdk:build 2>&1 | tail -3
lsof -ti:3000,3002,4000 | xargs -r kill -9 2>/dev/null
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_attachments, reports RESTART IDENTITY CASCADE" >/dev/null
rm -rf apps/dashboard/.data/attachments
bun run dev > /tmp/c-dash.log 2>&1 &
sleep 22
```

- [ ] **Step 2: Run the full automated suite**

```bash
(cd apps/dashboard && bun test 2>&1 | tail -5)
(cd packages/ui && bun test 2>&1 | tail -5)
(cd packages/core && bun test 2>&1 | tail -5)
```
Expected:
- `apps/dashboard`: 45+ tests pass.
- `packages/ui`: ≥ 37 new tests pass (shortcuts 5 + viewport 9 + store 7 + text-wrap 6 + render 6 + flatten 2 + arrow 4 + rect 4 + pen 5 + highlight 3 + text 2 + step-annotate 5).
- `packages/core`: 10 existing tests pass.

- [ ] **Step 3: Lint + format**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool && bun run check
```
Expected: 0 errors.

- [ ] **Step 4: Check bundle budget**

```bash
wc -c packages/core/dist/feedback-tool.iife.js
gzip -c packages/core/dist/feedback-tool.iife.js | wc -c
```
Expected: raw ≤ 80 KB, gzipped ≤ 30 KB.

- [ ] **Step 5: Manual laptop smoke (Chrome)**

In a browser:
1. Start the demo on :3002 if not already: `bun --filter demo dev`. Sign in to the dashboard, paste the demo's project publicKey into `apps/demo/app/app.vue` (or `FT_DEMO_KEY` env), ensure `http://localhost:3002` is in the project's allowed origins.
2. Visit `http://localhost:3002`. The launcher bubble appears bottom-right.
3. Click it → **step 1 (annotate)** opens full-screen. The demo page is captured and letterboxed into the canvas.
4. Press `A` → arrow tool; draw an arrow. Press `R` → rect; outline a card. Press `H` → highlight; sweep over the noisy console area. Press `P` → pen; scribble a circle. Press `T` → text; drag a small box, type "expected: worked", click outside to commit.
5. Press `⌘Z` five times → every shape disappears in reverse order. Press `⌘⇧Z` five times → they return.
6. Draw a sixth shape. Press `⌘⇧Z` → no-op (redo stack cleared).
7. Hold `Cmd` + scroll trackpad over the canvas → zooms toward cursor, clamped to 25–400%. Hold `Space` + drag → pans the canvas.
8. Click **Next →** → step 2 opens with the flattened PNG on the left and a form on the right.
9. Click **← Back** → step 1 returns with all shapes still on the canvas.
10. Click **Next →** again; fill title "C wizard smoke", description "multi-line\nsecond line". Click **Send report**. Modal closes with "Thanks!" flash.
11. In the dashboard, open the Demo project → **Reports** tab. The new report appears with a thumbnail matching the annotated screenshot (five shape types visible).

- [ ] **Step 6: Tag**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git tag -a v0.3.0-annotation -m "Sub-project C complete: annotation canvas

Full-screen two-step wizard replacing the v0.2.0-sdk centered modal.
Five tools — arrow, rect, pen, highlight, text — with fixed 5-swatch
palette + 4 stroke widths, undo/redo/clear, fit-by-default canvas with
Cmd/Ctrl-scroll zoom + drag-to-pan, Pointer Events for unified mouse/
touch/stylus, Apple Pencil pressure on pen strokes, remappable
shortcuts.

Eager flatten on Next → PNG at screenshot-native resolution, submitted
through the existing intake endpoint without API changes.

Known follow-up: mobile soft-keyboard interactions on Android and
shape-selection/editing are deferred."
git tag | tail -3
```

---

## Self-Review

### Spec coverage

| Spec §  | Task(s) |
| ---     | --- |
| §3 architecture (packages) | Tasks 1 (types), 13 (canvas), 14 (tool picker), 15–17 (wizard + reporter shell + mount diff) |
| §4.1 Shape union | Task 1 |
| §4.2 store signals + commit/undo/redo/clear/reset | Task 4 |
| §5.1 pure `render()` | Task 6 |
| §5.2 `flatten()` | Task 7 |
| §5.3 HiDPI handling | Task 13 (DPR sync effect) |
| §6 tool interface + five tools | Tasks 8–12 |
| §6.3 text wrap | Task 5 |
| §7.1 pointer arbitration | Task 13 |
| §7.2 pan clamp | Tasks 3 (clampPan) + 13 (wired) |
| §7.3 zoomAt + invariant | Task 3 |
| §7.4 viewport helpers | Task 3 |
| §7.5 shortcut map | Task 2 |
| §8.1 step 1 layout | Task 16 |
| §8.2 step 2 layout | Task 15 |
| §8.3 cross-step (scroll lock, focus trap, store reset) | Task 17 |
| §9 mount diff (onSubmit widens) | Task 17 |
| §10 unit + integration tests | Tasks 2, 3, 4, 5, 6, 7, 8–12, 18 |
| §11 definition of done | Task 19 |

### Placeholder scan

No "TBD", "implement later", or silent steps. Every code step contains complete source. The `// Note: we keep x/y fixed at origin...` comment in `rect.ts` explains the rationale for deferring normalization; the behavior is still fully specified by the accompanying test.

### Type consistency

Cross-task names verified: `Shape` / `ShapeBase` / `Tool` / `Transform` / `IDENTITY_TRANSFORM` / `PALETTE` / `STROKE_WIDTHS` / `ArrowShape` / `RectShape` / `PenShape` / `HighlightShape` / `TextShape` / `ToolContext` / `ToolHandler` / `ReporterSubmitResult` / `MountOptions` — all defined once (Tasks 1 and 8) and imported consistently thereafter. `commit` / `undo` / `redo` / `clear` / `reset` / `newShapeId` exported from `store.ts` (Task 4) and consumed by `canvas.tsx` (Task 13) and the tools (Tasks 8–12). `onSubmit` payload gains `screenshot: Blob | null` in Task 17 and the core adapter is updated in the same task — no drift.

### One tradeoff worth flagging

The `canvas.tsx` file in Task 13 is ~250 lines — bigger than I'd like. It owns pointer arbitration, the draw loop, the fit/DPR effects, and the text-input overlay. Splitting would help readability but would scatter the draft-vs-commit logic across files. If it grows further (e.g. pinch-to-zoom, stylus palm rejection), factor the text overlay into its own component first.
