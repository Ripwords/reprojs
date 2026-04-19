# Session Replay Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the last 30 seconds of DOM activity in the SDK, gzip it, upload as a new `replay` attachment, and play it back in the dashboard via `rrweb-player`.

**Architecture:** New framework-agnostic `packages/recorder` emits rrweb-compatible events into a rolling 30s ring buffer (size-capped at 4 MB raw). On submit, the buffer is flushed, JSON-stringified, gzipped via native `CompressionStream`, and posted as a new multipart `replay` part. Dashboard intake persists it as a `report_attachments` row with `kind='replay'`; the drawer's Replay tab lazy-imports `rrweb-player` and decompresses client-side. Per-project and per-deployment disable with silent-drop semantics (201 with `replayDisabled: true` signal).

**Tech Stack:** TypeScript (strict), Bun + tsdown for the SDK package, `CompressionStream`/`DecompressionStream` (native), rrweb-schema-compatible event shape (hand-written subset — no `rrweb` runtime dep in the SDK), `rrweb-player` as a dashboard-only dep, Drizzle + Postgres, Zod, Nuxt 4 + Nitro, Vue 3, Tailwind v4.

**Reference spec:** `docs/superpowers/specs/2026-04-18-session-replay-design.md`

**Scope note:** This plan targets a minimum-viable recorder with enough fidelity for bug-report playback (FullSnapshot + Mutations + Input + MouseInteraction + Scroll + Meta + ViewportResize). Mouse-move trails, canvas/WebGL, iframe capture, and shadow-DOM exotica are explicitly out of scope for v1 (§9 of the spec).

---

## File map

```
packages/recorder/                                     CREATE — new workspace package
├── package.json
├── tsconfig.json
├── tsdown.config.ts
└── src/
    ├── types.ts                                       rrweb-compat event shapes
    ├── buffer.ts                                      size+time-bounded ring buffer
    ├── mask.ts                                        masking predicate + config
    ├── compress.ts                                    gzip flush + truncate loop
    ├── mirror.ts                                      DOM node → id map (shared state)
    ├── serialize.ts                                   Node → SerializedNode
    ├── observers/
    │   ├── full-snapshot.ts                           initial DOM serialization
    │   ├── mutation.ts                                MutationObserver wrapper
    │   ├── input.ts                                   input event listener
    │   ├── mouse-interaction.ts                       click/focus/blur
    │   ├── scroll.ts                                  scroll events
    │   ├── viewport.ts                                resize + Meta event
    │   └── index.ts                                   barrel
    ├── record.ts                                      orchestrator + public API
    └── index.ts                                       public re-exports

packages/ui/src/collectors/
├── replay.ts                                          ADAPTER: wraps Recorder into collector shape
└── index.ts                                           MODIFY: include replayBytes in snapshotAll

packages/core/src/
└── intake-client.ts                                   MODIFY: accept + attach replay part

packages/shared/src/reports.ts                         MODIFY: add replayDisabled to IntakeResponse

apps/dashboard/server/
├── db/schema/
│   ├── reports.ts                                     MODIFY: add 'replay' to kind enum (already present — verify)
│   └── projects.ts                                    MODIFY: add replayEnabled boolean
├── lib/env.ts                                         MODIFY: REPLAY_FEATURE_ENABLED + INTAKE_REPLAY_MAX_BYTES
└── api/intake/reports.ts                              MODIFY: handle replay part

apps/dashboard/app/components/report-drawer/
├── drawer.vue                                         MODIFY: add Replay tab
└── replay-tab.vue                                     CREATE — lazy-load rrweb-player

apps/dashboard/app/pages/projects/[id]/settings/
└── index.vue                                          MODIFY: toggle replayEnabled

apps/dashboard/package.json                            MODIFY: add rrweb-player dep
```

**Tested side-by-side convention:** `foo.ts` + `foo.test.ts` in the same directory. Unit tests use `bun test`; integration tests under `apps/dashboard/tests/` hit a real Postgres + real dev server.

---

## Task 1: Scaffold `packages/recorder`

**Files:**
- Create: `packages/recorder/package.json`
- Create: `packages/recorder/tsconfig.json`
- Create: `packages/recorder/tsdown.config.ts`
- Create: `packages/recorder/src/index.ts`

- [ ] **Step 1: Create `packages/recorder/package.json`**

```json
{
  "name": "@feedback-tool/recorder",
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
    "build": "tsdown",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@feedback-tool/shared": "*"
  },
  "devDependencies": {
    "@types/bun": "^1.3.12",
    "happy-dom": "^20.0.0",
    "tsdown": "^0.17.2",
    "typescript": "^5.9.2"
  }
}
```

- [ ] **Step 2: Create `packages/recorder/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "lib": ["ES2022", "DOM"],
    "types": ["bun"],
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/recorder/tsdown.config.ts`**

```ts
import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
})
```

- [ ] **Step 4: Stub `packages/recorder/src/index.ts`**

```ts
// Public API — populated by later tasks.
export {}
```

- [ ] **Step 5: Install and verify**

```bash
bun install
```

Expected: workspace resolves `@feedback-tool/recorder`; no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/recorder
git commit -m "feat(recorder): scaffold package"
```

---

## Task 2: Event type definitions (rrweb-compatible)

**Files:**
- Create: `packages/recorder/src/types.ts`

- [ ] **Step 1: Create `packages/recorder/src/types.ts`** — rrweb-compatible subset

```ts
// rrweb-compatible event shapes. We hand-write the subset we emit so the SDK
// doesn't depend on the rrweb runtime. The dashboard uses rrweb-player, which
// expects exactly these numeric tags and field names.

export const EventType = {
  DomContentLoaded: 0,
  Load: 1,
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5,
} as const
export type EventType = (typeof EventType)[keyof typeof EventType]

export const IncrementalSource = {
  Mutation: 0,
  MouseMove: 1,
  MouseInteraction: 2,
  Scroll: 3,
  ViewportResize: 4,
  Input: 5,
} as const
export type IncrementalSource = (typeof IncrementalSource)[keyof typeof IncrementalSource]

export const NodeType = {
  Document: 0,
  DocumentType: 1,
  Element: 2,
  Text: 3,
  CDATA: 4,
  Comment: 5,
} as const
export type NodeType = (typeof NodeType)[keyof typeof NodeType]

export interface DocumentNode {
  type: typeof NodeType.Document
  id: number
  childNodes: SerializedNode[]
}

export interface DocumentTypeNode {
  type: typeof NodeType.DocumentType
  id: number
  name: string
  publicId: string
  systemId: string
}

export interface ElementNode {
  type: typeof NodeType.Element
  id: number
  tagName: string
  attributes: Record<string, string | number | boolean>
  childNodes: SerializedNode[]
  isSVG?: true
  needBlock?: true
}

export interface TextNode {
  type: typeof NodeType.Text
  id: number
  textContent: string
  isStyle?: true
}

export interface CommentNode {
  type: typeof NodeType.Comment
  id: number
  textContent: string
}

export type SerializedNode = DocumentNode | DocumentTypeNode | ElementNode | TextNode | CommentNode

export interface MetaEvent {
  type: typeof EventType.Meta
  data: { href: string; width: number; height: number }
  timestamp: number
}

export interface FullSnapshotEvent {
  type: typeof EventType.FullSnapshot
  data: { node: SerializedNode; initialOffset: { left: number; top: number } }
  timestamp: number
}

export interface MutationData {
  source: typeof IncrementalSource.Mutation
  adds: Array<{ parentId: number; nextId: number | null; node: SerializedNode }>
  removes: Array<{ parentId: number; id: number }>
  texts: Array<{ id: number; value: string }>
  attributes: Array<{ id: number; attributes: Record<string, string | null> }>
}

export interface MouseInteractionData {
  source: typeof IncrementalSource.MouseInteraction
  type: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 // MouseUp, MouseDown, Click, ContextMenu, DblClick, Focus, Blur, TouchStart, TouchMove_Departed, TouchEnd
  id: number
  x: number
  y: number
}

export interface ScrollData {
  source: typeof IncrementalSource.Scroll
  id: number
  x: number
  y: number
}

export interface ViewportResizeData {
  source: typeof IncrementalSource.ViewportResize
  width: number
  height: number
}

export interface InputData {
  source: typeof IncrementalSource.Input
  id: number
  text: string
  isChecked: boolean
  userTriggered?: boolean
}

export type IncrementalData =
  | MutationData
  | MouseInteractionData
  | ScrollData
  | ViewportResizeData
  | InputData

export interface IncrementalSnapshotEvent {
  type: typeof EventType.IncrementalSnapshot
  data: IncrementalData
  timestamp: number
}

export interface CustomEvent {
  type: typeof EventType.Custom
  data: { tag: string; payload: Record<string, unknown> }
  timestamp: number
}

export type RecorderEvent =
  | MetaEvent
  | FullSnapshotEvent
  | IncrementalSnapshotEvent
  | CustomEvent
```

- [ ] **Step 2: Export from `packages/recorder/src/index.ts`**

```ts
export * from "./types"
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/recorder && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/recorder
git commit -m "feat(recorder): rrweb-compatible event type definitions"
```

---

## Task 3: Byte-and-time-bounded buffer

**Files:**
- Create: `packages/recorder/src/buffer.ts`
- Create: `packages/recorder/src/buffer.test.ts`

- [ ] **Step 1: Write failing tests** — `packages/recorder/src/buffer.test.ts`

```ts
import { describe, expect, test } from "bun:test"
import { EventBuffer } from "./buffer"
import { EventType, type RecorderEvent } from "./types"

function metaEvent(ts: number, size: number): RecorderEvent {
  return {
    type: EventType.Meta,
    data: { href: "x".repeat(size), width: 800, height: 600 },
    timestamp: ts,
  }
}

