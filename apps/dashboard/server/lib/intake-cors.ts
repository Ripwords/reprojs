import type { H3Event } from "h3"
import { getHeader, setHeaders } from "h3"

/**
 * Headers for the CORS preflight (OPTIONS) on the intake endpoint.
 * Safe to reflect the request Origin here: preflights don't expose response
 * bodies to cross-origin scripts on their own — they only tell the browser
 * that a subsequent real request will pass CORS. Emitting ACAO here lets the
 * browser proceed; the real security check happens on the POST response,
 * where we only emit ACAO AFTER the origin passes the project's allowlist.
 */
export function applyIntakePreflightCors(event: H3Event) {
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
 * Emit ACAO + Vary on a real response AFTER the origin has been validated
 * against the target project's allowlist. Before validation we deliberately
 * do NOT emit ACAO, so cross-origin scripts cannot read error response bodies
 * (e.g. "Invalid project key") and use them as an enumeration oracle.
 */
export function applyIntakePostCors(event: H3Event, allowedOrigin: string) {
  setHeaders(event, {
    "Access-Control-Allow-Origin": allowedOrigin,
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
