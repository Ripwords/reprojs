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
 *
 * Supports pause/resume to freeze the rolling window. Used by the recorder
 * when the report wizard opens — without this, a 60s pause for the user to
 * annotate would shift the cutoff forward by 60s and evict all pre-pause
 * activity on the very next push after resume.
 */
export class EventBuffer {
  private entries: Entry[] = []
  private totalBytes = 0
  private pausedAt: number | null = null
  private accumulatedPauseMs = 0
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

  pause(): void {
    if (this.pausedAt !== null) return
    this.pausedAt = this.now()
  }

  resume(): void {
    if (this.pausedAt === null) return
    this.accumulatedPauseMs += this.now() - this.pausedAt
    this.pausedAt = null
  }

  private evictOldTimestamps(): void {
    // Subtract paused time so the window measures *recording* age, not
    // wall-clock age. Without this, a long pause+resume would evict every
    // pre-pause event on the next push.
    const cutoff = this.now() - this.accumulatedPauseMs - this.windowMs
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
