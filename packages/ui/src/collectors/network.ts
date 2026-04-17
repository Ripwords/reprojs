// packages/ui/src/collectors/network.ts
import { RingBuffer } from "./ring-buffer"
import { redactBody, redactHeaders, redactUrl } from "./redact"

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

export interface NetworkConfig {
  maxEntries?: number
  requestBody?: boolean
  responseBody?: boolean
  maxBodyBytes?: number
  allowedHeaders?: string[]
  allHeaders?: boolean
  redactQueryParams?: boolean
  enabled?: boolean
}

export interface NetworkCollector {
  start(config: NetworkConfig): void
  snapshot(): NetworkEntry[]
  stop(): void
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function headersToObject(h: Headers | Record<string, string> | undefined): Record<string, string> {
  if (!h) return {}
  if (h instanceof Headers) {
    const out: Record<string, string> = {}
    h.forEach((v, k) => {
      out[k] = v
    })
    return out
  }
  return { ...h }
}

export function createNetworkCollector(_initial: NetworkConfig): NetworkCollector {
  let buffer: RingBuffer<NetworkEntry> | null = null
  let originalFetch: typeof globalThis.fetch | null = null
  let originalXHROpen: XMLHttpRequest["open"] | null = null
  let originalXHRSend: XMLHttpRequest["send"] | null = null
  let running = false
  let cfg: NetworkConfig = {}

  function wrapFetch() {
    const orig = globalThis.fetch
    originalFetch = orig
    const maxBody = cfg.maxBodyBytes ?? 16_384
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? (input instanceof Request ? input.method : "GET")
      const rawUrl =
        input instanceof Request ? input.url : typeof input === "string" ? input : input.toString()
      const url = cfg.redactQueryParams === false ? rawUrl : redactUrl(rawUrl)
      const started = performance.now()
      const ts = Date.now()
      const id = uid()

      let requestBody: string | undefined
      let requestHeaders: Record<string, string> | undefined
      if (cfg.requestBody && typeof init?.body === "string") {
        requestBody = redactBody(init.body, { maxBytes: maxBody }) ?? undefined
      }
      if (init?.headers) {
        const raw = headersToObject(init.headers as Headers | Record<string, string>)
        requestHeaders = redactHeaders(raw, "request", {
          allowed: cfg.allowedHeaders,
          all: cfg.allHeaders,
        })
      }

      try {
        const res = await orig(input, init)
        const durationMs = performance.now() - started
        const responseHeaders = redactHeaders(headersToObject(res.headers), "response", {
          allowed: cfg.allowedHeaders,
          all: cfg.allHeaders,
        })
        let responseBody: string | undefined
        let size: number | null = null
        if (cfg.responseBody) {
          try {
            const clone = res.clone()
            const text = await clone.text()
            size = text.length
            responseBody = redactBody(text, { maxBytes: maxBody }) ?? undefined
          } catch {
            responseBody = undefined
          }
        }
        buffer?.push({
          id,
          ts,
          method,
          url,
          status: res.status,
          durationMs,
          size,
          initiator: "fetch",
          requestHeaders,
          responseHeaders,
          requestBody,
          responseBody,
        })
        return res
      } catch (err) {
        const durationMs = performance.now() - started
        buffer?.push({
          id,
          ts,
          method,
          url,
          status: null,
          durationMs,
          size: null,
          initiator: "fetch",
          requestHeaders,
          requestBody,
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    }
  }

  function wrapXHR() {
    const proto = XMLHttpRequest.prototype
    const origOpen = proto.open
    const origSend = proto.send
    originalXHROpen = origOpen
    originalXHRSend = origSend
    type Patched = XMLHttpRequest & {
      __ftMethod?: string
      __ftUrl?: string
      __ftStart?: number
      __ftId?: string
      __ftTs?: number
    }
    proto.open = function (this: Patched, method: string, url: string, ...rest: unknown[]) {
      this.__ftMethod = method
      this.__ftUrl = cfg.redactQueryParams === false ? url : redactUrl(url)
      this.__ftId = uid()
      return origOpen.call(this as XMLHttpRequest, method, url, ...(rest as [boolean?]))
    }
    proto.send = function (this: Patched, body?: Document | XMLHttpRequestBodyInit | null) {
      this.__ftStart = performance.now()
      this.__ftTs = Date.now()
      this.addEventListener("loadend", () => {
        const durationMs = this.__ftStart !== undefined ? performance.now() - this.__ftStart : null
        buffer?.push({
          id: this.__ftId ?? uid(),
          ts: this.__ftTs ?? Date.now(),
          method: this.__ftMethod ?? "GET",
          url: this.__ftUrl ?? "",
          status: this.status || null,
          durationMs,
          size: typeof this.response === "string" ? this.response.length : null,
          initiator: "xhr",
          requestBody:
            cfg.requestBody && typeof body === "string"
              ? (redactBody(body, { maxBytes: cfg.maxBodyBytes ?? 16_384 }) ?? undefined)
              : undefined,
          responseBody:
            cfg.responseBody && typeof this.response === "string"
              ? (redactBody(this.response, { maxBytes: cfg.maxBodyBytes ?? 16_384 }) ?? undefined)
              : undefined,
          error: this.status === 0 ? "network error" : undefined,
        })
      })
      return origSend.call(this as XMLHttpRequest, body as BodyInit | null | undefined)
    }
  }

  return {
    start(config) {
      if (running) return
      if (config.enabled === false) return
      cfg = config
      buffer = new RingBuffer<NetworkEntry>(config.maxEntries ?? 50)
      if (typeof globalThis.fetch === "function") wrapFetch()
      if (typeof XMLHttpRequest !== "undefined") wrapXHR()
      running = true
    },
    snapshot() {
      return buffer?.drain() ?? []
    },
    stop() {
      if (!running) return
      if (originalFetch) globalThis.fetch = originalFetch
      if (originalXHROpen) XMLHttpRequest.prototype.open = originalXHROpen
      if (originalXHRSend) XMLHttpRequest.prototype.send = originalXHRSend
      originalFetch = null
      originalXHROpen = null
      originalXHRSend = null
      buffer = null
      running = false
    },
  }
}
