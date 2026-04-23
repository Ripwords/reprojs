import { describe, expect, test } from "bun:test"
import { highlightTool } from "./highlight"
import type { HighlightShape } from "../types"

const baseCtx = { pressure: 1, color: "#fdd835", strokeWidth: 4 }

describe("highlightTool", () => {
  test("onPointerDown creates highlight with zero size", () => {
    const s = highlightTool.onPointerDown({
      ...baseCtx,
      worldX: 10,
      worldY: 10,
    }) as HighlightShape
    expect(s.kind).toBe("highlight")
    expect(s.x).toBe(10)
    expect(s.y).toBe(10)
    expect(s.w).toBe(0)
    expect(s.h).toBe(0)
  })

  test("onPointerUp normalizes negative dimensions", () => {
    const down = highlightTool.onPointerDown({
      ...baseCtx,
      worldX: 100,
      worldY: 100,
    }) as HighlightShape
    const up = highlightTool.onPointerUp({
      ...baseCtx,
      worldX: 40,
      worldY: 60,
      shape: down,
    }) as HighlightShape
    expect(up.x).toBe(40)
    expect(up.y).toBe(60)
    expect(up.w).toBe(60)
    expect(up.h).toBe(40)
  })

  test("onPointerUp discards a tiny highlight", () => {
    const down = highlightTool.onPointerDown({
      ...baseCtx,
      worldX: 10,
      worldY: 10,
    }) as HighlightShape
    const up = highlightTool.onPointerUp({
      ...baseCtx,
      worldX: 11,
      worldY: 11,
      shape: down,
    })
    expect(up).toBeNull()
  })
})
