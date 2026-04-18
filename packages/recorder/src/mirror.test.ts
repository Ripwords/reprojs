import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { Mirror } from "./mirror"

describe("Mirror", () => {
  test("assigns unique incrementing IDs to new nodes", () => {
    const mirror = new Mirror()
    const win = new Window()
    const a = win.document.createElement("div")
    const b = win.document.createElement("span")
    expect(mirror.getOrCreateId(a as unknown as Node)).toBe(1)
    expect(mirror.getOrCreateId(b as unknown as Node)).toBe(2)
    expect(mirror.getOrCreateId(a as unknown as Node)).toBe(1) // stable
  })

  test("getNode returns the Node for a known id, or null", () => {
    const mirror = new Mirror()
    const win = new Window()
    const a = win.document.createElement("div")
    const id = mirror.getOrCreateId(a as unknown as Node)
    expect(mirror.getNode(id)).toBe(a as unknown as Node)
    expect(mirror.getNode(999)).toBeNull()
  })

  test("remove erases node from both directions", () => {
    const mirror = new Mirror()
    const win = new Window()
    const a = win.document.createElement("div")
    const id = mirror.getOrCreateId(a as unknown as Node)
    mirror.remove(a as unknown as Node)
    expect(mirror.getNode(id)).toBeNull()
    expect(mirror.has(a as unknown as Node)).toBe(false)
  })
})
