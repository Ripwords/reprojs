import { describe, expect, test } from "bun:test"
import { rectTool } from "./rect"
import type { RectShape } from "../types"

const baseCtx = { pressure: 1, color: "#1e88e5", strokeWidth: 4 }

describe("rectTool", () => {
  test("onPointerDown returns a zero-size rect at origin", () => {
    const s = rectTool.onPointerDown({ ...baseCtx, worldX: 50, worldY: 50 }) as RectShape
    expect(s.kind).toBe("rect")
    expect(s.x).toBe(50)
    expect(s.y).toBe(50)
    expect(s.w).toBe(0)
    expect(s.h).toBe(0)
  })

  test("onPointerMove expands w/h from origin", () => {
    const down = rectTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 10 }) as RectShape
    const move = rectTool.onPointerMove({
      ...baseCtx,
      worldX: 60,
      worldY: 30,
      shape: down,
    }) as RectShape
    expect(move.w).toBe(50)
    expect(move.h).toBe(20)
  })

  test("onPointerUp normalizes negative dimensions", () => {
    const down = rectTool.onPointerDown({ ...baseCtx, worldX: 100, worldY: 100 }) as RectShape
    const up = rectTool.onPointerUp({
      ...baseCtx,
      worldX: 60,
      worldY: 40,
      shape: down,
    }) as RectShape
    expect(up.x).toBe(60)
    expect(up.y).toBe(40)
    expect(up.w).toBe(40)
    expect(up.h).toBe(60)
  })

  test("onPointerUp discards a tiny rect", () => {
    const down = rectTool.onPointerDown({ ...baseCtx, worldX: 50, worldY: 50 }) as RectShape
    const up = rectTool.onPointerUp({ ...baseCtx, worldX: 51, worldY: 51, shape: down })
    expect(up).toBeNull()
  })
})
