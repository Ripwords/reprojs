import { describe, expect, test, beforeAll, mock } from "bun:test"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window({ url: "http://localhost:4000" })
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
    navigator: win.navigator,
  })
})

mock.module("modern-screenshot", () => ({
  domToBlob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
}))

import { capture } from "./screenshot"

describe("capture", () => {
  test("returns a PNG blob on success", async () => {
    const blob = await capture()
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe("image/png")
  })

  test("hides widget host during capture", async () => {
    const host = document.createElement("div")
    host.id = "feedback-tool-host"
    host.style.display = "block"
    document.body.appendChild(host)
    await capture()
    // Restored after capture
    expect(host.style.display).toBe("block")
    host.remove()
  })
})
