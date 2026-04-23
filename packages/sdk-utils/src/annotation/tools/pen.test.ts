import { describe, expect, test } from "bun:test"
import { penTool } from "./pen"
import type { PenShape } from "../types"

const baseCtx = { pressure: 0.8, color: "#43a047", strokeWidth: 4 }

describe("penTool", () => {
  test("onPointerDown seeds a single point", () => {
    const s = penTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 10 }) as PenShape
    expect(s.kind).toBe("pen")
    expect(s.points).toHaveLength(1)
    expect(s.points[0]).toEqual({ x: 10, y: 10, p: 0.8 })
  })

  test("onPointerMove appends points > 2px away", () => {
    const down = penTool.onPointerDown({ ...baseCtx, worldX: 0, worldY: 0 }) as PenShape
    const m1 = penTool.onPointerMove({
      ...baseCtx,
      worldX: 5,
      worldY: 0,
      shape: down,
    }) as PenShape
    expect(m1.points).toHaveLength(2)
  })

  test("onPointerMove skips points within 2px of previous", () => {
    const down = penTool.onPointerDown({ ...baseCtx, worldX: 0, worldY: 0 }) as PenShape
    const m1 = penTool.onPointerMove({
      ...baseCtx,
      worldX: 1,
      worldY: 0,
      shape: down,
    }) as PenShape
    expect(m1.points).toHaveLength(1)
  })

  test("onPointerUp commits if stroke has >= 2 points", () => {
    const down = penTool.onPointerDown({ ...baseCtx, worldX: 0, worldY: 0 }) as PenShape
    const withTwo: PenShape = {
      ...down,
      points: [
        { x: 0, y: 0, p: 1 },
        { x: 10, y: 10, p: 1 },
      ],
    }
    const up = penTool.onPointerUp({
      ...baseCtx,
      worldX: 20,
      worldY: 20,
      shape: withTwo,
    }) as PenShape
    expect(up).not.toBeNull()
    expect(up.points.length).toBeGreaterThanOrEqual(2)
  })

  test("onPointerUp discards a single-tap stroke", () => {
    const down = penTool.onPointerDown({ ...baseCtx, worldX: 0, worldY: 0 }) as PenShape
    const up = penTool.onPointerUp({ ...baseCtx, worldX: 0, worldY: 0, shape: down })
    expect(up).toBeNull()
  })
})