describe("EventBuffer", () => {
  test("push then flush returns events chronologically and clears state", () => {
    const buf = new EventBuffer({ windowMs: 30_000, maxBytes: 1_000_000 })
    buf.push(metaEvent(100, 10))
    buf.push(metaEvent(200, 10))
    const out = buf.flush()
    expect(out.map((e) => e.timestamp)).toEqual([100, 200])
    expect(buf.flush()).toEqual([])
  })

  test("evicts events older than windowMs on push", () => {
    const buf = new EventBuffer({ windowMs: 100, maxBytes: 1_000_000, now: () => 1_000 })
    buf.push(metaEvent(850, 10)) // 150ms old — evicted at push time
    buf.push(metaEvent(950, 10)) // 50ms old — kept
    expect(buf.flush().map((e) => e.timestamp)).toEqual([950])
  })

  test("evicts oldest events when total bytes exceeds maxBytes", () => {
    const buf = new EventBuffer({ windowMs: 30_000, maxBytes: 200 })
    // Each event serializes to ~80 bytes once we pack in the href string of 50 chars.
    buf.push(metaEvent(100, 50))
    buf.push(metaEvent(200, 50))
    buf.push(metaEvent(300, 50)) // third push triggers eviction of the oldest
    const out = buf.flush()
    expect(out.length).toBeLessThan(3)
    expect(out[0]?.timestamp).not.toBe(100)
  })

  test("push during iteration of flush snapshot does not mutate the snapshot", () => {
    const buf = new EventBuffer({ windowMs: 30_000, maxBytes: 1_000_000 })
    buf.push(metaEvent(100, 10))
    const snapshot = buf.flush()
    buf.push(metaEvent(200, 10))
    expect(snapshot.length).toBe(1)
    expect(snapshot[0]?.timestamp).toBe(100)
  })

  test("peek returns copy without clearing", () => {
    const buf = new EventBuffer({ windowMs: 30_000, maxBytes: 1_000_000 })
    buf.push(metaEvent(100, 10))
    expect(buf.peek().length).toBe(1)
    expect(buf.peek().length).toBe(1)
  })

  test("truncateOldest removes N oldest events", () => {
    const buf = new EventBuffer({ windowMs: 30_000, maxBytes: 1_000_000 })
    buf.push(metaEvent(100, 10))
    buf.push(metaEvent(200, 10))
    buf.push(metaEvent(300, 10))
    buf.truncateOldest(2)
    expect(buf.peek().map((e) => e.timestamp)).toEqual([300])
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd packages/recorder && bun test src/buffer.test.ts`
Expected: FAIL with "Cannot find module './buffer'".

- [ ] **Step 3: Implement `packages/recorder/src/buffer.ts`**

```ts
import type { RecorderEvent } from "./types"

export interface BufferOptions {
  /** Maximum time window in ms to retain (events older than now - windowMs are dropped on push). */
  windowMs: number
  /** Maximum total serialized-byte cost; oldest events evicted when exceeded. */
  maxBytes: number
  /** Clock injection for tests. */
  now?: () => number
}

interface Entry {
  event: RecorderEvent
  bytes: number
}

/**
 * Ring buffer with two eviction triggers:
 *   1. Time: any event with timestamp < (now - windowMs) is dropped on push.
 *   2. Size: when totalBytes > maxBytes, evict oldest entries until back under.
 *
 * Byte cost is estimated via JSON.stringify length at push time — accurate
 * enough for budgeting without paying the cost twice (we re-stringify at flush).
 */
export class EventBuffer {
  private entries: Entry[] = []
  private totalBytes = 0
  private readonly windowMs: number
  private readonly maxBytes: number
  private readonly now: () => number

  constructor(opts: BufferOptions) {
    this.windowMs = opts.windowMs
    this.maxBytes = opts.maxBytes
    this.now = opts.now ?? Date.now
  }

  push(event: RecorderEvent): void {
    const bytes = estimateBytes(event)
    this.entries.push({ event, bytes })
    this.totalBytes += bytes
    this.evictOldTimestamps()
    this.evictToFitSize()
  }

  private evictOldTimestamps(): void {
    const cutoff = this.now() - this.windowMs
    while (this.entries.length > 0) {
      const first = this.entries[0]
      if (!first || first.event.timestamp >= cutoff) return
      this.totalBytes -= first.bytes
      this.entries.shift()
    }
  }

  private evictToFitSize(): void {
    while (this.totalBytes > this.maxBytes && this.entries.length > 0) {
      const first = this.entries.shift()
      if (first) this.totalBytes -= first.bytes
    }
  }

  flush(): RecorderEvent[] {
    const out = this.entries.map((e) => e.event)
    this.entries = []
    this.totalBytes = 0
    return out
  }

  peek(): RecorderEvent[] {
    return this.entries.map((e) => e.event)
  }

  truncateOldest(n: number): void {
    const cut = Math.min(n, this.entries.length)
    for (let i = 0; i < cut; i++) {
      const first = this.entries.shift()
      if (first) this.totalBytes -= first.bytes
    }
  }

  size(): number {
    return this.entries.length
  }

  bytes(): number {
    return this.totalBytes
  }
}

function estimateBytes(event: RecorderEvent): number {
  try {
    return JSON.stringify(event).length
  } catch {
    return 0
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd packages/recorder && bun test src/buffer.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/buffer.ts packages/recorder/src/buffer.test.ts
git commit -m "feat(recorder): size+time-bounded event buffer with eviction"
```

---

## Task 4: Masking config + predicate

**Files:**
- Create: `packages/recorder/src/mask.ts`
- Create: `packages/recorder/src/mask.test.ts`

- [ ] **Step 1: Write failing tests** — `packages/recorder/src/mask.test.ts`

```ts
import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { createMask } from "./mask"

function withDOM(html: string, fn: (doc: Document) => void): void {
  const win = new Window({ url: "http://localhost/" })
  win.document.body.innerHTML = html
  fn(win.document as unknown as Document)
}

describe("createMask", () => {
  test("moderate masks password, email, tel, number inputs but not text/textarea", () => {
    withDOM(
      `<input type=password id=p><input type=email id=e><input type=tel id=t><input type=number id=n><input type=text id=x><textarea id=ta></textarea>`,
      (doc) => {
        const mask = createMask({ masking: "moderate" })
        expect(mask.shouldMaskInput(doc.getElementById("p") as HTMLInputElement)).toBe(true)
        expect(mask.shouldMaskInput(doc.getElementById("e") as HTMLInputElement)).toBe(true)
        expect(mask.shouldMaskInput(doc.getElementById("t") as HTMLInputElement)).toBe(true)
        expect(mask.shouldMaskInput(doc.getElementById("n") as HTMLInputElement)).toBe(true)
        expect(mask.shouldMaskInput(doc.getElementById("x") as HTMLInputElement)).toBe(false)
        expect(
          mask.shouldMaskInput(doc.getElementById("ta") as unknown as HTMLInputElement),
        ).toBe(false)
      },
    )
  })

  test("strict masks all input/textarea/select", () => {
    withDOM(`<input type=text id=x><textarea id=ta></textarea><select id=s></select>`, (doc) => {
      const mask = createMask({ masking: "strict" })
      expect(mask.shouldMaskInput(doc.getElementById("x") as HTMLInputElement)).toBe(true)
      expect(mask.shouldMaskInput(doc.getElementById("ta") as unknown as HTMLInputElement)).toBe(
        true,
      )
      expect(mask.shouldMaskInput(doc.getElementById("s") as unknown as HTMLInputElement)).toBe(
        true,
      )
    })
  })

  test("minimal masks only password + data-feedback-mask", () => {
    withDOM(
      `<input type=password id=p><input type=email id=e><input type=text id=m data-feedback-mask>`,
      (doc) => {
        const mask = createMask({ masking: "minimal" })
        expect(mask.shouldMaskInput(doc.getElementById("p") as HTMLInputElement)).toBe(true)
        expect(mask.shouldMaskInput(doc.getElementById("e") as HTMLInputElement)).toBe(false)
        expect(mask.shouldMaskInput(doc.getElementById("m") as HTMLInputElement)).toBe(true)
      },
    )
  })

  test("data-feedback-mask on ancestor masks descendants", () => {
    withDOM(`<div data-feedback-mask><input type=text id=t></div>`, (doc) => {
      const mask = createMask({ masking: "moderate" })
      expect(mask.shouldMaskInput(doc.getElementById("t") as HTMLInputElement)).toBe(true)
    })
  })

  test("shouldBlock returns true for data-feedback-block subtree in all modes", () => {
    withDOM(`<div data-feedback-block><span id=s>secret</span></div>`, (doc) => {
      for (const mode of ["strict", "moderate", "minimal"] as const) {
        const mask = createMask({ masking: mode })
        expect(mask.shouldBlock(doc.getElementById("s") as HTMLElement)).toBe(true)
      }
    })
  })

  test("maskValue replaces with same-length asterisks", () => {
    const mask = createMask({ masking: "moderate" })
    expect(mask.maskValue("secret")).toBe("******")
    expect(mask.maskValue("")).toBe("")
  })

  test("custom maskSelectors and blockSelectors", () => {
    withDOM(`<input class=secret id=s><div class=off-limits id=d></div>`, (doc) => {
      const mask = createMask({
        masking: "minimal",
        maskSelectors: [".secret"],
        blockSelectors: [".off-limits"],
      })
      expect(mask.shouldMaskInput(doc.getElementById("s") as HTMLInputElement)).toBe(true)
      expect(mask.shouldBlock(doc.getElementById("d") as HTMLElement)).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run tests — verify fail**

Run: `cd packages/recorder && bun test src/mask.test.ts`
Expected: FAIL with "Cannot find module './mask'".

- [ ] **Step 3: Implement `packages/recorder/src/mask.ts`**

```ts
export type MaskingMode = "strict" | "moderate" | "minimal"

export interface MaskConfig {
  masking: MaskingMode
  maskSelectors?: string[]
  blockSelectors?: string[]
}

export interface Mask {
  shouldMaskInput(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean
  shouldBlock(el: Element): boolean
  maskValue(value: string): string
}

const MODERATE_MASKED_TYPES = new Set(["password", "email", "tel", "number"])

export function createMask(config: MaskConfig): Mask {
  const { masking } = config
  const maskSelectors = config.maskSelectors ?? []
  const blockSelectors = config.blockSelectors ?? []

  function hasMaskedAncestor(el: Element): boolean {
    let cur: Element | null = el
    while (cur) {
      if (cur.hasAttribute?.("data-feedback-mask")) return true
      cur = cur.parentElement
    }
    return false
  }

  function matchesAny(el: Element, selectors: string[]): boolean {
    for (const sel of selectors) {
      try {
        if (el.matches(sel)) return true
      } catch {
        // invalid selector — ignore
      }
    }
    return false
  }

  return {
    shouldMaskInput(el) {
      if (hasMaskedAncestor(el)) return true
      if (matchesAny(el, maskSelectors)) return true
      if (masking === "strict") return true
      const tag = el.tagName
      if (tag === "INPUT") {
        const type = (el as HTMLInputElement).type?.toLowerCase() ?? "text"
        if (type === "password") return true
        if (masking === "moderate" && MODERATE_MASKED_TYPES.has(type)) return true
      }
      return false
    },
    shouldBlock(el) {
      let cur: Element | null = el
      while (cur) {
        if (cur.hasAttribute?.("data-feedback-block")) return true
        cur = cur.parentElement
      }
      return matchesAny(el, blockSelectors)
    },
    maskValue(value) {
      return "*".repeat(value.length)
    },
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd packages/recorder && bun test src/mask.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/mask.ts packages/recorder/src/mask.test.ts
git commit -m "feat(recorder): masking predicate with strict/moderate/minimal modes"
```

---

## Task 5: Gzip flush with truncate-retry

**Files:**
- Create: `packages/recorder/src/compress.ts`
- Create: `packages/recorder/src/compress.test.ts`

- [ ] **Step 1: Write failing tests** — `packages/recorder/src/compress.test.ts`

```ts
import { describe, expect, test } from "bun:test"
import { EventType, type RecorderEvent } from "./types"
import { gzipEvents } from "./compress"

function makeEvent(i: number, size = 50): RecorderEvent {
  return {
    type: EventType.Meta,
    data: { href: "x".repeat(size), width: 800, height: 600 },
    timestamp: i,
  }
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream("gzip")
  const stream = new Blob([bytes]).stream().pipeThrough(ds)
  const text = await new Response(stream).text()
  return text
}

describe("gzipEvents", () => {
  test("round-trip produces original JSON", async () => {
    const events = [makeEvent(1), makeEvent(2), makeEvent(3)]
    const result = await gzipEvents(events, { maxBytes: 1_000_000 })
    expect(result.truncated).toBe(false)
    expect(result.droppedEvents).toBe(0)
    const decoded = JSON.parse(await gunzip(result.bytes)) as RecorderEvent[]
    expect(decoded).toEqual(events)
  })

  test("returns empty gzip for empty event list", async () => {
    const result = await gzipEvents([], { maxBytes: 1_000_000 })
    const decoded = JSON.parse(await gunzip(result.bytes)) as RecorderEvent[]
    expect(decoded).toEqual([])
  })

  test("truncates oldest events when over maxBytes and reports droppedEvents", async () => {
    // ~80 bytes per event uncompressed; gzip ratio ~3-5x. Force truncation with a tight cap.
    const events = Array.from({ length: 200 }, (_, i) => makeEvent(i, 200))
    const result = await gzipEvents(events, { maxBytes: 500, maxRetries: 5 })
    expect(result.truncated).toBe(true)
    expect(result.droppedEvents).toBeGreaterThan(0)
    expect(result.bytes.length).toBeLessThanOrEqual(500)
  })

  test("returns null bytes when unable to fit after max retries", async () => {
    // Force failure: each event is huge, single event already exceeds cap.
    const events = Array.from({ length: 10 }, (_, i) => makeEvent(i, 10_000))
    const result = await gzipEvents(events, { maxBytes: 100, maxRetries: 3 })
    expect(result.bytes).toBeNull()
    expect(result.truncated).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — verify fail**

Run: `cd packages/recorder && bun test src/compress.test.ts`
Expected: FAIL with "Cannot find module './compress'".

- [ ] **Step 3: Implement `packages/recorder/src/compress.ts`**

```ts
import type { RecorderEvent } from "./types"

export interface GzipOptions {
  /** Max post-gzip byte cap; truncate + retry if exceeded. */
  maxBytes: number
  /** Max truncate-retry attempts before giving up with { bytes: null }. */
  maxRetries?: number
}

export interface GzipResult {
  bytes: Uint8Array | null
  eventCount: number
  durationMs: number
  truncated: boolean
  droppedEvents: number
}

/**
 * JSON.stringify → gzip. If over maxBytes, drop oldest ~10% of events and
 * retry, up to maxRetries. Returns { bytes: null, truncated: true } if we
 * can't fit (caller should skip the replay attachment in that case).
 */
export async function gzipEvents(
  events: RecorderEvent[],
  opts: GzipOptions,
): Promise<GzipResult> {
  const maxRetries = opts.maxRetries ?? 3
  let current = events
  let droppedTotal = 0
  let attempts = 0
  const firstTs = events[0]?.timestamp ?? 0
  const lastTs = events[events.length - 1]?.timestamp ?? 0
  const durationMs = Math.max(0, lastTs - firstTs)

  while (attempts <= maxRetries) {
    const bytes = await gzipBytes(current)
    if (bytes.length <= opts.maxBytes) {
      return {
        bytes,
        eventCount: current.length,
        durationMs,
        truncated: droppedTotal > 0,
        droppedEvents: droppedTotal,
      }
    }
    if (current.length <= 1) break
    const dropN = Math.max(1, Math.floor(current.length * 0.1))
    current = current.slice(dropN)
    droppedTotal += dropN
    attempts++
  }

  return {
    bytes: null,
    eventCount: current.length,
    durationMs,
    truncated: true,
    droppedEvents: droppedTotal,
  }
}

async function gzipBytes(events: RecorderEvent[]): Promise<Uint8Array> {
  const json = JSON.stringify(events)
  const input = new TextEncoder().encode(json)
  const cs = new CompressionStream("gzip")
  const stream = new Blob([input]).stream().pipeThrough(cs)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd packages/recorder && bun test src/compress.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/compress.ts packages/recorder/src/compress.test.ts
git commit -m "feat(recorder): gzip events with truncate-and-retry for size cap"
```

---

## Task 6: DOM mirror (node-id map)

**Files:**
- Create: `packages/recorder/src/mirror.ts`
- Create: `packages/recorder/src/mirror.test.ts`

- [ ] **Step 1: Write failing tests** — `packages/recorder/src/mirror.test.ts`

```ts
import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { Mirror } from "./mirror"

describe("Mirror", () => {
  test("assigns unique incrementing IDs to new nodes", () => {
    const mirror = new Mirror()
    const win = new Window()
    const a = win.document.createElement("div")
    const b = win.document.createElement("span")
    expect(mirror.getOrCreateId(a as unknown as Node)).toBe(1)
    expect(mirror.getOrCreateId(b as unknown as Node)).toBe(2)
    expect(mirror.getOrCreateId(a as unknown as Node)).toBe(1) // stable
  })

  test("getNode returns the Node for a known id, or null", () => {
    const mirror = new Mirror()
    const win = new Window()
    const a = win.document.createElement("div")
    const id = mirror.getOrCreateId(a as unknown as Node)
    expect(mirror.getNode(id)).toBe(a as unknown as Node)
    expect(mirror.getNode(999)).toBeNull()
  })

  test("remove erases node from both directions", () => {
    const mirror = new Mirror()
    const win = new Window()
    const a = win.document.createElement("div")
    const id = mirror.getOrCreateId(a as unknown as Node)
    mirror.remove(a as unknown as Node)
    expect(mirror.getNode(id)).toBeNull()
    expect(mirror.has(a as unknown as Node)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — verify fail**

Run: `cd packages/recorder && bun test src/mirror.test.ts`
Expected: FAIL with "Cannot find module './mirror'".

- [ ] **Step 3: Implement `packages/recorder/src/mirror.ts`**

```ts
/**
 * Two-way map between DOM Node and numeric ID. IDs are monotonically
 * increasing per recorder instance so a later full snapshot never collides
 * with earlier incremental references.
 */
export class Mirror {
  private readonly nodeToId = new WeakMap<Node, number>()
  private readonly idToNode = new Map<number, Node>()
  private nextId = 1

  getOrCreateId(node: Node): number {
    const existing = this.nodeToId.get(node)
    if (existing !== undefined) return existing
    const id = this.nextId++
    this.nodeToId.set(node, id)
    this.idToNode.set(id, node)
    return id
  }

  getId(node: Node): number | undefined {
    return this.nodeToId.get(node)
  }

  getNode(id: number): Node | null {
    return this.idToNode.get(id) ?? null
  }

  has(node: Node): boolean {
    return this.nodeToId.has(node)
  }

  remove(node: Node): void {
    const id = this.nodeToId.get(node)
    if (id === undefined) return
    this.nodeToId.delete(node)
    this.idToNode.delete(id)
  }

  clear(): void {
    this.idToNode.clear()
    this.nextId = 1
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd packages/recorder && bun test src/mirror.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/mirror.ts packages/recorder/src/mirror.test.ts
git commit -m "feat(recorder): two-way DOM-node id map"
```

---

## Task 7: Node serialization

**Files:**
- Create: `packages/recorder/src/serialize.ts`
- Create: `packages/recorder/src/serialize.test.ts`

- [ ] **Step 1: Write failing tests** — `packages/recorder/src/serialize.test.ts`

```ts
import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { createMask } from "./mask"
import { Mirror } from "./mirror"
import { NodeType, type ElementNode, type TextNode } from "./types"
import { serializeNodeWithChildren } from "./serialize"

function withDOM(html: string, fn: (doc: Document) => void): void {
  const win = new Window({ url: "http://localhost/" })
  win.document.body.innerHTML = html
  fn(win.document as unknown as Document)
}

describe("serializeNodeWithChildren", () => {
  test("serializes a plain element with attributes + text child", () => {
    withDOM(`<div id=hello class=greeting>world</div>`, (doc) => {
      const el = doc.querySelector("#hello") as Element
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      expect(node.type).toBe(NodeType.Element)
      expect(node.tagName).toBe("div")
      expect(node.attributes.id).toBe("hello")
      expect(node.attributes.class).toBe("greeting")
      expect(node.childNodes.length).toBe(1)
      const child = node.childNodes[0] as TextNode
      expect(child.type).toBe(NodeType.Text)
      expect(child.textContent).toBe("world")
    })
  })

  test("masks password input value attribute", () => {
    withDOM(`<input type=password value=secret123>`, (doc) => {
      const el = doc.querySelector("input") as HTMLInputElement
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      expect(node.attributes.value).toBe("*".repeat("secret123".length))
      expect(node.attributes.type).toBe("password")
    })
  })

  test("returns null for data-feedback-block subtree root", () => {
    withDOM(`<div data-feedback-block><span>secret</span></div>`, (doc) => {
      const el = doc.querySelector("div") as Element
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      })
      expect(node).toBeNull()
    })
  })

  test("skips <script> and <noscript> children entirely", () => {
    withDOM(`<div><script>alert(1)</script><p>ok</p></div>`, (doc) => {
      const el = doc.querySelector("div") as Element
      const node = serializeNodeWithChildren(el, {
        mirror: new Mirror(),
        mask: createMask({ masking: "moderate" }),
      }) as ElementNode
      const childTags = (node.childNodes.filter((c) => c.type === NodeType.Element) as ElementNode[]).map(
        (c) => c.tagName,
      )
      expect(childTags).toEqual(["p"])
    })
  })
})
```

- [ ] **Step 2: Run tests — verify fail**

Run: `cd packages/recorder && bun test src/serialize.test.ts`
Expected: FAIL with "Cannot find module './serialize'".

- [ ] **Step 3: Implement `packages/recorder/src/serialize.ts`**

```ts
import type { Mask } from "./mask"
import type { Mirror } from "./mirror"
import {
  NodeType,
  type ElementNode,
  type SerializedNode,
  type TextNode,
  type CommentNode,
  type DocumentNode,
  type DocumentTypeNode,
} from "./types"

export interface SerializeContext {
  mirror: Mirror
  mask: Mask
}

const SKIP_TAGS = new Set(["SCRIPT", "NOSCRIPT", "TEMPLATE"])

export function serializeNodeWithChildren(
  node: Node,
  ctx: SerializeContext,
): SerializedNode | null {
  if (node.nodeType === 1) {
    const el = node as Element
    if (SKIP_TAGS.has(el.tagName)) return null
    if (ctx.mask.shouldBlock(el)) return null
    return serializeElement(el, ctx)
  }
  if (node.nodeType === 3) {
    return serializeText(node as Text, ctx)
  }
  if (node.nodeType === 8) {
    const id = ctx.mirror.getOrCreateId(node)
    const c: CommentNode = { type: NodeType.Comment, id, textContent: node.nodeValue ?? "" }
    return c
  }
  if (node.nodeType === 9) {
    const id = ctx.mirror.getOrCreateId(node)
    const children: SerializedNode[] = []
    node.childNodes.forEach((child) => {
      const s = serializeNodeWithChildren(child, ctx)
      if (s) children.push(s)
    })
    const d: DocumentNode = { type: NodeType.Document, id, childNodes: children }
    return d
  }
  if (node.nodeType === 10) {
    const id = ctx.mirror.getOrCreateId(node)
    const dt = node as DocumentType
    const n: DocumentTypeNode = {
      type: NodeType.DocumentType,
      id,
      name: dt.name,
      publicId: dt.publicId,
      systemId: dt.systemId,
    }
    return n
  }
  return null
}

function serializeElement(el: Element, ctx: SerializeContext): ElementNode {
  const id = ctx.mirror.getOrCreateId(el)
  const attributes: Record<string, string | number | boolean> = {}
  for (const attr of Array.from(el.attributes)) {
    attributes[attr.name] = attr.value
  }
  // Mask sensitive input values at serialization time.
  const tagName = el.tagName.toLowerCase()
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    if (ctx.mask.shouldMaskInput(el as HTMLInputElement)) {
      if (typeof attributes.value === "string") {
        attributes.value = ctx.mask.maskValue(attributes.value)
      }
    }
  }
  const children: SerializedNode[] = []
  el.childNodes.forEach((child) => {
    const s = serializeNodeWithChildren(child, ctx)
    if (s) children.push(s)
  })
  const isSVG = tagName === "svg" || el.namespaceURI === "http://www.w3.org/2000/svg"
  const out: ElementNode = { type: NodeType.Element, id, tagName, attributes, childNodes: children }
  if (isSVG) out.isSVG = true
  return out
}

function serializeText(text: Text, ctx: SerializeContext): TextNode {
  const id = ctx.mirror.getOrCreateId(text)
  const parent = text.parentElement
  const isStyleTag = parent?.tagName === "STYLE"
  let value = text.nodeValue ?? ""
  // Mask text inside a [data-feedback-mask] subtree.
  if (parent && ctx.mask.shouldBlock(parent)) return { type: NodeType.Text, id, textContent: "" }
  if (parent && hasMaskedAncestor(parent)) {
    value = ctx.mask.maskValue(value)
  }
  const out: TextNode = { type: NodeType.Text, id, textContent: value }
  if (isStyleTag) out.isStyle = true
  return out
}

function hasMaskedAncestor(el: Element | null): boolean {
  let cur: Element | null = el
  while (cur) {
    if (cur.hasAttribute?.("data-feedback-mask")) return true
    cur = cur.parentElement
  }
  return false
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd packages/recorder && bun test src/serialize.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/recorder/src/serialize.ts packages/recorder/src/serialize.test.ts
git commit -m "feat(recorder): serialize DOM nodes to rrweb-compatible shape with masking"
```

---

## Task 8: Full-snapshot observer

**Files:**
- Create: `packages/recorder/src/observers/full-snapshot.ts`

- [ ] **Step 1: Implement `packages/recorder/src/observers/full-snapshot.ts`**

```ts
import type { Mask } from "../mask"
import type { Mirror } from "../mirror"
import { serializeNodeWithChildren } from "../serialize"
import { EventType, type FullSnapshotEvent, type MetaEvent } from "../types"

export interface FullSnapshotOptions {
  doc: Document
  mirror: Mirror
  mask: Mask
  now: () => number
}

/**
 * Emits a Meta event (URL + viewport) immediately followed by a FullSnapshot
 * event (serialized document tree with node IDs). Call once at recorder start
 * and optionally on major navigations.
 */
export function emitFullSnapshot(opts: FullSnapshotOptions): [MetaEvent, FullSnapshotEvent] {
  const meta: MetaEvent = {
    type: EventType.Meta,
    data: {
      href: opts.doc.location.href,
      width: opts.doc.defaultView?.innerWidth ?? 0,
      height: opts.doc.defaultView?.innerHeight ?? 0,
    },
    timestamp: opts.now(),
  }
  const node = serializeNodeWithChildren(opts.doc, { mirror: opts.mirror, mask: opts.mask })
  if (!node) throw new Error("full-snapshot: document serialization returned null")
  const full: FullSnapshotEvent = {
    type: EventType.FullSnapshot,
    data: {
      node,
      initialOffset: {
        left: opts.doc.defaultView?.scrollX ?? 0,
        top: opts.doc.defaultView?.scrollY ?? 0,
      },
    },
    timestamp: opts.now(),
  }
  return [meta, full]
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/recorder && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/recorder/src/observers/full-snapshot.ts
git commit -m "feat(recorder): full-snapshot emitter (Meta + FullSnapshot events)"
```

---

## Task 9: Mutation observer

**Files:**
- Create: `packages/recorder/src/observers/mutation.ts`

- [ ] **Step 1: Implement `packages/recorder/src/observers/mutation.ts`**

```ts
import type { Mask } from "../mask"
import type { Mirror } from "../mirror"
import { serializeNodeWithChildren } from "../serialize"
import { EventType, IncrementalSource, type IncrementalSnapshotEvent, type MutationData } from "../types"

export interface MutationObserverHandle {
  start(): void
  stop(): void
}

export interface MutationObserverOptions {
  doc: Document
  mirror: Mirror
  mask: Mask
  emit(ev: IncrementalSnapshotEvent): void
  now: () => number
}

export function createMutationObserver(opts: MutationObserverOptions): MutationObserverHandle {
  const observer = new MutationObserver((records) => flush(records))

  function flush(records: MutationRecord[]): void {
    const adds: MutationData["adds"] = []
    const removes: MutationData["removes"] = []
    const texts: MutationData["texts"] = []
    const attributes: MutationData["attributes"] = []

    for (const r of records) {
      if (r.type === "childList") {
        r.removedNodes.forEach((node) => {
          const id = opts.mirror.getId(node)
          const parentId = opts.mirror.getId(r.target)
          if (id !== undefined && parentId !== undefined) {
            removes.push({ parentId, id })
            opts.mirror.remove(node)
          }
        })
        r.addedNodes.forEach((node) => {
          if (opts.mask.shouldBlock(node as Element)) return
          const serialized = serializeNodeWithChildren(node, {
            mirror: opts.mirror,
            mask: opts.mask,
          })
          if (!serialized) return
          const parentId = opts.mirror.getOrCreateId(r.target)
          const next = node.nextSibling
          const nextId = next ? opts.mirror.getId(next) ?? null : null
          adds.push({ parentId, nextId, node: serialized })
        })
      } else if (r.type === "characterData") {
        const id = opts.mirror.getId(r.target)
        if (id === undefined) continue
        let value = r.target.nodeValue ?? ""
        const parent = r.target.parentElement
        if (parent && opts.mask.shouldBlock(parent)) value = ""
        else if (parent && hasMaskedAncestor(parent)) value = opts.mask.maskValue(value)
        texts.push({ id, value })
      } else if (r.type === "attributes") {
        const id = opts.mirror.getId(r.target)
        if (id === undefined) continue
        const name = r.attributeName
        if (!name) continue
        const el = r.target as Element
        let value: string | null = el.getAttribute(name)
        // Mask sensitive input value attributes dynamically.
        if (
          name === "value" &&
          (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") &&
          opts.mask.shouldMaskInput(el as HTMLInputElement) &&
          typeof value === "string"
        ) {
          value = opts.mask.maskValue(value)
        }
        attributes.push({ id, attributes: { [name]: value } })
      }
    }

    if (
      adds.length === 0 &&
      removes.length === 0 &&
      texts.length === 0 &&
      attributes.length === 0
    ) {
      return
    }

    opts.emit({
      type: EventType.IncrementalSnapshot,
      data: { source: IncrementalSource.Mutation, adds, removes, texts, attributes },
      timestamp: opts.now(),
    })
  }

  function hasMaskedAncestor(el: Element | null): boolean {
    let cur: Element | null = el
    while (cur) {
      if (cur.hasAttribute?.("data-feedback-mask")) return true
      cur = cur.parentElement
    }
    return false
  }

  return {
    start() {
      observer.observe(opts.doc, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeOldValue: false,
      })
    },
    stop() {
      observer.disconnect()
    },
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/recorder && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/recorder/src/observers/mutation.ts
git commit -m "feat(recorder): MutationObserver wrapper with masking on newly-added nodes"
```

---

## Task 10: Input, mouse-interaction, scroll, viewport observers

**Files:**
- Create: `packages/recorder/src/observers/input.ts`
- Create: `packages/recorder/src/observers/mouse-interaction.ts`
- Create: `packages/recorder/src/observers/scroll.ts`
- Create: `packages/recorder/src/observers/viewport.ts`
- Create: `packages/recorder/src/observers/index.ts`

- [ ] **Step 1: Implement `packages/recorder/src/observers/input.ts`**

```ts
import type { Mask } from "../mask"
import type { Mirror } from "../mirror"
import { EventType, IncrementalSource, type IncrementalSnapshotEvent } from "../types"

export interface InputObserverOptions {
  doc: Document
  mirror: Mirror
  mask: Mask
  emit(ev: IncrementalSnapshotEvent): void
  now: () => number
}

export function createInputObserver(opts: InputObserverOptions): { start(): void; stop(): void } {
  function handler(evt: Event): void {
    const target = evt.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
    if (!target) return
    const id = opts.mirror.getId(target)
    if (id === undefined) return
    const isChecked = "checked" in target ? Boolean((target as HTMLInputElement).checked) : false
    let text = "value" in target ? String(target.value ?? "") : ""
    if (opts.mask.shouldMaskInput(target)) text = opts.mask.maskValue(text)
    opts.emit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.Input,
        id,
        text,
        isChecked,
        userTriggered: evt.isTrusted,
      },
      timestamp: opts.now(),
    })
  }

  return {
    start() {
      opts.doc.addEventListener("input", handler, { capture: true, passive: true })
      opts.doc.addEventListener("change", handler, { capture: true, passive: true })
    },
    stop() {
      opts.doc.removeEventListener("input", handler, { capture: true })
      opts.doc.removeEventListener("change", handler, { capture: true })
    },
  }
}
```

- [ ] **Step 2: Implement `packages/recorder/src/observers/mouse-interaction.ts`**

```ts
import type { Mirror } from "../mirror"
import { EventType, IncrementalSource, type IncrementalSnapshotEvent } from "../types"

export const MouseInteractionType = {
  MouseUp: 0,
  MouseDown: 1,
  Click: 2,
  ContextMenu: 3,
  DblClick: 4,
  Focus: 5,
  Blur: 6,
} as const

export interface MouseInteractionOptions {
  doc: Document
  mirror: Mirror
  emit(ev: IncrementalSnapshotEvent): void
  now: () => number
}

export function createMouseInteractionObserver(
  opts: MouseInteractionOptions,
): { start(): void; stop(): void } {
  const handlers: Array<[string, (e: Event) => void]> = [
    ["click", (e) => record(e, MouseInteractionType.Click)],
    ["dblclick", (e) => record(e, MouseInteractionType.DblClick)],
    ["mousedown", (e) => record(e, MouseInteractionType.MouseDown)],
    ["mouseup", (e) => record(e, MouseInteractionType.MouseUp)],
    ["contextmenu", (e) => record(e, MouseInteractionType.ContextMenu)],
    ["focusin", (e) => record(e, MouseInteractionType.Focus)],
    ["focusout", (e) => record(e, MouseInteractionType.Blur)],
  ]

  function record(e: Event, type: (typeof MouseInteractionType)[keyof typeof MouseInteractionType]): void {
    const target = e.target as Node | null
    if (!target) return
    const id = opts.mirror.getId(target)
    if (id === undefined) return
    const mouse = e as MouseEvent
    opts.emit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.MouseInteraction,
        type,
        id,
        x: Math.round(mouse.clientX ?? 0),
        y: Math.round(mouse.clientY ?? 0),
      },
      timestamp: opts.now(),
    })
  }

  return {
    start() {
      for (const [name, fn] of handlers) {
        opts.doc.addEventListener(name, fn, { capture: true, passive: true })
      }
    },
    stop() {
      for (const [name, fn] of handlers) {
        opts.doc.removeEventListener(name, fn, { capture: true })
      }
    },
  }
}
```

- [ ] **Step 3: Implement `packages/recorder/src/observers/scroll.ts`**

```ts
import type { Mirror } from "../mirror"
import { EventType, IncrementalSource, type IncrementalSnapshotEvent } from "../types"

export interface ScrollObserverOptions {
  doc: Document
  mirror: Mirror
  emit(ev: IncrementalSnapshotEvent): void
  now: () => number
  throttleMs?: number
}

export function createScrollObserver(
  opts: ScrollObserverOptions,
): { start(): void; stop(): void } {
  const throttleMs = opts.throttleMs ?? 100
  let lastByNode = new WeakMap<object, number>()

  function handler(e: Event): void {
    const target = (e.target ?? opts.doc) as Node
    const id = target === opts.doc ? opts.mirror.getId(opts.doc) : opts.mirror.getId(target)
    if (id === undefined) return
    const key = target as unknown as object
    const now = opts.now()
    const last = lastByNode.get(key) ?? 0
    if (now - last < throttleMs) return
    lastByNode.set(key, now)
    let x: number
    let y: number
    if (target === opts.doc) {
      x = opts.doc.defaultView?.scrollX ?? 0
      y = opts.doc.defaultView?.scrollY ?? 0
    } else {
      const el = target as Element
      x = (el as HTMLElement).scrollLeft ?? 0
      y = (el as HTMLElement).scrollTop ?? 0
    }
    opts.emit({
      type: EventType.IncrementalSnapshot,
      data: { source: IncrementalSource.Scroll, id, x: Math.round(x), y: Math.round(y) },
      timestamp: now,
    })
  }

  return {
    start() {
      opts.doc.addEventListener("scroll", handler, { capture: true, passive: true })
    },
    stop() {
      opts.doc.removeEventListener("scroll", handler, { capture: true })
      lastByNode = new WeakMap()
    },
  }
}
```

- [ ] **Step 4: Implement `packages/recorder/src/observers/viewport.ts`**

```ts
import { EventType, IncrementalSource, type IncrementalSnapshotEvent } from "../types"

export interface ViewportObserverOptions {
  win: Window
  emit(ev: IncrementalSnapshotEvent): void
  now: () => number
}

export function createViewportObserver(
  opts: ViewportObserverOptions,
): { start(): void; stop(): void } {
  function handler(): void {
    opts.emit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.ViewportResize,
        width: opts.win.innerWidth,
        height: opts.win.innerHeight,
      },
      timestamp: opts.now(),
    })
  }

  return {
    start() {
      opts.win.addEventListener("resize", handler, { passive: true })
    },
    stop() {
      opts.win.removeEventListener("resize", handler)
    },
  }
}
```

- [ ] **Step 5: Implement `packages/recorder/src/observers/index.ts`**

```ts
export * from "./full-snapshot"
export * from "./input"
export * from "./mouse-interaction"
export * from "./mutation"
export * from "./scroll"
export * from "./viewport"
```

- [ ] **Step 6: Typecheck**

Run: `cd packages/recorder && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/recorder/src/observers
git commit -m "feat(recorder): input, mouse-interaction, scroll, viewport observers"
```

---

## Task 11: Recorder orchestrator + public API

**Files:**
- Create: `packages/recorder/src/record.ts`
- Create: `packages/recorder/src/record.test.ts`
- Modify: `packages/recorder/src/index.ts`

- [ ] **Step 1: Write failing tests** — `packages/recorder/src/record.test.ts`

```ts
import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { EventType, IncrementalSource } from "./types"
import { createRecorder } from "./record"

function setupDOM(): Document {
  const win = new Window({ url: "http://localhost/" })
  win.document.body.innerHTML = `<div id=root><p>hi</p></div>`
  return win.document as unknown as Document
}

describe("createRecorder", () => {
  test("start → first events are Meta then FullSnapshot", () => {
    const doc = setupDOM()
    const recorder = createRecorder({ doc, config: { masking: "moderate" }, bufferBytes: 1_000_000 })
    recorder.start()
    const events = recorder.peek()
    expect(events[0]?.type).toBe(EventType.Meta)
    expect(events[1]?.type).toBe(EventType.FullSnapshot)
    recorder.stop()
  })

  test("DOM mutation after start produces an IncrementalSnapshot Mutation event", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({ doc, config: { masking: "moderate" }, bufferBytes: 1_000_000 })
    recorder.start()
    const before = recorder.peek().length
    const root = doc.getElementById("root")
    if (!root) throw new Error("root missing")
    const span = doc.createElement("span")
    span.textContent = "new"
    root.appendChild(span)
    // happy-dom processes MutationObserver microtasks synchronously when we await a microtask tick.
    await new Promise((r) => queueMicrotask(r))
    const after = recorder.peek()
    expect(after.length).toBeGreaterThan(before)
    const mutations = after.filter(
      (e) =>
        e.type === EventType.IncrementalSnapshot &&
        e.data.source === IncrementalSource.Mutation,
    )
    expect(mutations.length).toBeGreaterThan(0)
    recorder.stop()
  })

  test("pause/resume emits marker Custom events and suppresses events between", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({ doc, config: { masking: "moderate" }, bufferBytes: 1_000_000 })
    recorder.start()
    recorder.pause()
    const root = doc.getElementById("root")
    if (root) root.appendChild(doc.createElement("b"))
    await new Promise((r) => queueMicrotask(r))
    recorder.resume()
    const events = recorder.peek()
    const customTags = events
      .filter((e) => e.type === EventType.Custom)
      .map((e) => (e.data as { tag: string }).tag)
    expect(customTags).toContain("paused")
    expect(customTags).toContain("resumed")
    recorder.stop()
  })

  test("stop disconnects observers (subsequent DOM changes not recorded)", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({ doc, config: { masking: "moderate" }, bufferBytes: 1_000_000 })
    recorder.start()
    recorder.stop()
    const before = recorder.peek().length
    const root = doc.getElementById("root")
    if (root) root.appendChild(doc.createElement("hr"))
    await new Promise((r) => queueMicrotask(r))
    expect(recorder.peek().length).toBe(before)
  })

  test("flushGzipped returns a bytes result for non-empty sessions", async () => {
    const doc = setupDOM()
    const recorder = createRecorder({ doc, config: { masking: "moderate" }, bufferBytes: 1_000_000 })
    recorder.start()
    const result = await recorder.flushGzipped({ maxBytes: 1_048_576 })
    expect(result.bytes).not.toBeNull()
    expect(result.eventCount).toBeGreaterThan(0)
    recorder.stop()
  })
})
```

- [ ] **Step 2: Run tests — verify fail**

Run: `cd packages/recorder && bun test src/record.test.ts`
Expected: FAIL with "Cannot find module './record'".

- [ ] **Step 3: Implement `packages/recorder/src/record.ts`**

```ts
import { EventBuffer } from "./buffer"
import { gzipEvents, type GzipResult } from "./compress"
import { createMask, type MaskConfig } from "./mask"
import { Mirror } from "./mirror"
import {
  createInputObserver,
  createMouseInteractionObserver,
  createMutationObserver,
  createScrollObserver,
  createViewportObserver,
  emitFullSnapshot,
} from "./observers"
import { EventType, type RecorderEvent } from "./types"

export interface RecorderConfig extends MaskConfig {
  /** Recorder window in ms; events older than this get evicted on push. Default 30s. */
  windowMs?: number
}

export interface RecorderOptions {
  doc?: Document
  config: RecorderConfig
  bufferBytes?: number
}

export interface Recorder {
  start(): void
  stop(): void
  pause(): void
  resume(): void
  peek(): RecorderEvent[]
  flushGzipped(opts: { maxBytes: number }): Promise<GzipResult>
}

export function createRecorder(opts: RecorderOptions): Recorder {
  const doc = opts.doc ?? document
  const win = doc.defaultView ?? (globalThis as unknown as Window)
  const mirror = new Mirror()
  const mask = createMask(opts.config)
  const buffer = new EventBuffer({
    windowMs: opts.config.windowMs ?? 30_000,
    maxBytes: opts.bufferBytes ?? 4_000_000,
  })
  const now = () => Date.now()
  let paused = false
  let stopped = false
  let handles: Array<{ start(): void; stop(): void }> = []

  function push(ev: RecorderEvent): void {
    if (paused || stopped) return
    buffer.push(ev)
  }

  function emitIncremental(ev: RecorderEvent): void {
    push(ev)
  }

  function start(): void {
    if (stopped) throw new Error("recorder: already stopped")
    // Emit initial Meta + FullSnapshot.
    try {
      const [meta, full] = emitFullSnapshot({ doc, mirror, mask, now })
      buffer.push(meta)
      buffer.push(full)
    } catch (err) {
      console.warn("[feedback-tool] full-snapshot failed; recorder disabled", err)
      stopped = true
      return
    }
    handles = [
      createMutationObserver({ doc, mirror, mask, emit: emitIncremental, now }),
      createInputObserver({ doc, mirror, mask, emit: emitIncremental, now }),
      createMouseInteractionObserver({ doc, mirror, emit: emitIncremental, now }),
      createScrollObserver({ doc, mirror, emit: emitIncremental, now }),
      createViewportObserver({ win: win as Window, emit: emitIncremental, now }),
    ]
    for (const h of handles) {
      try {
        h.start()
      } catch (err) {
        console.warn("[feedback-tool] observer failed to start", err)
      }
    }
  }

  function stop(): void {
    stopped = true
    for (const h of handles) {
      try {
        h.stop()
      } catch {
        // best-effort teardown
      }
    }
    handles = []
  }

  function pause(): void {
    if (paused || stopped) return
    paused = true
    buffer.push({ type: EventType.Custom, data: { tag: "paused", payload: {} }, timestamp: now() })
  }

  function resume(): void {
    if (!paused || stopped) return
    paused = false
    buffer.push({ type: EventType.Custom, data: { tag: "resumed", payload: {} }, timestamp: now() })
  }

  return {
    start,
    stop,
    pause,
    resume,
    peek: () => buffer.peek(),
    async flushGzipped({ maxBytes }) {
      const events = buffer.flush()
      return gzipEvents(events, { maxBytes })
    },
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd packages/recorder && bun test src/record.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Update `packages/recorder/src/index.ts`**

```ts
export * from "./types"
export type { MaskConfig, MaskingMode } from "./mask"
export type { GzipResult } from "./compress"
export { createRecorder, type Recorder, type RecorderConfig, type RecorderOptions } from "./record"
```

- [ ] **Step 6: Commit**

```bash
git add packages/recorder
git commit -m "feat(recorder): orchestrator + public API (start/stop/pause/resume/flushGzipped)"
```

---

## Task 12: SDK collector adapter for replay

**Files:**
- Modify: `packages/ui/package.json`
- Create: `packages/ui/src/collectors/replay.ts`
- Modify: `packages/ui/src/collectors/index.ts`

- [ ] **Step 1: Add recorder dep to `packages/ui/package.json`**

Open `packages/ui/package.json` and add under `dependencies`:

```json
"@feedback-tool/recorder": "*",
```

Then run `bun install`.

- [ ] **Step 2: Create `packages/ui/src/collectors/replay.ts`**

```ts
import { createRecorder, type MaskingMode, type Recorder } from "@feedback-tool/recorder"

export interface ReplayConfig {
  enabled?: boolean
  masking?: MaskingMode
  maskSelectors?: string[]
  blockSelectors?: string[]
  /** Hard cap on gzipped bytes; default 1 MB. */
  maxBytes?: number
}

export interface ReplayCollector {
  start(): void
  stop(): void
  pause(): void
  resume(): void
  flushGzipped(): Promise<{ bytes: Uint8Array | null; eventCount: number; durationMs: number; truncated: boolean }>
  markDisabled(): void
  isDisabled(): boolean
}

export function createReplayCollector(config: ReplayConfig): ReplayCollector {
  const enabled = config.enabled !== false
  const maxBytes = config.maxBytes ?? 1_048_576
  let recorder: Recorder | null = null
  let disabled = !enabled

  return {
    start() {
      if (disabled || recorder) return
      try {
        recorder = createRecorder({
          config: {
            masking: config.masking ?? "moderate",
            maskSelectors: config.maskSelectors,
            blockSelectors: config.blockSelectors,
          },
        })
        recorder.start()
      } catch (err) {
        console.warn("[feedback-tool] replay recorder failed to start", err)
        recorder = null
        disabled = true
      }
    },
    stop() {
      recorder?.stop()
      recorder = null
    },
    pause() {
      recorder?.pause()
    },
    resume() {
      recorder?.resume()
    },
    async flushGzipped() {
      if (!recorder || disabled) {
        return { bytes: null, eventCount: 0, durationMs: 0, truncated: false }
      }
      const result = await recorder.flushGzipped({ maxBytes })
      return {
        bytes: result.bytes,
        eventCount: result.eventCount,
        durationMs: result.durationMs,
        truncated: result.truncated,
      }
    },
    markDisabled() {
      disabled = true
      recorder?.stop()
      recorder = null
    },
    isDisabled() {
      return disabled
    },
  }
}
```

- [ ] **Step 3: Wire into `packages/ui/src/collectors/index.ts`**

Add `import { createReplayCollector, type ReplayCollector, type ReplayConfig } from "./replay"` at the top (alongside other imports).

Extend `CollectorConfig` with a `replay?: ReplayConfig` field:

```ts
  replay?: ReplayConfig
```

Inside `registerAllCollectors`, after the other collectors are started, construct + start the replay collector:

```ts
  const replayCollector = createReplayCollector(config.replay ?? {})
  replayCollector.start()
```

Change the return type and body to expose `flushReplay`, `pauseReplay`, `resumeReplay`, and `markReplayDisabled`:

```ts
export function registerAllCollectors(config: CollectorConfig): {
  snapshotAll: () => {
    systemInfo: ReturnType<typeof snapshotSystemInfo>
    cookies: ReturnType<ReturnType<typeof createCookiesCollector>["snapshot"]>
    logs: LogsAttachment
  }
  flushReplay: () => ReturnType<ReplayCollector["flushGzipped"]>
  pauseReplay: () => void
  resumeReplay: () => void
  markReplayDisabled: () => void
  stopAll: () => void
  breadcrumb: (
    event: string,
    data?: Record<string, string | number | boolean | null>,
    level?: BreadcrumbLevel,
  ) => void
  applyBeforeSend: (report: PendingReport) => PendingReport | null
} {
  // ... existing code unchanged above ...

  return {
    snapshotAll() { /* unchanged */ },
    flushReplay: () => replayCollector.flushGzipped(),
    pauseReplay: () => replayCollector.pause(),
    resumeReplay: () => replayCollector.resume(),
    markReplayDisabled: () => replayCollector.markDisabled(),
    stopAll() {
      consoleCollector.stop()
      networkCollector.stop()
      cookiesCollector.stop()
      breadcrumbsCollector.stop()
      replayCollector.stop()
    },
    breadcrumb: breadcrumbsCollector.breadcrumb,
    applyBeforeSend(report) { /* unchanged */ },
  }
}
```

- [ ] **Step 4: Run ui tests to verify no regression**

Run: `bun test packages/ui`
Expected: existing tests pass; no new test failures.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/package.json packages/ui/src/collectors/replay.ts packages/ui/src/collectors/index.ts
git commit -m "feat(sdk): replay collector adapter; wire into registerAllCollectors"
```

---

## Task 13: Shared types — replayDisabled signal

**Files:**
- Modify: `packages/shared/src/reports.ts`

- [ ] **Step 1: Verify `AttachmentKind` already includes `"replay"`**

Run: `grep -n 'AttachmentKind' packages/shared/src/reports.ts`
Expected: line contains `"replay"` in the enum. If not, add it.

- [ ] **Step 2: Add `IntakeResponse` Zod schema to `packages/shared/src/reports.ts`**

Append at the end of the file:

```ts
export const IntakeResponse = z.object({
  id: z.uuid(),
  /** True when the server silently dropped the replay part (per-project or per-deployment disable). */
  replayStored: z.boolean().optional(),
  replayDisabled: z.boolean().optional(),
})
export type IntakeResponse = z.infer<typeof IntakeResponse>
```

- [ ] **Step 3: Typecheck shared**

Run: `cd packages/shared && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/reports.ts
git commit -m "feat(shared): IntakeResponse schema with replayStored/replayDisabled flags"
```

---

## Task 14: Core intake-client — attach replay part + handle disable signal

**Files:**
- Modify: `packages/core/src/intake-client.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Extend `IntakeInput` and `postReport` in `packages/core/src/intake-client.ts`**

Replace the file's contents with:

```ts
import type { IntakeResponse, LogsAttachment, ReportContext } from "@feedback-tool/shared"
import type { ResolvedConfig } from "./config"

export interface IntakeInput {
  title: string
  description: string
  context: ReportContext
  metadata?: Record<string, string | number | boolean>
  screenshot: Blob | null
  logs?: LogsAttachment | null
  /** Raw gzipped replay bytes (application/gzip); omitted when replay disabled or unavailable. */
  replayBytes?: Uint8Array | null
  dwellMs?: number
  honeypot?: string
}

export interface IntakeResult {
  ok: true
  id: string
  replayDisabled: boolean
}

export interface IntakeError {
  ok: false
  status: number
  message: string
}

export async function postReport(
  config: ResolvedConfig,
  input: IntakeInput,
): Promise<IntakeResult | IntakeError> {
  const body = new FormData()
  body.set(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey: config.projectKey,
          title: input.title,
          description: input.description,
          context: input.context,
          ...(input.metadata ? { metadata: input.metadata } : {}),
          ...(input.dwellMs !== undefined ? { _dwellMs: input.dwellMs } : {}),
          ...(input.honeypot !== undefined ? { _hp: input.honeypot } : {}),
        }),
      ],
      { type: "application/json" },
    ),
  )
  if (input.screenshot) body.set("screenshot", input.screenshot, "screenshot.png")
  if (input.logs) {
    body.set(
      "logs",
      new Blob([JSON.stringify(input.logs)], { type: "application/json" }),
      "logs.json",
    )
  }
  if (input.replayBytes && input.replayBytes.length > 0) {
    body.set(
      "replay",
      new Blob([input.replayBytes], { type: "application/gzip" }),
      "replay.json.gz",
    )
  }

  try {
    const res = await fetch(`${config.endpoint}/api/intake/reports`, {
      method: "POST",
      body,
      credentials: "omit",
      signal: AbortSignal.timeout(30_000),
    })
    if (res.ok) {
      const data = (await res.json()) as IntakeResponse
      return { ok: true, id: data.id, replayDisabled: Boolean(data.replayDisabled) }
    }
    let message = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { statusMessage?: string; message?: string }
      message = data.statusMessage ?? data.message ?? message
    } catch {
      // non-JSON error — keep HTTP status
    }
    return { ok: false, status: res.status, message }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : "Network error",
    }
  }
}
```

- [ ] **Step 2: Update the submit path in `packages/core/src/index.ts`** — accept a `replay` config field on `init()`, pass it to collectors, expose `feedback.pauseReplay()` / `resumeReplay()` on the returned handle, call `flushReplay` at submit, attach bytes, and call `markReplayDisabled` if the server signals it.

In the `FeedbackConfig` / `init()` input type, add:

```ts
  replay?: {
    enabled?: boolean
    masking?: "strict" | "moderate" | "minimal"
    maskSelectors?: string[]
    blockSelectors?: string[]
    maxBytes?: number
  }
```

Pass `config.replay` into `registerAllCollectors({ ..., replay: config.replay })`.

Extend the public handle returned by `init()` to include:

```ts
  pauseReplay: () => collectors.pauseReplay(),
  resumeReplay: () => collectors.resumeReplay(),
```

Inside `init()`'s submit handler (around `onSubmit: async ({ ... }) => { ... }`), change to:

```ts
    onSubmit: async ({ title, description, screenshot, dwellMs, honeypot }) => {
      const snapshot = collectors.snapshotAll()
      const final = collectors.applyBeforeSend({
        title,
        description,
        context: { ...snapshot.systemInfo, reporter: identity, ...( { cookies: snapshot.cookies } as const ) },
        logs: snapshot.logs,
        screenshot,
      })
      if (!final) return { ok: false, status: 0, message: "blocked by beforeSend" }
      const replay = await collectors.flushReplay()
      const result = await postReport(config, {
        title: final.title,
        description: final.description,
        context: final.context,
        screenshot: final.screenshot,
        logs: final.logs,
        replayBytes: replay.bytes,
        dwellMs,
        honeypot,
      })
      if (result.ok && result.replayDisabled) {
        collectors.markReplayDisabled()
      }
      return result
    },
```

*(Shape the surrounding `init` code to match existing patterns in this file — the only additions are the `flushReplay()` call, the `replayBytes` on the postReport call, and the `markReplayDisabled()` branch.)*

- [ ] **Step 3: Typecheck core**

Run: `cd packages/core && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core
git commit -m "feat(sdk): core submit path attaches replay part; honors replayDisabled response"
```

---

## Task 15: Dashboard schema — `projects.replayEnabled` + env

**Files:**
- Modify: `apps/dashboard/server/db/schema/projects.ts`
- Modify: `apps/dashboard/server/lib/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add `replayEnabled` to `apps/dashboard/server/db/schema/projects.ts`**

Inside the `pgTable("projects", { ... })` column object add:

```ts
replayEnabled: boolean("replay_enabled").notNull().default(true),
```

Ensure `boolean` is imported from `drizzle-orm/pg-core` (it probably is).

- [ ] **Step 2: Extend env schema in `apps/dashboard/server/lib/env.ts`**

Inside the `Schema = z.object({ ... })`, add:

```ts
  REPLAY_FEATURE_ENABLED: boolString.default(true),
  INTAKE_REPLAY_MAX_BYTES: intString(1_048_576),
```

- [ ] **Step 3: Document in `.env.example`** — append:

```
# --- Session replay ---
# Enable session replay across the whole install (true) or disable entirely (false).
REPLAY_FEATURE_ENABLED=true
# Max gzipped bytes accepted per replay attachment (default 1 MB).
INTAKE_REPLAY_MAX_BYTES=1048576
```

- [ ] **Step 4: Push schema**

```bash
bun run db:push
```

Expected: no interactive prompts; `projects.replay_enabled` column added.

- [ ] **Step 5: Typecheck**

Run: `cd apps/dashboard && bunx vue-tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/server/db/schema/projects.ts apps/dashboard/server/lib/env.ts .env.example
git commit -m "feat(db): projects.replayEnabled + replay env config"
```

---

## Task 16: Dashboard intake — accept `replay` multipart part

**Files:**
- Modify: `apps/dashboard/server/api/intake/reports.ts`
- Create: `apps/dashboard/tests/api/replay-intake.test.ts`

- [ ] **Step 1: Write failing integration test** — `apps/dashboard/tests/api/replay-intake.test.ts`

```ts
import { setup } from "@nuxt/test-utils/e2e"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { sql } from "drizzle-orm"
import { createUser, makePngBlob, seedProject, truncateDomain, truncateReports } from "../helpers"
import { db } from "../../server/db"
import { projects, reportAttachments } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(15000)

const PK = "ft_pk_ABCDEF1234567890abcdef12"
const ORIGIN = "http://localhost:4000"

async function gzipOf(input: string): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip")
  const stream = new Blob([new TextEncoder().encode(input)]).stream().pipeThrough(cs)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function buildReportJSON(): string {
  return JSON.stringify({
    projectKey: PK,
    title: "E test",
    description: "d",
    context: {
      pageUrl: "http://localhost:4000/p",
      userAgent: "UA",
      viewport: { w: 1000, h: 800 },
      timestamp: new Date().toISOString(),
    },
    _dwellMs: 2000,
  })
}

describe("replay intake", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("happy path: replay part persists as attachment with kind='replay'", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({ name: "Demo", publicKey: PK, allowedOrigins: [ORIGIN], createdBy: admin })
    const replay = await gzipOf(JSON.stringify([{ type: 4, data: { href: "x", width: 1, height: 1 }, timestamp: 1 }]))
    const fd = new FormData()
    fd.set("report", new Blob([buildReportJSON()], { type: "application/json" }))
    fd.set("screenshot", makePngBlob(), "s.png")
    fd.set("replay", new Blob([replay], { type: "application/gzip" }), "replay.json.gz")
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: fd,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; replayStored?: boolean; replayDisabled?: boolean }
    expect(body.replayStored).toBe(true)
    expect(body.replayDisabled).toBeFalsy()
    const atts = await db
      .select()
      .from(reportAttachments)
      .where(sql`report_id = ${body.id}`)
    const replayRow = atts.find((a) => a.kind === "replay")
    expect(replayRow).toBeDefined()
    expect(replayRow?.contentType).toBe("application/gzip")
  })

  test("missing replay part: report still created (backward compat)", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({ name: "Demo", publicKey: PK, allowedOrigins: [ORIGIN], createdBy: admin })
    const fd = new FormData()
    fd.set("report", new Blob([buildReportJSON()], { type: "application/json" }))
    fd.set("screenshot", makePngBlob(), "s.png")
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: fd,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; replayStored?: boolean }
    expect(body.replayStored).toBeFalsy()
  })

  test("project.replayEnabled=false: replay silently dropped, 201 with signal", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    await db.update(projects).set({ replayEnabled: false }).where(sql`id = ${projectId}`)
    const replay = await gzipOf("[]")
    const fd = new FormData()
    fd.set("report", new Blob([buildReportJSON()], { type: "application/json" }))
    fd.set("screenshot", makePngBlob(), "s.png")
    fd.set("replay", new Blob([replay], { type: "application/gzip" }), "replay.json.gz")
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: fd,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; replayStored?: boolean; replayDisabled?: boolean }
    expect(body.replayStored).toBe(false)
    expect(body.replayDisabled).toBe(true)
    const atts = await db
      .select()
      .from(reportAttachments)
      .where(sql`report_id = ${body.id}`)
    expect(atts.find((a) => a.kind === "replay")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests — verify fail**

Start dev server (`bun run dev`) in a second terminal, then:

Run: `cd apps/dashboard && bun test tests/api/replay-intake.test.ts`
Expected: FAIL on the first test — the replay part isn't handled yet.

- [ ] **Step 3: Handle the replay part in `apps/dashboard/server/api/intake/reports.ts`**

Find the block where `screenshotPart` + `logsPart` are read and persisted, and add the replay branch. Inside the handler, after the daily-ceiling transaction block (`const report = txResult.report ...`), read the replay part and decide whether to persist. Then include the result in the 201 response.

Add:

```ts
  const replayPart = parts.find((p) => p.name === "replay")
  const replayFeatureOn = env.REPLAY_FEATURE_ENABLED
  const projectAllowsReplay = project.replayEnabled
  const replayDisabled = !replayFeatureOn || !projectAllowsReplay
  let replayStored = false

  if (replayPart?.data && replayPart.data.length > 0) {
    if (replayPart.data.length > env.INTAKE_REPLAY_MAX_BYTES) {
      throw createError({ statusCode: 413, statusMessage: "Replay payload too large" })
    }
    if (replayDisabled) {
      // Silently drop — success-with-signal semantics (see spec §6).
    } else {
      const storage = await getStorage()
      const key = `${report.id}/replay.json.gz`
      await storage.put(key, new Uint8Array(replayPart.data), "application/gzip")
      await db.insert(reportAttachments).values({
        reportId: report.id,
        kind: "replay",
        storageKey: key,
        contentType: "application/gzip",
        sizeBytes: replayPart.data.length,
      })
      replayStored = true
    }
  }
```

Also adjust the final response. Change the last line `return { id: report.id }` to:

```ts
  return {
    id: report.id,
    ...(replayPart ? { replayStored, replayDisabled } : {}),
  }
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd apps/dashboard && bun test tests/api/replay-intake.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run full suite — verify no regression**

Run: `cd apps/dashboard && bun test`
Expected: all pass, 1 skip (auth-rate-limit).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/server/api/intake/reports.ts apps/dashboard/tests/api/replay-intake.test.ts
git commit -m "feat(intake): accept replay multipart part; silent-drop when disabled"
```

---

## Task 17: Dashboard — rrweb-player dep + Replay tab

**Files:**
- Modify: `apps/dashboard/package.json`
- Create: `apps/dashboard/app/components/report-drawer/replay-tab.vue`
- Modify: `apps/dashboard/app/components/report-drawer/drawer.vue`

- [ ] **Step 1: Add `rrweb-player` to dashboard deps**

Open `apps/dashboard/package.json` and add under `dependencies`:

```json
"rrweb-player": "^2.0.0-alpha.4",
```

Then:

```bash
bun install
```

- [ ] **Step 2: Create `apps/dashboard/app/components/report-drawer/replay-tab.vue`**

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue"

const props = defineProps<{
  projectId: string
  reportId: string
  hasReplay: boolean
}>()

const playerHost = ref<HTMLDivElement | null>(null)
const status = ref<"idle" | "loading" | "ready" | "error" | "missing">("idle")
const errorMessage = ref<string | null>(null)
let player: unknown = null

onMounted(async () => {
  if (!props.hasReplay) {
    status.value = "missing"
    return
  }
  status.value = "loading"
  try {
    const url = `/api/projects/${props.projectId}/reports/${props.reportId}/attachment?kind=replay`
    const res = await fetch(url, { credentials: "include" })
    if (!res.ok) throw new Error(`attachment fetch failed: ${res.status}`)
    const gzipped = await res.arrayBuffer()
    const ds = new DecompressionStream("gzip")
    const stream = new Blob([gzipped]).stream().pipeThrough(ds)
    const text = await new Response(stream).text()
    const events = JSON.parse(text) as Array<{ type: number; data: unknown; timestamp: number }>
    if (!playerHost.value) return
    const { default: Player } = await import("rrweb-player")
    // Stylesheet import side-effects get picked up by Vite's dep optimizer.
    await import("rrweb-player/dist/style.css")
    player = new Player({
      target: playerHost.value,
      props: { events, autoPlay: false, showController: true },
    })
    status.value = "ready"
  } catch (err) {
    status.value = "error"
    errorMessage.value = err instanceof Error ? err.message : "unknown error"
  }
})

onBeforeUnmount(() => {
  if (player && typeof (player as { $destroy?: () => void }).$destroy === "function") {
    ;(player as { $destroy: () => void }).$destroy()
  }
})
</script>

<template>
  <div>
    <div v-if="status === 'missing'" class="text-sm text-neutral-500 p-6 text-center">
      No replay captured for this report.
    </div>
    <div v-else-if="status === 'loading'" class="text-sm text-neutral-500 p-6 text-center">
      Loading replay…
    </div>
    <div v-else-if="status === 'error'" class="text-sm text-red-600 p-6 text-center">
      Replay unavailable. {{ errorMessage }}
    </div>
    <div ref="playerHost" class="w-full min-h-[400px]" />
  </div>
</template>
```

- [ ] **Step 3: Wire the Replay tab into `apps/dashboard/app/components/report-drawer/drawer.vue`**

Follow the existing tab pattern in the file. Add a new tab entry (label "Replay") and a conditional component render that passes `projectId`, `reportId`, and a boolean indicating whether the `ReportDetailDTO.attachments` array contains a `kind: 'replay'` entry.

Example additions (adapt to the actual structure of drawer.vue):

```ts
import ReplayTab from "./replay-tab.vue"
// ...inside the tab list computed:
// { id: "replay", label: "Replay" }
// ...inside the template:
// <ReplayTab v-else-if="activeTab === 'replay'" :project-id="projectId" :report-id="report.id" :has-replay="hasReplay" />
// where hasReplay = computed(() => report.attachments.some((a) => a.kind === 'replay'))
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/dashboard && bunx vue-tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/package.json apps/dashboard/bun.lock apps/dashboard/app/components/report-drawer
git commit -m "feat(dashboard): Replay tab with lazy-loaded rrweb-player"
```

---

## Task 18: Project settings toggle for replay

**Files:**
- Modify: `apps/dashboard/app/pages/projects/[id]/settings/index.vue`
- Modify: `apps/dashboard/server/api/projects/[id]/index.patch.ts` (or equivalent update endpoint)

- [ ] **Step 1: Extend the project PATCH endpoint to accept `replayEnabled`**

Open `apps/dashboard/server/api/projects/[id]/index.patch.ts`. Find the `UpdateProjectInput` schema (likely in `@feedback-tool/shared` or inline). Add `replayEnabled: z.boolean().optional()` to the schema, and include it in the update `set({...})` call:

```ts
      ...(body.replayEnabled !== undefined ? { replayEnabled: body.replayEnabled } : {}),
```

- [ ] **Step 2: Add a toggle to the settings page**

Open `apps/dashboard/app/pages/projects/[id]/settings/index.vue` and follow the existing pattern for other boolean settings (`allowedEmailDomains`, `signupGated`). Add a checkbox bound to `project.replayEnabled` and wire an `updateReplayEnabled` handler that PATCHes the endpoint.

Skeleton:

```vue
<label class="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    :checked="project.replayEnabled"
    @change="updateReplayEnabled(($event.target as HTMLInputElement).checked)"
  />
  <span>Enable session replay for this project</span>
</label>
```

And in `<script setup>`:

```ts
async function updateReplayEnabled(enabled: boolean) {
  await $fetch(`/api/projects/${project.id}`, {
    method: "PATCH",
    body: { replayEnabled: enabled },
  })
  await refresh()
}
```

*(Adapt to the existing composable pattern used for other project updates on this page.)*

- [ ] **Step 3: Typecheck**

Run: `cd apps/dashboard && bunx vue-tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/server/api/projects apps/dashboard/app/pages/projects
git commit -m "feat(dashboard): project settings toggle for replay"
```

---

## Task 19: Close open question + update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `CLAUDE.md` §4 file-map to note `packages/recorder` no longer pending**

Find the line:

```
│   ├── recorder/               # 30s rolling DOM replay buffer (pending — sub-project E)
```

Change to:

```
│   ├── recorder/               # 30s rolling DOM replay buffer (v0.7.x)
```

- [ ] **Step 2: Close §8 open question #2**

Find the "SDK" section of open questions. Edit question #2:

```
2. **Recorder format** — rrweb events, custom schema, or raw WebM via `MediaRecorder`?
```

Change to:

```
2. **Recorder format** — **Resolved:** hand-written rrweb-compatible event subset in `packages/recorder`; dashboard replay uses `rrweb-player` against the same schema. See `docs/superpowers/specs/2026-04-18-session-replay-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: close open question #2 (recorder format); recorder package no longer pending"
```

---

## Task 20: End-to-end smoke check

- [ ] **Step 1: Run full lint + typecheck + tests**

```bash
bun run check
cd apps/dashboard && bunx vue-tsc --noEmit
```

Start dev server, then:

```bash
cd apps/dashboard && bun test
bun test packages
```

Expected: 0 lint errors, 0 type errors, all tests pass (except the pre-existing skip).

- [ ] **Step 2: Manual smoke — browser demo**

```bash
bun run demo
```

Expected: in the demo page, opening the feedback widget and submitting a report produces a row in the dashboard with a Replay tab; clicking it plays back the last 30 seconds with `rrweb-player`. Password inputs are masked; `data-feedback-mask` text is masked; `data-feedback-block` subtrees are absent.

- [ ] **Step 3: Tag the release**

```bash
git tag -a v0.7.1-session-replay -m "v0.7.1-session-replay — sub-project E complete"
```
