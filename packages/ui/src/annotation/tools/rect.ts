import { newShapeId } from "../store"
import type { RectShape, Shape } from "../types"
import type { ToolContext, ToolHandler } from "./index"

const MIN_SIDE = 4

export const rectTool: ToolHandler = {
  onPointerDown(ctx: ToolContext): Shape {
    const s: RectShape = {
      kind: "rect",
      id: newShapeId(),
      color: ctx.color,
      strokeWidth: ctx.strokeWidth,
      x: ctx.worldX,
      y: ctx.worldY,
      w: 0,
      h: 0,
    }
    return s
  },
  onPointerMove(ctx: ToolContext): Shape {
    const s = ctx.shape as RectShape
    return { ...s, w: ctx.worldX - s.x, h: ctx.worldY - s.y }
  },
  onPointerUp(ctx: ToolContext): Shape | null {
    const s = ctx.shape as RectShape
    const x = Math.min(s.x, ctx.worldX)
    const y = Math.min(s.y, ctx.worldY)
    const w = Math.abs(ctx.worldX - s.x)
    const h = Math.abs(ctx.worldY - s.y)
    if (w < MIN_SIDE || h < MIN_SIDE) return null
    return { ...s, x, y, w, h }
  },
}
