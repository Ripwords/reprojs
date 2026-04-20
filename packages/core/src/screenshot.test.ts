import { describe, expect, test, beforeAll, beforeEach, mock } from "bun:test"

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

let lastOptions: { filter?: (node: Node) => boolean } | undefined
let displayDuringCapture: string | null = null

mock.module("modern-screenshot", () => ({
  domToBlob: async (_node: Node, options?: { filter?: (node: Node) => boolean }) => {
    lastOptions = options
    const host = document.getElementById("repro-host") as HTMLElement | null
    displayDuringCapture = host ? host.style.display : null
    return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })
  },
}))

import { capture } from "./screenshot"

beforeEach(() => {
  lastOptions = undefined
  displayDuringCapture = null
  const stale = document.getElementById("repro-host")
  if (stale) stale.remove()
})

describe("capture", () => {
  test("returns a PNG blob on success", async () => {
    const blob = await capture()
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe("image/png")
  })

  test("does not hide the widget host while the capture is in flight", async () => {
    const host = document.createElement("div")
    host.id = "repro-host"
    host.style.display = "block"
    document.body.appendChild(host)
    await capture()
    // The launcher must stay visible while the capture is running. If
    // domToBlob hangs or is slow, we must not be left with an invisible
    // widget. Excluding the host from the snapshot is done via the filter
    // callback below, not by toggling display.
    expect(displayDuringCapture).toBe("block")
    expect(host.style.display).toBe("block")
    host.remove()
  })

  test("passes a filter that excludes the widget host from the snapshot", async () => {
    const host = document.createElement("div")
    host.id = "repro-host"
    document.body.appendChild(host)
    const unrelated = document.createElement("div")
    unrelated.id = "page-content"
    document.body.appendChild(unrelated)

    await capture()

    expect(typeof lastOptions?.filter).toBe("function")
    expect(lastOptions?.filter?.(host)).toBe(false)
    expect(lastOptions?.filter?.(unrelated)).toBe(true)

    host.remove()
    unrelated.remove()
  })

  test("filter excludes <nextjs-portal> by default", async () => {
    // Next.js dev overlay attaches an open shadow root with deeply nested
    // dev panels; modern-screenshot recurses into open shadow roots and
    // stalls on the overlay's resource inlining.
    const portal = document.createElement("nextjs-portal")
    document.body.appendChild(portal)
    await capture()
    expect(lastOptions?.filter?.(portal)).toBe(false)
    portal.remove()
  })

  test("filter excludes user-provided selectors", async () => {
    const intercom = document.createElement("div")
    intercom.className = "intercom-launcher"
    document.body.appendChild(intercom)
    const keep = document.createElement("div")
    keep.className = "intercom-fake"
    document.body.appendChild(keep)

    await capture({ excludeSelectors: [".intercom-launcher"] })

    expect(lastOptions?.filter?.(intercom)).toBe(false)
    expect(lastOptions?.filter?.(keep)).toBe(true)

    intercom.remove()
    keep.remove()
  })
})
