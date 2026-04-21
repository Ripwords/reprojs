import type { Mirror } from "../mirror"
import {
  EventType,
  IncrementalSource,
  type IncrementalSnapshotEvent,
  type MousePosition,
} from "../types"

/**
 * Mouse/touch/drag position observer.
 *
 * rrweb-player renders a cursor DIV at (0,0) by default and only moves it in
 * response to MouseMove (source=1), TouchMove (source=6), or Drag (source=12)
 * events. Without this observer the cursor appears frozen during replay —
 * clicks and focus changes teleport it between locations with no motion in
 * between, which reads as "static screen" to users watching the playback.
 *
 * The wire format batches positions across a flush interval:
 *
 *   { source, positions: [{ x, y, id, timeOffset }] }
 *
 * `timeOffset` is **negative** — the number of ms before the event's
 * `timestamp` that the position was sampled. rrweb-player adds `timeOffset` to
 * `event.timestamp` to reconstruct each sample's original time and schedules
 * the cursor move accordingly. Emitting positive offsets makes the player
 * schedule in the past → cursor jumps straight to the last position.
 *
 * Defaults match rrweb: sample at ≤20 Hz (50 ms), flush every 500 ms. A
 * FullSnapshot-heavy page produces one batched event every 500 ms with up to
 * ~10 positions, which is cheap to serialize and cheap to replay.
 */
export interface MouseMoveOptions {
  doc: Document
  mirror: Mirror
  emit(ev: IncrementalSnapshotEvent): void
  now: () => number
  /** Minimum ms between sampled positions. Default 50. */
  sampleMs?: number
  /** How often the batched positions are flushed as an event. Default 500. */
  flushMs?: number
}

type MoveSource =
  | typeof IncrementalSource.MouseMove
  | typeof IncrementalSource.TouchMove
  | typeof IncrementalSource.Drag

interface PendingPosition {
  x: number
  y: number
  id: number
  /** Absolute sample time in ms (converted to negative offset at flush). */
  sampledAt: number
}

function getPointFromEvent(e: Event): { x: number; y: number; target: EventTarget | null } | null {
  // Touch events expose .touches; prefer the first active touch. Fall back
  // to clientX/Y for mouse/drag. happy-dom's synthetic TouchEvent sometimes
  // lacks a .touches list but attaches it via ctor options — grab whichever
  // is present.
  const touchLike = e as Event & { touches?: { clientX: number; clientY: number }[] }
  if (touchLike.touches && touchLike.touches.length > 0) {
    const t = touchLike.touches[0]
    if (!t) return null
    return { x: t.clientX, y: t.clientY, target: e.target }
  }
  const m = e as MouseEvent
  if (typeof m.clientX !== "number" || typeof m.clientY !== "number") return null
  return { x: m.clientX, y: m.clientY, target: e.target }
}

export function createMouseMoveObserver(opts: MouseMoveOptions): {
  start(): void
  stop(): void
} {
  const sampleMs = opts.sampleMs ?? 50
  const flushMs = opts.flushMs ?? 500

  // One buffer per source — a single recorder instance can observe all three
  // concurrently (e.g. user is dragging with mouse AND touching with another
  // finger). Keeping them separate preserves rrweb's semantic of "one event
  // per source per flush."
  const buffers = new Map<MoveSource, PendingPosition[]>()
  let lastSampleAt = 0
  let flushTimer: ReturnType<typeof setInterval> | null = null

  function sample(source: MoveSource, e: Event): void {
    const t = opts.now()
    if (t - lastSampleAt < sampleMs) return
    const p = getPointFromEvent(e)
    if (!p || !p.target) return
    const id = opts.mirror.getId(p.target as Node)
    if (id === undefined) return
    lastSampleAt = t
    let buf = buffers.get(source)
    if (!buf) {
      buf = []
      buffers.set(source, buf)
    }
    buf.push({ x: Math.round(p.x), y: Math.round(p.y), id, sampledAt: t })
  }

  function flush(): void {
    if (buffers.size === 0) return
    const emitAt = opts.now()
    for (const [source, buf] of buffers) {
      if (buf.length === 0) continue
      const positions: MousePosition[] = buf.map((p) => ({
        x: p.x,
        y: p.y,
        id: p.id,
        // Negative offset from the event timestamp.
        timeOffset: p.sampledAt - emitAt,
      }))
      opts.emit({
        type: EventType.IncrementalSnapshot,
        data: { source, positions },
        timestamp: emitAt,
      })
      buf.length = 0
    }
  }

  const onMouseMove = (e: Event) => sample(IncrementalSource.MouseMove, e)
  const onTouchMove = (e: Event) => sample(IncrementalSource.TouchMove, e)
  const onDrag = (e: Event) => sample(IncrementalSource.Drag, e)

  return {
    start() {
      opts.doc.addEventListener("mousemove", onMouseMove, { capture: true, passive: true })
      opts.doc.addEventListener("touchmove", onTouchMove, { capture: true, passive: true })
      opts.doc.addEventListener("drag", onDrag, { capture: true, passive: true })
      // Use the global `setInterval` rather than `doc.defaultView.setInterval`.
      // Calling the method off the window object without preserving `this`
      // binding — e.g. `const f = win.setInterval; f(cb, 500)` — throws
      // "Illegal invocation" in real browsers (Chrome/Firefox/Safari), even
      // though happy-dom tolerates it. The global alias is safe.
      flushTimer = setInterval(flush, flushMs)
    },
    stop() {
      opts.doc.removeEventListener("mousemove", onMouseMove, { capture: true })
      opts.doc.removeEventListener("touchmove", onTouchMove, { capture: true })
      opts.doc.removeEventListener("drag", onDrag, { capture: true })
      if (flushTimer !== null) {
        clearInterval(flushTimer)
        flushTimer = null
      }
      // Final flush so positions captured right before stop don't vanish.
      flush()
    },
  }
}
