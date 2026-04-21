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
  // Two-layer guard. The IIFE's shadow-DOM host is keyed in a module-scoped
  // WeakMap, so a second IIFE load gets a fresh empty WeakMap and tries to
  // re-attachShadow on the same host element, throwing NotSupportedError.
  //
  //   (1) window sentinel — catches the common case where both bootRepro
  //       calls share window state.
  //   (2) DOM existence check — authoritative fallback when the window
  //       sentinel is somehow wiped (Turbopack/Fast-Refresh edge cases,
  //       history replacement, or an earlier failed mount that left the
  //       host element in the DOM).
  if (g.__REPRO_BOOTED__) return
  if (document.getElementById("repro-host")) {
    g.__REPRO_BOOTED__ = true
    return
  }
  const cfg = g.__REPRO_CONFIG__
  if (!cfg || !g.Repro) return
  g.__REPRO_BOOTED__ = true
  g.Repro.init({ projectKey: cfg.projectKey, endpoint: cfg.endpoint })
}
