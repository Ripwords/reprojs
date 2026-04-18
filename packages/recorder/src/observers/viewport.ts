import { EventType, IncrementalSource, type IncrementalSnapshotEvent } from "../types"

export interface ViewportObserverOptions {
  win: Window
  emit(ev: IncrementalSnapshotEvent): void
  now: () => number
}

export function createViewportObserver(opts: ViewportObserverOptions): {
  start(): void
  stop(): void
} {
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
