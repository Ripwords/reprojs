// Pure geometry helpers for the floating launcher. Extracted from launcher.tsx
// so the math (edge snapping, bound computation, drop-point → anchor) can be
// unit-tested without spinning up React Native, AsyncStorage, or gesture
// handlers.

export type Edge = "left" | "right" | "top" | "bottom"
export type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left"

export interface Anchor {
  edge: Edge
  along: number
}

export interface OffsetInput {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

export interface WindowSize {
  width: number
  height: number
}

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export const LAUNCHER_SIZE = 52
export const DEFAULT_MARGIN = 24

const EDGES = new Set<Edge>(["left", "right", "top", "bottom"])

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

export function cornerToAnchor(corner: Corner): Anchor {
  const edge: Edge = corner.endsWith("right") ? "right" : "left"
  const along = corner.startsWith("bottom") ? 1 : 0
  return { edge, along }
}

export function isAnchor(v: unknown): v is Anchor {
  if (typeof v !== "object" || v === null) return false
  const a = v as { edge?: unknown; along?: unknown }
  if (typeof a.edge !== "string" || !EDGES.has(a.edge as Edge)) return false
  if (typeof a.along !== "number" || a.along < 0 || a.along > 1) return false
  return true
}

export function computeBounds(offset: OffsetInput, win: WindowSize): Bounds {
  const top = offset.top ?? DEFAULT_MARGIN
  const bottom = offset.bottom ?? DEFAULT_MARGIN
  const left = offset.left ?? DEFAULT_MARGIN
  const right = offset.right ?? DEFAULT_MARGIN
  return {
    minX: left + LAUNCHER_SIZE / 2,
    maxX: win.width - right - LAUNCHER_SIZE / 2,
    minY: top + LAUNCHER_SIZE / 2,
    maxY: win.height - bottom - LAUNCHER_SIZE / 2,
  }
}

export function anchorToCenter(anchor: Anchor, b: Bounds): { x: number; y: number } {
  const a = clamp01(anchor.along)
  const xRange = b.maxX - b.minX
  const yRange = b.maxY - b.minY
  switch (anchor.edge) {
    case "left":
      return { x: b.minX, y: b.minY + a * yRange }
    case "right":
      return { x: b.maxX, y: b.minY + a * yRange }
    case "top":
      return { x: b.minX + a * xRange, y: b.minY }
    case "bottom":
      return { x: b.minX + a * xRange, y: b.maxY }
  }
}

export function nearestEdgeAnchor(point: { x: number; y: number }, b: Bounds): Anchor {
  const dLeft = Math.abs(point.x - b.minX)
  const dRight = Math.abs(point.x - b.maxX)
  const dTop = Math.abs(point.y - b.minY)
  const dBottom = Math.abs(point.y - b.maxY)
  const xRange = b.maxX - b.minX
  const yRange = b.maxY - b.minY
  const alongY = yRange === 0 ? 0 : clamp01((point.y - b.minY) / yRange)
  const alongX = xRange === 0 ? 0 : clamp01((point.x - b.minX) / xRange)
  const min = Math.min(dLeft, dRight, dTop, dBottom)
  if (min === dLeft) return { edge: "left", along: alongY }
  if (min === dRight) return { edge: "right", along: alongY }
  if (min === dTop) return { edge: "top", along: alongX }
  return { edge: "bottom", along: alongX }
}
