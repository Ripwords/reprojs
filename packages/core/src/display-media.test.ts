import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window({ url: "https://example.test" })
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
    navigator: win.navigator,
    HTMLCanvasElement: win.HTMLCanvasElement,
  })
  installFakes()
})

// Bun runs every test file in the same worker. Without cleanup, globals
// set above leak into sibling test files (e.g. index.test.ts asserts
// `typeof window === "undefined"` to exercise the SSR no-op guard).
afterAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  delete g.window
  delete g.document
  delete g.location
  delete g.navigator
  delete g.HTMLCanvasElement
  delete g.ImageCapture
})

type GetDisplayMediaResult = "stream" | "denied" | "no-track"
let nextResult: GetDisplayMediaResult = "stream"
let stoppedTracks = 0
let getDisplayMediaCalls = 0
let lastConstraints: unknown = null

function makeFakeBitmap() {
  return { width: 4, height: 4, close: () => {} } as unknown as ImageBitmap
}

function makeFakeTrack() {
  return {
    stop: () => {
      stoppedTracks += 1
    },
  }
}

function installFakes() {
  ;(globalThis as unknown as { ImageCapture?: unknown }).ImageCapture = class {
    constructor(public _track: unknown) {}
    async grabFrame() {
      return makeFakeBitmap()
    }
  }
  ;(globalThis.navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getDisplayMedia: async (constraints: unknown) => {
      getDisplayMediaCalls += 1
      lastConstraints = constraints
      if (nextResult === "denied") {
        const err = new Error("Permission denied")
        ;(err as Error & { name: string }).name = "NotAllowedError"
        throw err
      }
      const track = nextResult === "no-track" ? null : makeFakeTrack()
      return {
        getVideoTracks: () => (track ? [track] : []),
        getTracks: () => (track ? [track] : []),
      } as unknown as MediaStream
    },
  }
  // happy-dom doesn't implement HTMLCanvasElement.toBlob; stub it.
  ;(globalThis.HTMLCanvasElement.prototype as unknown as { toBlob: unknown }).toBlob = function (
    cb: (b: Blob | null) => void,
  ) {
    cb(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }))
  }
  ;(globalThis.HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext =
    function () {
      return { drawImage: () => {} }
    }
}

import { captureViaDisplayMedia } from "./display-media"

beforeEach(() => {
  nextResult = "stream"
  stoppedTracks = 0
  getDisplayMediaCalls = 0
  lastConstraints = null
})

describe("captureViaDisplayMedia", () => {
  test("returns null when getDisplayMedia is unavailable", async () => {
    const original = globalThis.navigator.mediaDevices
    ;(globalThis.navigator as unknown as { mediaDevices?: unknown }).mediaDevices = undefined
    const blob = await captureViaDisplayMedia()
    expect(blob).toBeNull()
    expect(getDisplayMediaCalls).toBe(0)
    ;(globalThis.navigator as unknown as { mediaDevices: unknown }).mediaDevices = original
  })

  test("returns a PNG blob on a successful frame grab", async () => {
    const blob = await captureViaDisplayMedia()
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe("image/png")
  })

  test("returns null when the user denies the permission prompt", async () => {
    nextResult = "denied"
    const blob = await captureViaDisplayMedia()
    expect(blob).toBeNull()
  })

  test("returns null when the stream has no video track", async () => {
    nextResult = "no-track"
    const blob = await captureViaDisplayMedia()
    expect(blob).toBeNull()
  })

  test("stops every track even on success (no lingering 'sharing tab' indicator)", async () => {
    await captureViaDisplayMedia()
    expect(stoppedTracks).toBeGreaterThanOrEqual(1)
  })

  test("stops every track when the prompt is denied", async () => {
    nextResult = "denied"
    await captureViaDisplayMedia()
    // Denied means no track to stop, so this just asserts we don't blow up.
    expect(stoppedTracks).toBe(0)
  })

  test("requests current-tab capture so the picker is one click", async () => {
    await captureViaDisplayMedia()
    const c = lastConstraints as Record<string, unknown>
    // Chromium hints — harmless on Firefox/Safari, big UX win on Chrome/Edge.
    expect(c.preferCurrentTab).toBe(true)
    expect(c.selfBrowserSurface).toBe("include")
    expect(c.audio).toBe(false)
  })
})
