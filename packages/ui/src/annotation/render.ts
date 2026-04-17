import { wrapText } from "./text-wrap"
import type { Shape, Transform } from "./types"

export function render(
  ctx: CanvasRenderingContext2D,
  bg: HTMLImageElement | HTMLCanvasElement,
  shapes: Shape[],
  t: Transform,
): void {
  const { canvas } = ctx
  ctx.save()

  // Draw background at identity (fills entire visible area)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bg, 0, 0)

  // Apply viewport transform for shapes
  ctx.setTransform(t.scale, 0, 0, t.scale, t.panX, t.panY)
  for (const s of shapes) drawShape(ctx, s)

  ctx.restore()
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape): void {
  switch (s.kind) {
    case "arrow":
      drawArrow(ctx, s)
      return
    case "rect":
      drawRect(ctx, s)
      return
    case "highlight":
      drawHighlight(ctx, s)
      return
    case "pen":
      drawPen(ctx, s)
      return
    case "text":
      drawText(ctx, s)
      return
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, s: Extract<Shape, { kind: "arrow" }>): void {
  ctx.save()
  ctx.strokeStyle = s.color
  ctx.lineWidth = s.strokeWidth
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(s.x1, s.y1)
  ctx.lineTo(s.x2, s.y2)
  ctx.stroke()
  const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
  const head = Math.max(8, s.strokeWidth * 3)
  ctx.beginPath()
  ctx.moveTo(s.x2, s.y2)
  ctx.lineTo(
    s.x2 - head * Math.cos(angle - Math.PI / 6),
    s.y2 - head * Math.sin(angle - Math.PI / 6),
  )
  ctx.moveTo(s.x2, s.y2)
  ctx.lineTo(
    s.x2 - head * Math.cos(angle + Math.PI / 6),
    s.y2 - head * Math.sin(angle + Math.PI / 6),
  )
  ctx.stroke()
  ctx.restore()
}

function drawRect(ctx: CanvasRenderingContext2D, s: Extract<Shape, { kind: "rect" }>): void {
  ctx.save()
  ctx.strokeStyle = s.color
  ctx.lineWidth = s.strokeWidth
  ctx.strokeRect(s.x, s.y, s.w, s.h)
  ctx.restore()
}

function drawHighlight(
  ctx: CanvasRenderingContext2D,
  s: Extract<Shape, { kind: "highlight" }>,
): void {
  ctx.save()
  ctx.globalCompositeOperation = "multiply"
  ctx.globalAlpha = 0.4
  ctx.fillStyle = s.color
  ctx.fillRect(s.x, s.y, s.w, s.h)
  ctx.restore()
}

function drawPen(ctx: CanvasRenderingContext2D, s: Extract<Shape, { kind: "pen" }>): void {
  if (s.points.length < 2) return
  ctx.save()
  ctx.strokeStyle = s.color
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1]
    const b = s.points[i]
    if (!a || !b) continue
    const pressure = (a.p + b.p) / 2
    ctx.lineWidth = s.strokeWidth * (0.5 + pressure * 0.5)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawText(ctx: CanvasRenderingContext2D, s: Extract<Shape, { kind: "text" }>): void {
  ctx.save()
  ctx.fillStyle = s.color
  ctx.font = `${s.fontSize}px system-ui, -apple-system, sans-serif`
  ctx.textBaseline = "top"
  const lineHeight = s.fontSize * 1.3
  const lines = wrapText((text) => ctx.measureText(text), s.content, s.w)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line !== undefined) ctx.fillText(line, s.x, s.y + i * lineHeight)
  }
  ctx.restore()
}
