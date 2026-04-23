// packages/ui/src/collectors/redact.ts

export function truncate(s: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  const buf = encoder.encode(s)
  if (buf.length <= maxBytes) return s
  let cut = maxBytes
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut -= 1
  const truncated = new TextDecoder().decode(buf.slice(0, cut))
  return `${truncated}… [truncated ${buf.length - cut}b]`
}

export const DEFAULT_SENSITIVE_COOKIE_NAMES = [
  "session",
  "sid",
  "auth",
  "token",
  "csrf",
  "jwt",
  "api_key",
  "access_token",
  "refresh_token",
  "_session",
  "connect.sid",
  "laravel_session",
  "phpsessid",
  "jsessionid",
] as const

export const DEFAULT_ALLOWED_REQUEST_HEADERS = [
  "content-type",
  "content-length",
  "accept",
  "accept-language",
  "cache-control",
  "x-request-id",
  "x-correlation-id",
] as const

export const DEFAULT_ALLOWED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "cache-control",
  "etag",
  "x-request-id",
  "x-correlation-id",
  "retry-after",
] as const

export const DEFAULT_REDACTED_QUERY_PARAMS = [
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "token",
  "password",
  "secret",
  "code",
  "state",
  "sig",
  "signature",
  "authorization",
] as const

export interface CookieEntry {
  name: string
  value: string
}

export interface CookieRedactConfig {
  maskNames?: readonly string[]
  allowNames?: readonly string[]
}

function stripPrefix(name: string): string {
  return name.replace(/^__Secure-/i, "").replace(/^__Host-/i, "")
}

function isSensitiveCookie(name: string, deny: readonly string[]): boolean {
  const lowered = stripPrefix(name).toLowerCase()
  return deny.some((d) => lowered.includes(d.toLowerCase()))
}

export function redactCookies(raw: CookieEntry[], opts: CookieRedactConfig = {}): CookieEntry[] {
  const deny = [...DEFAULT_SENSITIVE_COOKIE_NAMES, ...(opts.maskNames ?? [])]
  const allow = new Set((opts.allowNames ?? []).map((n) => n.toLowerCase()))
  return raw.map((c) => ({
    name: c.name,
    value: allow.has(c.name.toLowerCase())
      ? c.value
      : isSensitiveCookie(c.name, deny)
        ? "<redacted>"
        : c.value,
  }))
}

export interface HeaderRedactOpts {
  allowed?: readonly string[]
  /**
   * Return every header verbatim. **Dangerous**: response headers may contain
   * `Set-Cookie` (session tokens), request headers may contain
   * `Authorization`. Requires the caller to explicitly acknowledge via
   * `opts.unsafe = true` — accidentally flipping one boolean in test fixtures
   * should not silently start leaking secrets into reports.
   */
  all?: boolean
  unsafe?: boolean
}

export function redactHeaders(
  headers: Record<string, string>,
  kind: "request" | "response",
  opts: HeaderRedactOpts = {},
): Record<string, string> {
  const out: Record<string, string> = {}
  if (opts.all) {
    if (!opts.unsafe) {
      throw new Error(
        "redactHeaders({ all: true }) requires opts.unsafe === true — headers can contain Set-Cookie / Authorization",
      )
    }
    for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v
    return out
  }
  const base =
    kind === "request" ? DEFAULT_ALLOWED_REQUEST_HEADERS : DEFAULT_ALLOWED_RESPONSE_HEADERS
  const allow = new Set([...base, ...(opts.allowed ?? [])].map((h) => h.toLowerCase()))
  for (const [k, v] of Object.entries(headers)) {
    if (allow.has(k.toLowerCase())) out[k.toLowerCase()] = v
  }
  return out
}

export function redactUrl(
  url: string,
  redactKeys: readonly string[] = DEFAULT_REDACTED_QUERY_PARAMS,
): string {
  try {
    const u = new URL(url)
    const deny = new Set(redactKeys.map((k) => k.toLowerCase()))
    for (const key of u.searchParams.keys()) {
      if (deny.has(key.toLowerCase())) u.searchParams.set(key, "REDACTED")
    }
    return u.toString()
  } catch {
    return url
  }
}

export function redactBody(body: string | null, opts: { maxBytes: number }): string | null {
  if (body === null) return null
  return truncate(body, opts.maxBytes)
}
