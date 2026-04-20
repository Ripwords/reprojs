// These functions are serialized by chrome.scripting.executeScript's `func`
// option. They run in the page's MAIN world, so they must be self-contained
// — no closures over module-scope values.

export function injectConfig(projectKey: string, endpoint: string): void {
  const g = globalThis as unknown as { __REPRO_CONFIG__?: unknown }
  g.__REPRO_CONFIG__ = { projectKey, endpoint, source: "extension" }
}

export function bootRepro(): void {
  const g = globalThis as unknown as {
    __REPRO_CONFIG__?: { projectKey: string; endpoint: string }
    __REPRO_BOOTED__?: boolean
    Repro?: { init: (opts: { projectKey: string; endpoint: string }) => void }
  }
  // The IIFE's shadow-DOM host is keyed in a module-scoped WeakMap. A second
  // IIFE load gets a fresh empty WeakMap and tries to re-attachShadow on the
  // same host element, which throws NotSupportedError. Pin a sentinel on
  // window so we no-op on any re-entry, regardless of how many times the
  // service worker injected the files bundle.
  if (g.__REPRO_BOOTED__) return
  const cfg = g.__REPRO_CONFIG__
  if (!cfg || !g.Repro) return
  g.__REPRO_BOOTED__ = true
  g.Repro.init({ projectKey: cfg.projectKey, endpoint: cfg.endpoint })
}
