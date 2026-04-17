import type { H3Event } from "h3"
import { getHeader, setHeaders } from "h3"

/**
 * Applies the CORS response headers for the public intake endpoint. Always
 * reflects the request Origin (if present) so the SDK can read both success
 * and error responses. Actual origin-allowlist enforcement happens against
 * the specific project's allow-list inside the POST handler.
 */
export function applyIntakeCors(event: H3Event) {
  const origin = getHeader(event, "origin") ?? "*"
  setHeaders(event, {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  })
}

/**
 * Returns true if `origin` is accepted by the project's allow-list.
 * Dev leniency: empty allow-list + localhost origin passes.
 */
export function isOriginAllowed(origin: string | null | undefined, allowed: string[]): boolean {
  if (!origin) return false
  if (allowed.length > 0) return allowed.includes(origin)
  try {
    const u = new URL(origin)
    return u.hostname === "localhost" || u.hostname === "127.0.0.1"
  } catch {
    return false
  }
}
