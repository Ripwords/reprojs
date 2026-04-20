import { domToBlob } from "modern-screenshot"

const HOST_ID = "repro-host"

// Exclude the widget's own shadow host from the snapshot. We pass this to
// modern-screenshot's `filter` hook instead of toggling `display: none` on
// the host: if `domToBlob` is slow or hangs (heavy pages, blocked CORS
// fetches for fonts/stylesheets), a display-toggle leaves the launcher and
// the in-flight reporter overlay invisible, which looks to the user like
// "I clicked the button and it disappeared."
function excludeWidget(node: Node): boolean {
  return node.nodeType !== 1 || (node as HTMLElement).id !== HOST_ID
}

export async function capture(): Promise<Blob | null> {
  try {
    return await domToBlob(document.documentElement, {
      scale: window.devicePixelRatio || 1,
      width: window.innerWidth,
      height: window.innerHeight,
      filter: excludeWidget,
    })
  } catch (err) {
    console.warn("[repro] screenshot capture failed:", err)
    return null
  }
}
