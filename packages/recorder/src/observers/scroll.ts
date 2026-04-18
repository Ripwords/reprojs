import type { Mirror } from "../mirror"
import { EventType, IncrementalSource, type IncrementalSnapshotEvent } from "../types"

export interface ScrollObserverOptions {
  doc: Document
  mirror: Mirror
  emit(ev: IncrementalSnapshotEvent): void
  now: () => number
  throttleMs?: number
}

export function createScrollObserver(opts: ScrollObserverOptions): { start(): void; stop(): void } {
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
