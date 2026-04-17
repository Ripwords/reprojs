import type { Shape } from "../types"

export interface ToolContext {
  worldX: number
  worldY: number
  pressure: number
  color: string
  strokeWidth: number
  shape?: Shape
}

export interface ToolHandler {
  onPointerDown(ctx: ToolContext): Shape
  onPointerMove(ctx: ToolContext): Shape
  onPointerUp(ctx: ToolContext): Shape | null
}
