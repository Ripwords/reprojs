import type { Mirror } from "../mirror"
import {
  EventType,
  IncrementalSource,
  MouseInteractions,
  PointerTypes,
  type IncrementalSnapshotEvent,
} from "../types"

// Re-export as `MouseInteractionType` for ergonomic import parity with the
// previous symbol name. Values are identical to rrweb's MouseInteractions.
export const MouseInteractionType = MouseInteractions

export interface MouseInteractionOptions {
  doc: Document
  mirror: Mirror
  emit(ev: IncrementalSnapshotEvent): void
  now: () => number
}

function coercePointerType(raw: string | undefined): PointerTypes | undefined {
  if (!raw) return undefined
  if (raw === "mouse") return PointerTypes.Mouse
  if (raw === "pen") return PointerTypes.Pen
  if (raw === "touch") return PointerTypes.Touch
  return undefined
}

export function createMouseInteractionObserver(opts: MouseInteractionOptions): {
  start(): void
  stop(): void
} {
  const handlers: Array<[string, (e: Event) => void]> = [
    ["click", (e) => record(e, MouseInteractions.Click)],
    ["dblclick", (e) => record(e, MouseInteractions.DblClick)],
    ["mousedown", (e) => record(e, MouseInteractions.MouseDown)],
    ["mouseup", (e) => record(e, MouseInteractions.MouseUp)],
    ["contextmenu", (e) => record(e, MouseInteractions.ContextMenu)],
    ["focusin", (e) => record(e, MouseInteractions.Focus)],
    ["focusout", (e) => record(e, MouseInteractions.Blur)],
    // Touch taps — rrweb-player animates `.touch-active` on TouchStart and
    // requires TouchEnd to clear the state. Without these, mobile replays
    // have no tap feedback and touch events feel invisible.
    ["touchstart", (e) => record(e, MouseInteractions.TouchStart)],
    ["touchend", (e) => record(e, MouseInteractions.TouchEnd)],
    ["touchcancel", (e) => record(e, MouseInteractions.TouchCancel)],
  ]

  function record(e: Event, type: MouseInteractions): void {
    const target = e.target as Node | null
    if (!target) return
    const id = opts.mirror.getId(target)
    if (id === undefined) return

    // Extract x/y — prefer pointerEvent.clientX/Y; fall back to first touch
    // for TouchEvents on browsers without unified PointerEvents.
    let x = 0
    let y = 0
    let pointerType: PointerTypes | undefined
    const pointer = e as PointerEvent
    if (typeof pointer.clientX === "number" && typeof pointer.clientY === "number") {
      x = Math.round(pointer.clientX)
      y = Math.round(pointer.clientY)
      pointerType = coercePointerType(pointer.pointerType)
    } else {
      const touch = e as TouchEvent
      const first = touch.changedTouches?.[0] ?? touch.touches?.[0]
      if (first) {
        x = Math.round(first.clientX)
        y = Math.round(first.clientY)
      }
      // All TouchEvent-derived interactions imply pointerType=Touch.
      pointerType = PointerTypes.Touch
    }

    opts.emit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.MouseInteraction,
        type,
        id,
        x,
        y,
        ...(pointerType !== undefined ? { pointerType } : {}),
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
