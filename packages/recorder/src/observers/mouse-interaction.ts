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

export function createMouseInteractionObserver(opts: MouseInteractionOptions): {
  start(): void
  stop(): void
} {
  const handlers: Array<[string, (e: Event) => void]> = [
    ["click", (e) => record(e, MouseInteractionType.Click)],
    ["dblclick", (e) => record(e, MouseInteractionType.DblClick)],
    ["mousedown", (e) => record(e, MouseInteractionType.MouseDown)],
    ["mouseup", (e) => record(e, MouseInteractionType.MouseUp)],
    ["contextmenu", (e) => record(e, MouseInteractionType.ContextMenu)],
    ["focusin", (e) => record(e, MouseInteractionType.Focus)],
    ["focusout", (e) => record(e, MouseInteractionType.Blur)],
  ]

  function record(
    e: Event,
    type: (typeof MouseInteractionType)[keyof typeof MouseInteractionType],
  ): void {
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
