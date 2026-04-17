import { newShapeId } from "../store"
import type { PenShape, Shape } from "../types"
import type { ToolContext, ToolHandler } from "./index"

const MIN_DISTANCE_SQ = 2 * 2

export const penTool: ToolHandler = {
  onPointerDown(ctx: ToolContext): Shape {
    const s: PenShape = {
      kind: "pen",
      id: newShapeId(),
      color: ctx.color,
      strokeWidth: ctx.strokeWidth,
      points: [{ x: ctx.worldX, y: ctx.worldY, p: ctx.pressure }],
    }
    return s
  },
  onPointerMove(ctx: ToolContext): Shape {
    const s = ctx.shape as PenShape
    const last = s.points[s.points.length - 1]!
    const dx = ctx.worldX - last.x
    const dy = ctx.worldY - last.y
    if (dx * dx + dy * dy < MIN_DISTANCE_SQ) return s
    return {
      ...s,
      points: [...s.points, { x: ctx.worldX, y: ctx.worldY, p: ctx.pressure }],
    }
  },
  onPointerUp(ctx: ToolContext): Shape | null {
    const s = ctx.shape as PenShape
    const last = s.points[s.points.length - 1]!
    const addLast =
      last.x !== ctx.worldX || last.y !== ctx.worldY
        ? [...s.points, { x: ctx.worldX, y: ctx.worldY, p: ctx.pressure }]
        : s.points
    if (addLast.length < 2) return null
    return { ...s, points: addLast }
  },
}
