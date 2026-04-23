import { describe, expect, test } from "bun:test"
import { arrowTool } from "./arrow"
import type { ArrowShape } from "../types"

const baseCtx = {
  pressure: 1,
  color: "#e53935",
  strokeWidth: 4,
}

describe("arrowTool", () => {
  test("onPointerDown returns shape with x1==x2 and y1==y2", () => {
    const s = arrowTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 20 }) as ArrowShape
    expect(s.kind).toBe("arrow")
    expect(s.x1).toBe(10)
    expect(s.y1).toBe(20)
    expect(s.x2).toBe(10)
    expect(s.y2).toBe(20)
    expect(s.color).toBe("#e53935")
  })

  test("onPointerMove updates x2,y2 only", () => {
    const down = arrowTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 20 }) as ArrowShape
    const move = arrowTool.onPointerMove({
      ...baseCtx,
      worldX: 100,
      worldY: 200,
      shape: down,
    }) as ArrowShape
    expect(move.x1).toBe(10)
    expect(move.y1).toBe(20)
    expect(move.x2).toBe(100)
    expect(move.y2).toBe(200)
    expect(move.id).toBe(down.id)
  })

  test("onPointerUp commits if arrow has nonzero length", () => {
    const down = arrowTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 20 }) as ArrowShape
    const up = arrowTool.onPointerUp({
      ...baseCtx,
      worldX: 100,
      worldY: 100,
      shape: { ...down, x2: 100, y2: 100 },
    })
    expect(up).not.toBeNull()
  })

  test("onPointerUp discards a zero-length arrow", () => {
    const down = arrowTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 20 }) as ArrowShape
    const up = arrowTool.onPointerUp({ ...baseCtx, worldX: 10, worldY: 20, shape: down })
    expect(up).toBeNull()
  })
})
