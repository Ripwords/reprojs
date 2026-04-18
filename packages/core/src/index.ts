// packages/core/src/index.ts
import type { ReporterIdentity } from "@feedback-tool/shared"
import {
  close as uiClose,
  mount,
  open as uiOpen,
  registerAllCollectors,
  unmount,
  type BreadcrumbLevel,
} from "@feedback-tool/ui"
import { resolveConfig, type InitOptions, type ResolvedConfig } from "./config"
import { gatherContext } from "./context"
import { postReport } from "./intake-client"
import { capture } from "./screenshot"

let _config: ResolvedConfig | null = null
let _reporter: ReporterIdentity | null = null
let _mounted = false
let _collectors: ReturnType<typeof registerAllCollectors> | null = null

export function init(options: InitOptions): void {
  const cfg = resolveConfig(options)
  _config = cfg
  if (_mounted) unmount()
  if (_collectors) _collectors.stopAll()
  _collectors = registerAllCollectors(options.collectors ?? {})
  mount({
    config: { position: cfg.position, launcher: cfg.launcher },
    capture,
    onSubmit: async ({ title, description, screenshot, dwellMs, honeypot }) => {
      if (!_config || !_collectors) return { ok: false, message: "Not initialized" }
      const snap = _collectors.snapshotAll()
      const context = gatherContext(_reporter, _config.metadata, {
        systemInfo: snap.systemInfo,
        cookies: snap.cookies,
      })
      const pending = {
        title,
        description,
        context,
        logs: snap.logs,
        screenshot,
      }
      const final = _collectors.applyBeforeSend(pending)
      if (final === null) return { ok: false, message: "aborted by beforeSend" }
      const result = await postReport(_config, {
        title: final.title,
        description: final.description,
        context: final.context,
        metadata: _config.metadata,
        screenshot: final.screenshot,
        logs: final.logs,
        dwellMs,
        honeypot,
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

export function log(
  event: string,
  data?: Record<string, string | number | boolean | null>,
  level?: BreadcrumbLevel,
): void {
  _collectors?.breadcrumb(event, data, level)
}

export function _unmount(): void {
  if (_mounted) unmount()
  if (_collectors) _collectors.stopAll()
  _mounted = false
  _config = null
  _reporter = null
  _collectors = null
}
