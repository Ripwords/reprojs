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
 * When no `now` is injected, the buffer uses the newest seen event timestamp
 * as its clock reference — event timestamps and wall-clock time may disagree
 * (e.g. if the host app uses a monotonic source), and for eviction purposes
 * we only care about the relative age of events within the stream.
 */
export class EventBuffer {
  private entries: Entry[] = []
  private totalBytes = 0
  private newestTs = 0
  private readonly windowMs: number
  private readonly maxBytes: number
  private readonly now: () => number

  constructor(opts: BufferOptions) {
    this.windowMs = opts.windowMs
    this.maxBytes = opts.maxBytes
    this.now = opts.now ?? (() => this.newestTs)
  }

  push(event: RecorderEvent): void {
    const bytes = estimateBytes(event)
    if (event.timestamp > this.newestTs) this.newestTs = event.timestamp
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
    this.newestTs = 0
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
