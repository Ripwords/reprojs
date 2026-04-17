// packages/core/src/index.ts
import type { ReporterIdentity } from "@feedback-tool/shared"
import { close as uiClose, mount, open as uiOpen, unmount } from "@feedback-tool/ui"
import { resolveConfig, type InitOptions, type ResolvedConfig } from "./config"
import { gatherContext } from "./context"
import { capture } from "./screenshot"
import { postReport } from "./intake-client"

let _config: ResolvedConfig | null = null
let _reporter: ReporterIdentity | null = null
let _mounted = false

export function init(options: InitOptions): void {
  const cfg = resolveConfig(options)
  _config = cfg
  if (_mounted) unmount()
  mount({
    config: { position: cfg.position, launcher: cfg.launcher },
    capture,
    onSubmit: async ({ title, description, screenshot }) => {
      if (!_config) return { ok: false, message: "Not initialized" }
      const context = gatherContext(_reporter, _config.metadata)
      const result = await postReport(_config, {
        title,
        description,
        context,
        metadata: _config.metadata,
        screenshot,
      })
      return result.ok ? { ok: true } : { ok: false, message: result.message }
    },
  })
  _mounted = true
}

export function open(): void {
  if (!_config) throw new Error("FeedbackTool.open called before init")
  uiOpen()
}

export function close(): void {
  uiClose()
}

export function identify(reporter: ReporterIdentity | null): void {
  _reporter = reporter
}

export function _unmount(): void {
  if (_mounted) unmount()
  _mounted = false
  _config = null
  _reporter = null
}
