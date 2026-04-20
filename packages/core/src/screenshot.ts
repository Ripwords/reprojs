import { domToBlob } from "modern-screenshot"

const HOST_ID = "repro-host"

// Built-in exclusions for elements that are known to stall modern-screenshot
// when it recurses into their shadow roots. The Next.js dev overlay
// (<nextjs-portal>) attaches an open shadow root containing the full dev
// panel tree (CSS-in-JS, custom fonts, deeply nested SVGs); on real apps
// this never finishes inlining and "Capturing…" hangs forever.
const DEFAULT_EXCLUDED_TAGS = new Set(["NEXTJS-PORTAL"])

export interface CaptureOptions {
  // Extra selectors to skip during the snapshot. Useful for third-party
  // widgets that also stall the capture (Vercel toolbar, Intercom,
  // Storybook addons, etc.) without forcing every user to ship their own
  // filter. Matches against each visited node via Element.matches.
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

export async function capture(opts: CaptureOptions = {}): Promise<Blob | null> {
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
