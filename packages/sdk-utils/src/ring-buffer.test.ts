// packages/ui/src/collectors/ring-buffer.test.ts
import { describe, expect, test } from "bun:test"
import { RingBuffer } from "./ring-buffer"

describe("RingBuffer", () => {
  test("push and drain preserve insertion order", () => {
    const b = new RingBuffer<number>(3)
    b.push(1)
    b.push(2)
    b.push(3)
    expect(b.drain()).toEqual([1, 2, 3])
  })

  test("evicts oldest when over capacity", () => {
    const b = new RingBuffer<number>(3)
    b.push(1)
    b.push(2)
    b.push(3)
    b.push(4)
    b.push(5)
    expect(b.drain()).toEqual([3, 4, 5])
  })

  test("drain returns a copy and empties the buffer", () => {
    const b = new RingBuffer<number>(3)
    b.push(1)
    b.push(2)
    const first = b.drain()
    expect(first).toEqual([1, 2])
    // Mutating the returned copy does not affect the buffer.
    first.push(999)
    // After drain, the buffer must be empty — a second drain yields nothing.
    expect(b.drain()).toEqual([])
    expect(b.size()).toBe(0)
  })

  test("peek returns a copy without draining", () => {
    const b = new RingBuffer<number>(3)
    b.push(1)
    b.push(2)
    const first = b.peek()
    expect(first).toEqual([1, 2])
    // peek must not clear: repeated peeks return the same contents.
    expect(b.peek()).toEqual([1, 2])
    expect(b.size()).toBe(2)
  })

  test("clear empties the buffer", () => {
    const b = new RingBuffer<number>(3)
    b.push(1)
    b.push(2)
    b.clear()
    expect(b.size()).toBe(0)
    expect(b.peek()).toEqual([])
  })

  test("size reflects current count", () => {
    const b = new RingBuffer<number>(3)
    expect(b.size()).toBe(0)
    b.push(1)
    b.push(2)
    expect(b.size()).toBe(2)
    b.push(3)
    b.push(4)
    expect(b.size()).toBe(3)
  })

  test("capacity of 1 keeps only latest", () => {
    const b = new RingBuffer<string>(1)
    b.push("a")
    b.push("b")
    expect(b.drain()).toEqual(["b"])
  })
})
