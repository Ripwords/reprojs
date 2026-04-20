import { domToBlob } from "modern-screenshot"
import { captureViaDisplayMedia } from "./display-media"

const HOST_ID = "repro-host"

// Built-in exclusions for elements that are known to stall modern-screenshot
// when it recurses into their shadow roots. The Next.js dev overlay
// (<nextjs-portal>) attaches an open shadow root containing the full dev
// panel tree (CSS-in-JS, custom fonts, deeply nested SVGs); on real apps
// this never finishes inlining and "Capturing…" hangs forever.
const DEFAULT_EXCLUDED_TAGS = new Set(["NEXTJS-PORTAL"])

export type CaptureMethod = "auto" | "display-media" | "dom"

export interface CaptureOptions {
  // Which capture path to use. Defaults to "auto":
  //   1. Try the browser's getDisplayMedia (pixel-perfect, ~50ms after the
  //      user accepts the "Share this tab?" prompt — no DOM cloning, no
  //      font inlining, no shadow-DOM traps).
  //   2. Fall back to the DOM path (modern-screenshot) when the user
  //      denies, the API is missing, or the frame grab fails.
  // Set "dom" to skip the prompt entirely (older UX, slower on heavy pages
  // but no permission flow). Set "display-media" to require the API and
  // return null if it's unavailable.
  method?: CaptureMethod
  // Extra selectors to skip during the DOM-path snapshot. Useful for
  // third-party widgets that stall modern-screenshot (Vercel toolbar,
  // Intercom, Storybook addons, etc.). Has no effect on the display-media
  // path — that one captures real pixels and doesn't need exclusions.
  excludeSelectors?: string[]
}

function buildFilter(opts: CaptureOptions): (node: Node) => boolean {
  const selectors = opts.excludeSelectors ?? []
  const matchSelector = selectors.length > 0 ? selectors.join(",") : null
  return (node: Node) => {
    if (node.nodeType !== 1) return true
    const el = node as Element
    if (el.id === HOST_ID) return false
    if (DEFAULT_EXCLUDED_TAGS.has(el.tagName)) return false
    if (matchSelector && typeof el.matches === "function" && el.matches(matchSelector)) {
      return false
    }
    return true
  }
}

// The display-media path captures the real screen, so the widget host
// would otherwise appear in the frame. Hide it across the await — safe
// here because the await is bounded by the user clicking "Share" on the
// browser-native prompt (seconds), not by a 30s library work loop.
async function withHiddenHost<T>(work: () => Promise<T>): Promise<T> {
  const host = document.getElementById(HOST_ID) as HTMLElement | null
  const prev = host?.style.display ?? ""
  if (host) host.style.display = "none"
  try {
    return await work()
  } finally {
    if (host) host.style.display = prev
  }
}

async function captureViaDom(opts: CaptureOptions): Promise<Blob | null> {
  try {
    return await domToBlob(document.documentElement, {
      scale: window.devicePixelRatio || 1,
      width: window.innerWidth,
      height: window.innerHeight,
      filter: buildFilter(opts),
    })
  } catch (err) {
    console.warn("[repro] screenshot capture failed:", err)
    return null
  }
}

export async function capture(opts: CaptureOptions = {}): Promise<Blob | null> {
  const method = opts.method ?? "auto"
  if (method === "display-media" || method === "auto") {
    const frame = await withHiddenHost(() => captureViaDisplayMedia())
    if (frame) return frame
    if (method === "display-media") return null
  }
  return await captureViaDom(opts)
}
