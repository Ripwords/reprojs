import { describe, expect, test } from "bun:test"
import { clampPan, fitTransform, isInsideImage, screenToWorld, zoomAt } from "./viewport"
import type { Transform } from "@reprojs/sdk-utils"

const rect = { left: 0, top: 0, width: 1000, height: 700 } as DOMRect
const identity: Transform = { scale: 1, panX: 0, panY: 0 }

describe("screenToWorld", () => {
  test("identity transform is a no-op (minus rect offset)", () => {
    expect(screenToWorld(250, 100, rect, identity)).toEqual({ worldX: 250, worldY: 100 })
  })

  test("accounts for scale and pan", () => {
    const t: Transform = { scale: 2, panX: 100, panY: 50 }
    expect(screenToWorld(300, 250, rect, t)).toEqual({ worldX: 100, worldY: 100 })
  })

  test("accounts for non-zero rect offset", () => {
    const shifted = { left: 40, top: 20, width: 1000, height: 700 } as DOMRect
    expect(screenToWorld(140, 120, shifted, identity)).toEqual({ worldX: 100, worldY: 100 })
  })
})

describe("zoomAt", () => {
  test("world point under cursor stays fixed across zoom", () => {
    const before: Transform = { scale: 1, panX: 0, panY: 0 }
    const beforeWorld = screenToWorld(500, 300, rect, before)
    const after = zoomAt(500, 300, 2, before)
    const afterWorld = screenToWorld(500, 300, rect, after)
    expect(afterWorld.worldX).toBeCloseTo(beforeWorld.worldX, 5)
    expect(afterWorld.worldY).toBeCloseTo(beforeWorld.worldY, 5)
  })

  test("clamps to MIN_SCALE and MAX_SCALE", () => {
    const zoomedOut = zoomAt(500, 300, 0.001, identity)
    expect(zoomedOut.scale).toBe(0.25)
    const zoomedIn = zoomAt(500, 300, 1000, identity)
    expect(zoomedIn.scale).toBe(4)
  })
})

describe("fitTransform", () => {
  test("scales down a large image to fit the canvas", () => {
    const t = fitTransform(2000, 1400, 1000, 700)
    expect(t.scale).toBe(0.5)
    expect(t.panX).toBe(0)
    expect(t.panY).toBe(0)
  })

  test("centers a small image inside the canvas", () => {
    const t = fitTransform(200, 100, 1000, 700)
    expect(t.scale).toBe(1)
    expect(t.panX).toBe(400)
    expect(t.panY).toBe(300)
  })

  test("fits the longer dimension", () => {
    const t = fitTransform(2000, 100, 1000, 700)
    expect(t.scale).toBe(0.5)
  })
})

describe("clampPan", () => {
  test("prevents panning the image fully off-screen", () => {
    const t: Transform = { scale: 1, panX: -9999, panY: 0 }
    const clamped = clampPan(t, 500, 400, 1000, 700)
    expect(clamped.panX).toBe(-500 + 100)
  })
})

describe("isInsideImage", () => {
  test("returns true for points inside", () => {
    expect(isInsideImage(50, 50, 100, 100)).toBe(true)
  })
  test("returns false for points outside", () => {
    expect(isInsideImage(-1, 50, 100, 100)).toBe(false)
    expect(isInsideImage(50, 101, 100, 100)).toBe(false)
  })
})
