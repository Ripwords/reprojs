import { type CookieEntry, redactCookies } from "@reprojs/sdk-utils"

export interface CookiesCollectorConfig {
  maskNames?: string[]
  allowNames?: string[]
  enabled?: boolean
}

export interface CookiesCollector {
  start(config: CookiesCollectorConfig): void
  snapshot(): CookieEntry[]
  stop(): void
}

export function createCookiesCollector(initial: CookiesCollectorConfig): CookiesCollector {
  let config: CookiesCollectorConfig = initial
  let running = false
  return {
    start(c) {
      config = c
      running = true
    },
    snapshot() {
      if (!running || config.enabled === false) return []
      if (typeof document === "undefined" || !document.cookie) return []
      const raw: CookieEntry[] = document.cookie
        .split(";")
        .map((pair) => pair.trim())
        .filter((p) => p.length > 0)
        .map((pair) => {
          const idx = pair.indexOf("=")
          if (idx < 0) return { name: pair, value: "" }
          return { name: pair.slice(0, idx), value: pair.slice(idx + 1) }
        })
      return redactCookies(raw, {
        maskNames: config.maskNames,
        allowNames: config.allowNames,
      })
    },
    stop() {
      running = false
    },
  }
}
