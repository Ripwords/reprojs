import { describe, expect, test } from "bun:test"
import { textTool } from "./text"
import type { TextShape } from "../types"

const baseCtx = { pressure: 1, color: "#111111", strokeWidth: 2 }

describe("textTool (drag-rect phase only)", () => {
  test("onPointerDown creates a text shape with empty content", () => {
    const s = textTool.onPointerDown({ ...baseCtx, worldX: 10, worldY: 10 }) as TextShape
    expect(s.kind).toBe("text")
    expect(s.content).toBe("")
    expect(s.fontSize).toBe(14)
  })

  test("onPointerUp normalizes w/h and discards tiny boxes", () => {
    const down = textTool.onPointerDown({ ...baseCtx, worldX: 100, worldY: 100 }) as TextShape
    const ok = textTool.onPointerUp({
      ...baseCtx,
      worldX: 40,
      worldY: 40,
      shape: down,
    }) as TextShape
    expect(ok.x).toBe(40)
    expect(ok.y).toBe(40)
    expect(ok.w).toBe(60)
    expect(ok.h).toBe(60)

    const tiny = textTool.onPointerUp({
      ...baseCtx,
      worldX: 101,
      worldY: 101,
      shape: down,
    })
    expect(tiny).toBeNull()
  })
})
