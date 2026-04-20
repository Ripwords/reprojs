import type { CollectorConfig } from "@reprojs/ui"

export interface ReplayInitConfig {
  enabled?: boolean
  masking?: "strict" | "moderate" | "minimal"
  maskSelectors?: string[]
  blockSelectors?: string[]
  maxBytes?: number
}

export interface ScreenshotConfig {
  // CSS selectors for elements to omit from the screenshot in addition to
  // the widget itself and known-bad overlays (e.g. <nextjs-portal>).
  // Pass selectors for any third-party widgets that stall modern-screenshot:
  // Vercel toolbar, Intercom, Storybook addons, hot-reload portals, etc.
  excludeSelectors?: string[]
}

export interface InitOptions {
  projectKey: string
  endpoint: string
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  launcher?: boolean
  metadata?: Record<string, string | number | boolean>
  collectors?: CollectorConfig
  replay?: ReplayInitConfig
  screenshot?: ScreenshotConfig
}

export interface ResolvedConfig {
  projectKey: string
  endpoint: string
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  launcher: boolean
  metadata: Record<string, string | number | boolean> | undefined
  replay: ReplayInitConfig | undefined
  screenshot: ScreenshotConfig | undefined
}

const KEY_RE = /^rp_pk_[A-Za-z0-9]{24}$/

export function resolveConfig(opts: InitOptions): ResolvedConfig {
  if (!opts || typeof opts.projectKey !== "string" || !KEY_RE.test(opts.projectKey)) {
    throw new Error("Repro.init: projectKey is required and must match rp_pk_[24 base62 chars]")
  }
  let endpoint: string
  try {
    const u = new URL(opts.endpoint)
    endpoint = u.origin + u.pathname.replace(/\/+$/, "")
    if (endpoint.endsWith("/")) endpoint = endpoint.slice(0, -1)
  } catch {
    throw new Error("Repro.init: endpoint must be a valid absolute URL")
  }
  return {
    projectKey: opts.projectKey,
    endpoint,
    position: opts.position ?? "bottom-right",
    launcher: opts.launcher ?? true,
    metadata: opts.metadata,
    replay: opts.replay,
    screenshot: opts.screenshot,
  }
}
