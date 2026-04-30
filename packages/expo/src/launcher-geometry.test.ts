import { describe, expect, test } from "bun:test"
import {
  anchorToCenter,
  computeBounds,
  cornerToAnchor,
  isAnchor,
  nearestEdgeAnchor,
} from "./launcher-geometry"

const SIZE = 52
const MARGIN = 24
const WIN = { width: 400, height: 800 }
const OFFSET = {} as const

describe("cornerToAnchor", () => {
  test("bottom-right → right edge bottom", () => {
    expect(cornerToAnchor("bottom-right")).toEqual({ edge: "right", along: 1 })
  })
  test("bottom-left → left edge bottom", () => {
    expect(cornerToAnchor("bottom-left")).toEqual({ edge: "left", along: 1 })
  })
  test("top-right → right edge top", () => {
    expect(cornerToAnchor("top-right")).toEqual({ edge: "right", along: 0 })
  })
  test("top-left → left edge top", () => {
    expect(cornerToAnchor("top-left")).toEqual({ edge: "left", along: 0 })
  })
})

describe("isAnchor", () => {
  test("accepts a well-formed anchor", () => {
    expect(isAnchor({ edge: "left", along: 0.5 })).toBe(true)
    expect(isAnchor({ edge: "right", along: 0 })).toBe(true)
    expect(isAnchor({ edge: "top", along: 1 })).toBe(true)
    expect(isAnchor({ edge: "bottom", along: 0.25 })).toBe(true)
  })
  test("rejects unknown edges", () => {
    expect(isAnchor({ edge: "diagonal", along: 0.5 })).toBe(false)
  })
  test("rejects out-of-range along", () => {
    expect(isAnchor({ edge: "left", along: -0.1 })).toBe(false)
    expect(isAnchor({ edge: "left", along: 1.1 })).toBe(false)
  })
  test("rejects missing fields and non-objects", () => {
    expect(isAnchor({ edge: "left" })).toBe(false)
    expect(isAnchor({ along: 0.5 })).toBe(false)
    expect(isAnchor(null)).toBe(false)
    expect(isAnchor("left")).toBe(false)
    expect(isAnchor(undefined)).toBe(false)
  })
})

describe("computeBounds", () => {
  test("uses DEFAULT_MARGIN + half-size to keep the launcher fully on-screen", () => {
    const b = computeBounds(OFFSET, WIN)
    expect(b.minX).toBe(MARGIN + SIZE / 2)
    expect(b.maxX).toBe(WIN.width - MARGIN - SIZE / 2)
    expect(b.minY).toBe(MARGIN + SIZE / 2)
    expect(b.maxY).toBe(WIN.height - MARGIN - SIZE / 2)
  })
  test("respects explicit per-side offsets", () => {
    const b = computeBounds({ top: 60, bottom: 30, left: 10, right: 40 }, WIN)
    expect(b.minX).toBe(10 + SIZE / 2)
    expect(b.maxX).toBe(WIN.width - 40 - SIZE / 2)
    expect(b.minY).toBe(60 + SIZE / 2)
    expect(b.maxY).toBe(WIN.height - 30 - SIZE / 2)
  })
})

describe("anchorToCenter", () => {
  const b = computeBounds(OFFSET, WIN)
  test("left edge along=0 → top-left bound center", () => {
    expect(anchorToCenter({ edge: "left", along: 0 }, b)).toEqual({ x: b.minX, y: b.minY })
  })
  test("left edge along=1 → bottom-left bound center", () => {
    expect(anchorToCenter({ edge: "left", along: 1 }, b)).toEqual({ x: b.minX, y: b.maxY })
  })
  test("right edge along=0.5 → middle-right", () => {
    expect(anchorToCenter({ edge: "right", along: 0.5 }, b)).toEqual({
      x: b.maxX,
      y: b.minY + (b.maxY - b.minY) / 2,
    })
  })
  test("top edge along=0.5 → middle-top", () => {
    expect(anchorToCenter({ edge: "top", along: 0.5 }, b)).toEqual({
      x: b.minX + (b.maxX - b.minX) / 2,
      y: b.minY,
    })
  })
  test("bottom edge along=1 → bottom-right bound center", () => {
    expect(anchorToCenter({ edge: "bottom", along: 1 }, b)).toEqual({ x: b.maxX, y: b.maxY })
  })
  test("clamps along to [0, 1]", () => {
    expect(anchorToCenter({ edge: "left", along: -1 }, b)).toEqual({ x: b.minX, y: b.minY })
    expect(anchorToCenter({ edge: "left", along: 2 }, b)).toEqual({ x: b.minX, y: b.maxY })
  })
})

describe("nearestEdgeAnchor", () => {
  const b = computeBounds(OFFSET, WIN)
  test("point near the left edge → left", () => {
    const r = nearestEdgeAnchor({ x: b.minX + 5, y: WIN.height / 2 }, b)
    expect(r.edge).toBe("left")
    expect(r.along).toBeGreaterThan(0.4)
    expect(r.along).toBeLessThan(0.6)
  })
  test("point near the right edge mid-height → right with along ~0.5", () => {
    const r = nearestEdgeAnchor({ x: b.maxX - 5, y: WIN.height / 2 }, b)
    expect(r.edge).toBe("right")
    expect(r.along).toBeGreaterThan(0.4)
    expect(r.along).toBeLessThan(0.6)
  })
  test("point near the top edge → top", () => {
    const r = nearestEdgeAnchor({ x: WIN.width / 2, y: b.minY + 5 }, b)
    expect(r.edge).toBe("top")
  })
  test("point near the bottom edge → bottom", () => {
    const r = nearestEdgeAnchor({ x: WIN.width / 2, y: b.maxY - 5 }, b)
    expect(r.edge).toBe("bottom")
  })
  test("clamps along to [0, 1] when drop is outside the bounding rect", () => {
    const r = nearestEdgeAnchor({ x: -50, y: -50 }, b)
    expect(r.edge).toBe("left")
    expect(r.along).toBe(0)
  })
  test("ties resolve deterministically (left wins over top)", () => {
    // A point exactly equidistant from left and top edges — chosen so dLeft == dTop.
    const r = nearestEdgeAnchor({ x: b.minX + 10, y: b.minY + 10 }, b)
    expect(r.edge).toBe("left")
  })
})
