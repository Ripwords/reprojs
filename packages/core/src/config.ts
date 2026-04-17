import type { CollectorConfig } from "@feedback-tool/ui"

export interface InitOptions {
  projectKey: string
  endpoint: string
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  launcher?: boolean
  metadata?: Record<string, string | number | boolean>
  collectors?: CollectorConfig
}

export interface ResolvedConfig {
  projectKey: string
  endpoint: string
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  launcher: boolean
  metadata: Record<string, string | number | boolean> | undefined
}

const KEY_RE = /^ft_pk_[A-Za-z0-9]{24}$/

export function resolveConfig(opts: InitOptions): ResolvedConfig {
  if (!opts || typeof opts.projectKey !== "string" || !KEY_RE.test(opts.projectKey)) {
    throw new Error(
      "FeedbackTool.init: projectKey is required and must match ft_pk_[24 base62 chars]",
    )
  }
  let endpoint: string
  try {
    const u = new URL(opts.endpoint)
    endpoint = u.origin + u.pathname.replace(/\/+$/, "")
    if (endpoint.endsWith("/")) endpoint = endpoint.slice(0, -1)
  } catch {
    throw new Error("FeedbackTool.init: endpoint must be a valid absolute URL")
  }
  return {
    projectKey: opts.projectKey,
    endpoint,
    position: opts.position ?? "bottom-right",
    launcher: opts.launcher ?? true,
    metadata: opts.metadata,
  }
}
