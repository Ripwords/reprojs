// Handles "proxy-fetch" messages from the ISOLATED-world bridge, performs
// the fetch from the service worker's own origin (which isn't subject to
// the page's connect-src CSP), and returns the response.
//
// All binaries travel as base64 strings because chrome.runtime.sendMessage
// serializes messages as JSON in MV3, and ArrayBuffer round-trips through
// JSON as {} without this wrapping.

type SerializedBody =
  | { kind: "none" }
  | { kind: "text"; value: string }
  | { kind: "bytes"; b64: string; contentType?: string }
  | {
      kind: "formData"
      entries: Array<
        | { kind: "string"; name: string; value: string }
        | { kind: "blob"; name: string; type: string; filename: string | null; b64: string }
      >
    }

type ProxyRequest = {
  type: "proxy-fetch"
  id: string
  url: string
  method: string
  headers: Record<string, string>
  body: SerializedBody
  // The page's own origin, captured by the MAIN-world proxy before the
  // message hop. The service worker uses it to set X-Repro-Origin so the
  // intake allowlist check can treat the request as if it came from the
  // page — the browser's Origin header on an extension-initiated fetch is
  // chrome-extension://<id>, which won't be in any project's allowlist.
  pageOrigin?: string
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(binary)
}

function deserializeBody(serialized: SerializedBody): BodyInit | undefined {
  if (serialized.kind === "none") return undefined
  if (serialized.kind === "text") return serialized.value
  if (serialized.kind === "bytes") {
    return new Blob([fromBase64(serialized.b64)], {
      type: serialized.contentType ?? "application/octet-stream",
    })
  }
  const fd = new FormData()
  for (const entry of serialized.entries) {
    if (entry.kind === "string") {
      fd.append(entry.name, entry.value)
      continue
    }
    const blob = new Blob([fromBase64(entry.b64)], { type: entry.type })
    if (entry.filename !== null) {
      fd.append(entry.name, blob, entry.filename)
    } else {
      fd.append(entry.name, blob)
    }
  }
  return fd
}

function looksLikeText(contentType: string): boolean {
  if (!contentType) return true // default to text for empty bodies
  return (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("javascript") ||
    contentType.includes("html")
  )
}

export function registerProxyHandler(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as Partial<ProxyRequest> | null
    if (!msg || msg.type !== "proxy-fetch") return false

    void (async () => {
      try {
        if (!msg.url) {
          sendResponse({
            ok: false,
            status: 0,
            statusText: "",
            bodyKind: "none",
            body: null,
            error: "missing url in proxy-fetch message",
          })
          return
        }
        const body = msg.body ? deserializeBody(msg.body) : undefined
        const headers: Record<string, string> = { ...msg.headers }
        // fetch refuses to set these from any context; the browser sets them.
        delete headers.host
        delete headers.origin
        delete headers.referer
        // For FormData let fetch compute Content-Type with the boundary.
        if (msg.body?.kind === "formData") delete headers["content-type"]
        // Pass the original page origin through as a custom header. The
        // intake server checks this when the standard Origin is
        // chrome-extension://* (the browser's value for extension-
        // initiated fetches). Can't set the Origin header directly:
        // fetch treats it as a forbidden header name.
        if (msg.pageOrigin) {
          headers["x-repro-origin"] = msg.pageOrigin
        }

        const response = await fetch(msg.url, {
          method: msg.method ?? "GET",
          headers,
          body,
        })

        const contentType = response.headers.get("content-type") ?? ""
        let bodyKind: "text" | "bytes" | "none" = "none"
        let responseBody: string | null = null
        if (looksLikeText(contentType)) {
          responseBody = await response.text()
          bodyKind = responseBody.length > 0 ? "text" : "none"
        } else {
          const buf = await response.arrayBuffer()
          bodyKind = buf.byteLength > 0 ? "bytes" : "none"
          responseBody = buf.byteLength > 0 ? arrayBufferToBase64(buf) : null
        }

        sendResponse({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          bodyKind,
          body: responseBody,
          contentType,
        })
      } catch (err) {
        sendResponse({
          ok: false,
          status: 0,
          statusText: "",
          bodyKind: "none",
          body: null,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })()

    // Return true to keep the message channel open for the async sendResponse.
    return true
  })
}
