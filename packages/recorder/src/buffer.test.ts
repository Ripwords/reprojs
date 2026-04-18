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
