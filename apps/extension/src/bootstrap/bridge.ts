// Runs in the page's ISOLATED world via chrome.scripting.executeScript({
// func, world: "ISOLATED" }). Isolated world has access to chrome.runtime.*
// but shares the tab's DOM with the MAIN world, so it can use
// window.postMessage / addEventListener("message") to talk to the fetch
// proxy installed by proxy-fetch.ts.
//
// Self-contained — no imports, no closures.

export function installBridge(): void {
  const g = globalThis as unknown as { __REPRO_BRIDGE_INSTALLED__?: boolean }
  if (g.__REPRO_BRIDGE_INSTALLED__) return
  g.__REPRO_BRIDGE_INSTALLED__ = true

  const SOURCE = "repro-proxy"

  window.addEventListener("message", (event) => {
    if (event.source !== window) return
    const data = event.data as {
      source?: string
      type?: string
      id?: string
      url?: string
      method?: string
      headers?: Record<string, string>
      body?: unknown
      pageOrigin?: string
    } | null
    if (!data || data.source !== SOURCE || data.type !== "request") return
    if (typeof data.id !== "string") return

    const id = data.id

    chrome.runtime
      .sendMessage({
        type: "proxy-fetch",
        id,
        url: data.url,
        method: data.method,
        headers: data.headers,
        body: data.body,
        pageOrigin: data.pageOrigin,
      })
      .then((response: unknown) => {
        const payload =
          response && typeof response === "object"
            ? (response as Record<string, unknown>)
            : { error: "empty response from service worker" }
        window.postMessage(
          { source: SOURCE, type: "response", id, ...payload },
          window.location.origin,
        )
        return
      })
      .catch((err: unknown) => {
        window.postMessage(
          {
            source: SOURCE,
            type: "response",
            id,
            ok: false,
            status: 0,
            statusText: "",
            bodyKind: "none",
            body: null,
            error: err instanceof Error ? err.message : String(err),
          },
          window.location.origin,
        )
      })
  })
}
