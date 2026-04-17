// Note: happy-dom 20.x does not implement the Canvas 2D API (getContext("2d") returns null).
// We use @napi-rs/canvas for real pixel-level tests instead.
// The render function accepts CanvasRenderingContext2D which @napi-rs/canvas satisfies.
import { describe, expect, test } from "bun:test"
import { createCanvas, type Canvas } from "@napi-rs/canvas"
import { render } from "./render"
import { IDENTITY_TRANSFORM, type Shape } from "./types"

// Create the white background canvas once
const bg: Canvas = createCanvas(100, 100)
const bgCtx = bg.getContext("2d")
bgCtx.fillStyle = "#ffffff"
bgCtx.fillRect(0, 0, 100, 100)

function makeCtx(w = 100, h = 100) {
  return createCanvas(w, h).getContext("2d")
}

describe("render", () => {
  test("draws the background at world (0,0)", () => {
    const ctx = makeCtx()
    render(
      ctx as unknown as CanvasRenderingContext2D,
      bg as unknown as HTMLCanvasElement,
      [],
      IDENTITY_TRANSFORM,
    )
    const px = ctx.getImageData(50, 50, 1, 1).data
    expect(px[0]).toBe(255)
    expect(px[1]).toBe(255)
    expect(px[2]).toBe(255)
  })

  test("draws a red arrow", () => {
    const ctx = makeCtx()
    const arrow: Shape = {
      kind: "arrow",
      id: "a",
      color: "#ff0000",
      strokeWidth: 4,
      x1: 10,
      y1: 50,
      x2: 90,
      y2: 50,
    }
    render(
      ctx as unknown as CanvasRenderingContext2D,
      bg as unknown as HTMLCanvasElement,
      [arrow],
      IDENTITY_TRANSFORM,
    )
    const px = ctx.getImageData(50, 50, 1, 1).data
    expect(px[0]).toBeGreaterThan(200)
  })

  test("draws a rectangle outline", () => {
    const ctx = makeCtx()
    const rect: Shape = {
      kind: "rect",
      id: "r",
      color: "#0000ff",
      strokeWidth: 4,
      x: 20,
      y: 20,
      w: 60,
      h: 60,
    }
    render(
      ctx as unknown as CanvasRenderingContext2D,
      bg as unknown as HTMLCanvasElement,
      [rect],
      IDENTITY_TRANSFORM,
    )
    const onEdge = ctx.getImageData(20, 20, 1, 1).data
    expect(onEdge[2]).toBeGreaterThan(100)
    // interior is white background (rect is outline-only)
    const inside = ctx.getImageData(50, 50, 1, 1).data
    expect(inside[2]).toBe(255)
  })

  test("highlight renders with alpha blending", () => {
    const ctx = makeCtx()
    const hl: Shape = {
      kind: "highlight",
      id: "h",
      color: "#fdd835",
      strokeWidth: 0,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    }
    render(
      ctx as unknown as CanvasRenderingContext2D,
      bg as unknown as HTMLCanvasElement,
      [hl],
      IDENTITY_TRANSFORM,
    )
    const px = ctx.getImageData(50, 50, 1, 1).data
    // #fdd835 = rgb(253,216,53). multiply at alpha 0.4 on white gives:
    // R=254 (passes >200), B≈174 (loosened from <100 to <200 because
    // multiply blend: result = bg*(1-a) + bg*fg/255*a = 255*0.6 + 53*0.4 ≈ 174)
    expect(px[0]).toBeGreaterThan(200)
    expect(px[2]).toBeLessThan(200)
  })

  test("pen draws a visible stroke along points", () => {
    const ctx = makeCtx()
    const pen: Shape = {
      kind: "pen",
      id: "p",
      color: "#00ff00",
      strokeWidth: 4,
      points: [
        { x: 10, y: 50, p: 1 },
        { x: 50, y: 50, p: 1 },
        { x: 90, y: 50, p: 1 },
      ],
    }
    render(
      ctx as unknown as CanvasRenderingContext2D,
      bg as unknown as HTMLCanvasElement,
      [pen],
      IDENTITY_TRANSFORM,
    )
    const px = ctx.getImageData(50, 50, 1, 1).data
    expect(px[1]).toBeGreaterThan(200)
  })

  test("applies transform so shapes shift with pan", () => {
    const ctx = makeCtx()
    const arrow: Shape = {
      kind: "arrow",
      id: "a",
      color: "#ff0000",
      strokeWidth: 4,
      x1: 0,
      y1: 50,
      x2: 40,
      y2: 50,
    }
    render(
      ctx as unknown as CanvasRenderingContext2D,
      bg as unknown as HTMLCanvasElement,
      [arrow],
      { scale: 1, panX: 50, panY: 0 },
    )
    // bg is drawn at identity so screen (20,50) is white (no arrow)
    const early = ctx.getImageData(20, 50, 1, 1).data
    // arrow world (0..40) shifted by panX=50 → screen (50..90); pixel (70,50) has arrow
    const later = ctx.getImageData(70, 50, 1, 1).data
    expect(early[0]).toBe(255)
    expect(later[0]).toBeGreaterThan(200)
  })
})
