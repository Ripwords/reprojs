import { newShapeId } from "../id"
import type { Shape, TextShape } from "../types"
import type { ToolContext, ToolHandler } from "./index"

const MIN_SIDE = 12
const DEFAULT_FONT_SIZE = 14

export const textTool: ToolHandler = {
  onPointerDown(ctx: ToolContext): Shape {
    const s: TextShape = {
      kind: "text",
      id: newShapeId(),
      color: ctx.color,
      strokeWidth: ctx.strokeWidth,
      x: ctx.worldX,
      y: ctx.worldY,
      w: 0,
      h: 0,
      content: "",
      fontSize: DEFAULT_FONT_SIZE,
    }
    return s
  },
  onPointerMove(ctx: ToolContext): Shape {
    const s = ctx.shape as TextShape
    return { ...s, w: ctx.worldX - s.x, h: ctx.worldY - s.y }
  },
  onPointerUp(ctx: ToolContext): Shape | null {
    const s = ctx.shape as TextShape
    const x = Math.min(s.x, ctx.worldX)
    const y = Math.min(s.y, ctx.worldY)
    const w = Math.abs(ctx.worldX - s.x)
    const h = Math.abs(ctx.worldY - s.y)
    if (w < MIN_SIDE || h < MIN_SIDE) return null
    return { ...s, x, y, w, h }
  },
}
