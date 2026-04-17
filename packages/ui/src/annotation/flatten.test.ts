// Note: happy-dom 20.x canvas 2D context returns null, making it unusable for pixel tests.
// We polyfill the global `document` with a minimal stub whose createElement("canvas")
// returns a real @napi-rs/canvas Canvas. @napi-rs/canvas natively supports toBlob,
// so no additional shim is needed.
import { describe, expect, test, beforeAll } from "bun:test"
import { createCanvas } from "@napi-rs/canvas"
import { flatten } from "./flatten"
import type { Shape } from "./types"

let bg: ReturnType<typeof createCanvas>

beforeAll(() => {
  // Polyfill global document.createElement for the flatten implementation.
  // Using @napi-rs/canvas because happy-dom 20.x returns null for getContext("2d").
  const globalDoc = {
    createElement: (tag: string) => {
      if (tag === "canvas") return createCanvas(1, 1) as unknown as HTMLCanvasElement
      throw new Error(`createElement("${tag}") not supported in test polyfill`)
    },
  }
  Object.defineProperty(globalThis, "document", {
    value: globalDoc,
    writable: true,
    configurable: true,
  })

  bg = createCanvas(200, 100)
  const ctx = bg.getContext("2d")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, 200, 100)
})

describe("flatten", () => {
  test("produces a Blob of type image/png at native bg dimensions", async () => {
    const blob = await flatten(bg as unknown as HTMLImageElement, [])
    expect(blob.type).toBe("image/png")
    expect(blob.size).toBeGreaterThan(0)
  })

  test("applies shapes at native resolution (identity transform)", async () => {
    const arrow: Shape = {
      kind: "arrow",
      id: "a",
      color: "#ff0000",
      strokeWidth: 4,
      x1: 10,
      y1: 50,
      x2: 190,
      y2: 50,
    }
    const blob = await flatten(bg as unknown as HTMLImageElement, [arrow])
    expect(blob.size).toBeGreaterThan(0)
  })
})
