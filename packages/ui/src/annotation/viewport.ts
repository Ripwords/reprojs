import { MAX_SCALE, MIN_SCALE, type Transform } from "./types"

export function screenToWorld(
  screenX: number,
  screenY: number,
  canvasRect: DOMRect,
  t: Transform,
): { worldX: number; worldY: number } {
  const localX = screenX - canvasRect.left
  const localY = screenY - canvasRect.top
  return {
    worldX: (localX - t.panX) / t.scale,
    worldY: (localY - t.panY) / t.scale,
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function zoomAt(cx: number, cy: number, factor: number, t: Transform): Transform {
  const nextScale = clamp(t.scale * factor, MIN_SCALE, MAX_SCALE)
  const worldX = (cx - t.panX) / t.scale
  const worldY = (cy - t.panY) / t.scale
  return {
    scale: nextScale,
    panX: cx - worldX * nextScale,
    panY: cy - worldY * nextScale,
  }
}

export function fitTransform(
  bgW: number,
  bgH: number,
  canvasW: number,
  canvasH: number,
): Transform {
  const scale = Math.min(canvasW / bgW, canvasH / bgH, 1)
  const panX = Math.max(0, (canvasW - bgW * scale) / 2)
  const panY = Math.max(0, (canvasH - bgH * scale) / 2)
  return { scale, panX, panY }
}

const PAN_EDGE_BUFFER = 100

export function clampPan(
  t: Transform,
  bgW: number,
  bgH: number,
  canvasW: number,
  canvasH: number,
): Transform {
  const scaledW = bgW * t.scale
  const scaledH = bgH * t.scale
  return {
    scale: t.scale,
    panX: clamp(t.panX, -scaledW + PAN_EDGE_BUFFER, canvasW - PAN_EDGE_BUFFER),
    panY: clamp(t.panY, -scaledH + PAN_EDGE_BUFFER, canvasH - PAN_EDGE_BUFFER),
  }
}

export function isInsideImage(worldX: number, worldY: number, bgW: number, bgH: number): boolean {
  return worldX >= 0 && worldX <= bgW && worldY >= 0 && worldY <= bgH
}
