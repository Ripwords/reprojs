const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"])

export function safeHref(url: string | null | undefined): string {
  if (!url) return "#"
  try {
    const u = new URL(url, window.location.origin)
    return SAFE_PROTOCOLS.has(u.protocol) ? u.toString() : "#"
  } catch {
    return "#"
  }
}
