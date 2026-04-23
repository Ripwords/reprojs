export type Tool = "arrow" | "rect" | "pen" | "highlight" | "text"

export interface ShapeBase {
  id: string
  color: string
  strokeWidth: number
}

export interface ArrowShape extends ShapeBase {
  kind: "arrow"
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface RectShape extends ShapeBase {
  kind: "rect"
  x: number
  y: number
  w: number
  h: number
}

export interface PenPoint {
  x: number
  y: number
  p: number
}

export interface PenShape extends ShapeBase {
  kind: "pen"
  points: PenPoint[]
}

export interface HighlightShape extends ShapeBase {
  kind: "highlight"
  x: number
  y: number
  w: number
  h: number
}

export interface TextShape extends ShapeBase {
  kind: "text"
  x: number
  y: number
  w: number
  h: number
  content: string
  fontSize: number
}

export type Shape = ArrowShape | RectShape | PenShape | HighlightShape | TextShape

export interface Transform {
  scale: number
  panX: number
  panY: number
}

export const IDENTITY_TRANSFORM: Transform = { scale: 1, panX: 0, panY: 0 }

export const PALETTE = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5"] as const
export type Swatch = (typeof PALETTE)[number]

export const STROKE_WIDTHS = [2, 4, 6, 8] as const
export type StrokeWidth = (typeof STROKE_WIDTHS)[number]

export const MIN_SCALE = 0.25
export const MAX_SCALE = 4
