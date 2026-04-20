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

// Most tests use fabricated small timestamps (100, 200, 300). With the default
// real-wall-clock `Date.now()`, those would always be far outside the 30 s
// window. Injecting a fixed `now` anchors the window around the test data.
const NOW = 30_000

describe("EventBuffer", () => {
  test("push then flush returns events chronologically and clears state", () => {
    const buf = new EventBuffer({ windowMs: 30_000, maxBytes: 1_000_000, now: () => NOW })
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
    const buf = new EventBuffer({ windowMs: 30_000, maxBytes: 200, now: () => NOW })
    buf.push(metaEvent(100, 50))
    buf.push(metaEvent(200, 50))
    buf.push(metaEvent(300, 50)) // third push triggers eviction of the oldest
    const out = buf.flush()
    expect(out.length).toBeLessThan(3)
    expect(out[0]?.timestamp).not.toBe(100)
  })

  test("push during iteration of flush snapshot does not mutate the snapshot", () => {
    const buf = new EventBuffer({ windowMs: 30_000, maxBytes: 1_000_000, now: () => NOW })
    buf.push(metaEvent(100, 10))
    const snapshot = buf.flush()
    buf.push(metaEvent(200, 10))
    expect(snapshot.length).toBe(1)
    expect(snapshot[0]?.timestamp).toBe(100)
  })

  test("peek returns copy without clearing", () => {
    const buf = new EventBuffer({ windowMs: 30_000, maxBytes: 1_000_000, now: () => NOW })
    buf.push(metaEvent(100, 10))
    expect(buf.peek().length).toBe(1)
    expect(buf.peek().length).toBe(1)
  })

  test("truncateOldest removes N oldest events", () => {
    const buf = new EventBuffer({ windowMs: 30_000, maxBytes: 1_000_000, now: () => NOW })
    buf.push(metaEvent(100, 10))
    buf.push(metaEvent(200, 10))
    buf.push(metaEvent(300, 10))
    buf.truncateOldest(2)
    expect(buf.peek().map((e) => e.timestamp)).toEqual([300])
  })

  test("freezes the rolling window during pause so a long pause+resume preserves pre-pause events", () => {
    // The recorder pauses the buffer when the report wizard opens. Without a
    // frozen window, eviction would still measure age against wall-clock now,
    // so a 60s pause followed by a single push after resume would drop every
    // event from before the pause — defeating the pause-on-open contract.
    let now = 1_000
    const buf = new EventBuffer({ windowMs: 30_000, maxBytes: 1_000_000, now: () => now })
    buf.push(metaEvent(now - 25_000, 10)) // ts=−24,000, well within window
    buf.push(metaEvent(now - 5_000, 10)) // ts=−4,000

    buf.pause()
    now += 60_000 // user spends a minute in the wizard then cancels
    buf.resume()

    // First push after resume must NOT evict the two pre-pause events: their
    // age relative to recorded activity is still 25s + paused-time-excluded.
    buf.push(metaEvent(now, 10))
    expect(buf.peek().map((e) => e.timestamp)).toEqual([1_000 - 25_000, 1_000 - 5_000, 61_000])
  })

  test("pause/resume is idempotent — extra calls are harmless no-ops", () => {
    let now = 1_000
    const buf = new EventBuffer({ windowMs: 30_000, maxBytes: 1_000_000, now: () => now })
    buf.push(metaEvent(now - 1_000, 10))

    buf.pause()
    buf.pause() // no-op
    now += 10_000
    buf.resume()
    buf.resume() // no-op

    buf.push(metaEvent(now, 10))
    // Pre-pause event should still be present (only 1s of recorded age).
    expect(buf.peek().length).toBe(2)
  })

  test("resume without prior pause is a no-op (does not skew the cutoff)", () => {
    let now = 1_000
    const buf = new EventBuffer({ windowMs: 30_000, maxBytes: 1_000_000, now: () => now })
    buf.push(metaEvent(now - 25_000, 10))

    buf.resume() // never paused — should not silently shift the window

    now += 10_000
    buf.push(metaEvent(now, 10))

    // Window is now [11_000−30_000, 11_000] = [−19_000, 11_000]
    // Pre-event ts is −24_000 → outside window → evicted
    expect(buf.peek().map((e) => e.timestamp)).toEqual([11_000])
  })
})
