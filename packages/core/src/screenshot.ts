import { domToBlob } from "modern-screenshot"

export async function capture(): Promise<Blob | null> {
  const host = typeof document !== "undefined" ? document.getElementById("repro-host") : null
  const prev = host?.style.display ?? ""
  if (host) host.style.display = "none"
  try {
    return await domToBlob(document.documentElement, {
      scale: window.devicePixelRatio || 1,
      width: window.innerWidth,
      height: window.innerHeight,
    })
  } catch (err) {
    console.warn("[repro] screenshot capture failed:", err)
    return null
  } finally {
    if (host) host.style.display = prev
  }
}
