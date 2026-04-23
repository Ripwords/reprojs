import { render } from "./render"
import { IDENTITY_TRANSFORM, type Shape } from "@reprojs/sdk-utils"

export async function flatten(bg: HTMLImageElement, shapes: Shape[]): Promise<Blob> {
  const width = bg.naturalWidth ?? bg.width
  const height = bg.naturalHeight ?? bg.height

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("flatten: 2d context unavailable")

  render(ctx, bg, shapes, IDENTITY_TRANSFORM)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error("toBlob returned null"))
    }, "image/png")
  })
}
