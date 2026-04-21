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
// Ordered log of significant events within a single capture. Lets tests
// assert, e.g., that rAF fires before grabFrame (compositor-settle wait).
const events: string[] = []

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
      events.push("grabFrame")
      return makeFakeBitmap()
    }
  }
  // Stub rAF so tests can observe ordering. happy-dom provides one, but we
  // replace it to log into the shared event list and run on a microtask so
  // async tests don't stall waiting for a real animation frame.
  ;(
    globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }
  ).requestAnimationFrame = (cb: FrameRequestCallback) => {
    events.push("raf")
    return setTimeout(() => cb(performance.now()), 0) as unknown as number
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
  events.length = 0
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

  test("waits for a frame tick between stream-ready and grabFrame so the tab-capture compositor has produced a fully-composited frame (no broken-image glyphs on assets that render fine on the live page)", async () => {
    await captureViaDisplayMedia()
    const rafIdx = events.indexOf("raf")
    const grabIdx = events.indexOf("grabFrame")
    expect(rafIdx).toBeGreaterThanOrEqual(0)
    expect(grabIdx).toBeGreaterThanOrEqual(0)
    expect(rafIdx).toBeLessThan(grabIdx)
  })

  test("forces decode() only on <img> elements that are already fully loaded — skips pending/src-less images whose decode() would never resolve and strand the MediaStream active", async () => {
    // Already-loaded image — should have decode() called on it.
    const loaded = document.createElement("img")
    let loadedDecodes = 0
    ;(loaded as unknown as { decode: () => Promise<void> }).decode = async () => {
      loadedDecodes += 1
    }
    Object.defineProperty(loaded, "complete", { value: true, configurable: true })
    Object.defineProperty(loaded, "naturalWidth", { value: 100, configurable: true })
    document.body.appendChild(loaded)

    // Image with no src (React skeleton / placeholder pattern). decode()
    // on this would hang forever on a real page — we must NOT await it.
    const pending = document.createElement("img")
    let pendingDecodes = 0
    ;(pending as unknown as { decode: () => Promise<void> }).decode = () => {
      pendingDecodes += 1
      return new Promise<void>(() => {}) // never resolves
    }
    Object.defineProperty(pending, "complete", { value: false, configurable: true })
    Object.defineProperty(pending, "naturalWidth", { value: 0, configurable: true })
    document.body.appendChild(pending)

    try {
      // This MUST NOT hang. If the fix regressed, the test will time out.
      const blob = await captureViaDisplayMedia()
      expect(blob).toBeInstanceOf(Blob)
      expect(loadedDecodes).toBe(1)
      expect(pendingDecodes).toBe(0)
    } finally {
      loaded.remove()
      pending.remove()
    }
  })

  test("a rejected decode (e.g. broken <img> src) does not abort the capture", async () => {
    const img = document.createElement("img")
    ;(img as unknown as { decode: () => Promise<void> }).decode = async () => {
      throw new Error("decode failed")
    }
    Object.defineProperty(img, "complete", { value: true, configurable: true })
    Object.defineProperty(img, "naturalWidth", { value: 100, configurable: true })
    document.body.appendChild(img)
    try {
      const blob = await captureViaDisplayMedia()
      expect(blob).toBeInstanceOf(Blob)
    } finally {
      img.remove()
    }
  })

  test("a hanging decode() on a ready image does not strand the capture — timeout bounds the wait", async () => {
    const img = document.createElement("img")
    ;(img as unknown as { decode: () => Promise<void> }).decode = () => new Promise<void>(() => {}) // never resolves
    Object.defineProperty(img, "complete", { value: true, configurable: true })
    Object.defineProperty(img, "naturalWidth", { value: 100, configurable: true })
    document.body.appendChild(img)
    try {
      const start = Date.now()
      const blob = await captureViaDisplayMedia()
      const elapsed = Date.now() - start
      expect(blob).toBeInstanceOf(Blob)
      // Must not hang — timeout is 300ms, plus some slack for test runner.
      expect(elapsed).toBeLessThan(1_000)
    } finally {
      img.remove()
    }
  })
})
