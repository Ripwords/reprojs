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

const now = (): number => Date.now()

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
