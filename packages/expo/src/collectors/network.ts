import { RingBuffer } from "@reprojs/sdk-utils"

export interface NetworkEntry {
  id: string
  ts: number
  method: string
  url: string
  status: number | null
  durationMs: number | null
  size: number | null
  initiator: "fetch" | "xhr"
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  error?: string
}

const SENTINEL = "__reprojs_patched"

function rid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function headersToMap(h: HeadersInit | undefined, denylist: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  const set = new Set(denylist.map((k) => k.toLowerCase()))
  const add = (k: string, v: string) => {
    const lk = k.toLowerCase()
    out[lk] = set.has(lk) ? "[redacted]" : v
  }
  if (h instanceof Headers) {
    h.forEach((v: string, k: string) => add(k, v))
  } else if (Array.isArray(h)) {
    for (const pair of h as Array<[string, string]>) {
      const [k, v] = pair
      add(k, v)
    }
  } else {
    for (const [k, v] of Object.entries(h)) add(k, v)
  }
  return out
}

export interface NetworkCollector {
  start: () => void
  stop: () => void
  snapshot: () => NetworkEntry[]
  clear: () => void
}

export function createNetworkCollector(opts: {
  max: number
  captureBodies: boolean
  redact: { headerDenylist: string[]; bodyRedactKeys: string[] }
}): NetworkCollector {
  const buf = new RingBuffer<NetworkEntry>(opts.max)
  let originalFetch: typeof fetch | null = null

  function start() {
    const currentFetch = globalThis.fetch as typeof fetch & { [SENTINEL]?: boolean }
    if (currentFetch && !currentFetch[SENTINEL]) {
      originalFetch = currentFetch
      const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
        const id = rid()
        const ts = Date.now()
        const method = (init?.method ?? "GET").toUpperCase()
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        const requestHeaders = headersToMap(init?.headers, opts.redact.headerDenylist)
        const t0 = Date.now()
        const original = originalFetch
        if (!original) return Promise.reject(new Error("fetch not captured"))
        return original(input as RequestInfo, init).then(
          (res) => {
            const clen = Number(res.headers.get("content-length") ?? "NaN")
            try {
              buf.push({
                id,
                ts,
                method,
                url,
                status: res.status,
                durationMs: Date.now() - t0,
                size: Number.isNaN(clen) ? null : clen,
                initiator: "fetch",
                requestHeaders,
                responseHeaders: headersToMap(res.headers, opts.redact.headerDenylist),
              })
            } catch {
              // fail-open
            }
            return res
          },
          (err: unknown) => {
            try {
              buf.push({
                id,
                ts,
                method,
                url,
                status: null,
                durationMs: Date.now() - t0,
                size: null,
                initiator: "fetch",
                requestHeaders,
                error: err instanceof Error ? err.message : String(err),
              })
            } catch {
              // fail-open
            }
            throw err
          },
        )
      }) as typeof fetch & { [SENTINEL]?: boolean }
      wrapped[SENTINEL] = true
      globalThis.fetch = wrapped
    }
  }

  function stop() {
    if (originalFetch) {
      globalThis.fetch = originalFetch
      originalFetch = null
    }
  }

  return {
    start,
    stop,
    snapshot: () => buf.peek(),
    clear: () => buf.clear(),
  }
}
