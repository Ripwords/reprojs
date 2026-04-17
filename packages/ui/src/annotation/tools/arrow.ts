import { newShapeId } from "../store"
import type { ArrowShape, Shape } from "../types"
import type { ToolContext, ToolHandler } from "./index"

const MIN_LENGTH_SQ = 4 * 4

export const arrowTool: ToolHandler = {
  onPointerDown(ctx: ToolContext): Shape {
    const s: ArrowShape = {
      kind: "arrow",
      id: newShapeId(),
      color: ctx.color,
      strokeWidth: ctx.strokeWidth,
      x1: ctx.worldX,
      y1: ctx.worldY,
      x2: ctx.worldX,
      y2: ctx.worldY,
    }
    return s
  },
  onPointerMove(ctx: ToolContext): Shape {
    const s = ctx.shape as ArrowShape
    return { ...s, x2: ctx.worldX, y2: ctx.worldY }
  },
  onPointerUp(ctx: ToolContext): Shape | null {
    const s = ctx.shape as ArrowShape
    const final: ArrowShape = { ...s, x2: ctx.worldX, y2: ctx.worldY }
    const dx = final.x2 - final.x1
    const dy = final.y2 - final.y1
    if (dx * dx + dy * dy < MIN_LENGTH_SQ) return null
    return final
  },
}
