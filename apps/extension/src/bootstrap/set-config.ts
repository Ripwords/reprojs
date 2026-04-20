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
    Repro?: { init: (opts: { projectKey: string; endpoint: string }) => void }
  }
  const cfg = g.__REPRO_CONFIG__
  if (!cfg || !g.Repro) return
  g.Repro.init({ projectKey: cfg.projectKey, endpoint: cfg.endpoint })
}
