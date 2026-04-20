// Capture a single frame via the browser's Screen Capture API. Far more
// reliable than DOM-cloning libraries on real apps:
//  - The browser produces the actual rendered pixels, so shadow DOM, web
//    components (Next.js dev overlay, Vercel toolbar, etc.), custom fonts,
//    blend modes, and CSS edge cases all just work.
//  - Capture is bounded by user interaction (the "Share this tab?" prompt)
//    and a single ImageCapture/canvas grab; no resource inlining loop that
//    can stall on slow CDN font fetches.
//
// Tradeoff: the browser shows a permission prompt. Users who decline (or
// browsers that don't expose the API) fall through to the DOM path.

interface ChromiumDisplayMediaConstraints extends DisplayMediaStreamOptions {
  // Chromium-only hints; ignored elsewhere. preferCurrentTab makes the
  // picker collapse to a one-click "Share this tab" affordance instead of
  // the full source picker.
  preferCurrentTab?: boolean
  selfBrowserSurface?: "include" | "exclude"
  surfaceSwitching?: "include" | "exclude"
  systemAudio?: "include" | "exclude"
  monitorTypeSurfaces?: "include" | "exclude"
}

export async function captureViaDisplayMedia(): Promise<Blob | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    return null
  }
  let stream: MediaStream | null = null
  try {
    const constraints: ChromiumDisplayMediaConstraints = {
      video: { displaySurface: "browser" },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
      systemAudio: "exclude",
      monitorTypeSurfaces: "exclude",
    }
    stream = await navigator.mediaDevices.getDisplayMedia(constraints as DisplayMediaStreamOptions)
    const track = stream.getVideoTracks()[0]
    if (!track) return null
    return await grabFrame(track, stream)
  } catch {
    // Most common path: NotAllowedError (user denied) or NotSupportedError.
    // Stay quiet — caller falls back to DOM capture.
    return null
  } finally {
    stream?.getTracks().forEach((t) => t.stop())
  }
}

// `ImageCapture` lives in lib.dom.d.ts only behind the WICG types, which
// some TS configs don't include. Declare a minimal local shape so the
// feature-detection branch type-checks without an `as unknown as` cast.
// Read it off `globalThis` (not `window`) so the test environment can stub
// it: in happy-dom these aren't the same object.
interface ImageCaptureCtor {
  new (track: MediaStreamTrack): { grabFrame(): Promise<ImageBitmap> }
}

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var ImageCapture: ImageCaptureCtor | undefined
}

async function grabFrame(track: MediaStreamTrack, stream: MediaStream): Promise<Blob | null> {
  const Ctor = globalThis.ImageCapture
  if (Ctor) {
    const bitmap = await new Ctor(track).grabFrame()
    return await bitmapToBlob(bitmap)
  }
  // Safari and older Firefox don't expose ImageCapture. Fall back to a
  // hidden <video> + canvas draw on the next frame.
  return await videoFrameToBlob(stream)
}

async function bitmapToBlob(bitmap: ImageBitmap): Promise<Blob | null> {
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0)
  const blob = await canvasToBlob(canvas)
  // Free the bitmap explicitly when supported — large frames otherwise sit
  // in GPU memory until GC runs.
  if (typeof (bitmap as ImageBitmap & { close?: () => void }).close === "function") {
    ;(bitmap as ImageBitmap & { close: () => void }).close()
  }
  return blob
}

async function videoFrameToBlob(stream: MediaStream): Promise<Blob | null> {
  const video = document.createElement("video")
  video.srcObject = stream
  video.muted = true
  try {
    await video.play().catch(() => {})
    // videoWidth/Height are populated at `loadedmetadata` (readyState >= 1),
    // not `loadeddata` (>= 2). Gating on the latter on Safari can leave us
    // drawing onto a 0×0 canvas. Also race against a 5s timeout so a stuck
    // metadata event can't hang the whole capture.
    await new Promise<void>((resolve, reject) => {
      if (video.readyState >= 1 && video.videoWidth > 0) {
        resolve()
        return
      }
      const onMeta = () => {
        cleanup()
        resolve()
      }
      const onErr = () => {
        cleanup()
        reject(new Error("video metadata never loaded"))
      }
      const timer = setTimeout(onErr, 5_000)
      const cleanup = () => {
        clearTimeout(timer)
        video.removeEventListener("loadedmetadata", onMeta)
        video.removeEventListener("error", onErr)
      }
      video.addEventListener("loadedmetadata", onMeta, { once: true })
      video.addEventListener("error", onErr, { once: true })
    })
    if (video.videoWidth === 0 || video.videoHeight === 0) return null
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    return await canvasToBlob(canvas)
  } finally {
    // Drop the strong stream reference so GC can reclaim the <video> and
    // its decoded frames promptly — the caller stops the tracks separately.
    video.srcObject = null
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png")
  })
}
