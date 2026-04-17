import type { ReporterIdentity } from "@feedback-tool/shared"
import { resolveConfig, type InitOptions, type ResolvedConfig } from "./config"
import { gatherContext } from "./context"
import { capture } from "./screenshot"
import { postReport } from "./intake-client"

// Lazy import of the UI package so Task 11-15 can land before the UI package exists.
// This becomes a static import in Task 18 once @feedback-tool/ui is wired up.
interface UiModule {
  mount: (opts: {
    config: { position: ResolvedConfig["position"]; launcher: boolean }
    capture: () => Promise<Blob | null>
    onSubmit: (payload: {
      title: string
      description: string
    }) => Promise<{ ok: boolean; message?: string }>
  }) => void
  open: () => void
  close: () => void
  unmount: () => void
}

let _ui: UiModule | null = null
async function loadUi(): Promise<UiModule> {
  if (_ui) return _ui
  // @ts-expect-error — @feedback-tool/ui is added in Task 16+
  const mod = (await import("@feedback-tool/ui")) as UiModule
  _ui = mod
  return mod
}

let _config: ResolvedConfig | null = null
let _reporter: ReporterIdentity | null = null
let _mounted = false

export async function init(options: InitOptions): Promise<void> {
  const cfg = resolveConfig(options)
  _config = cfg
  const ui = await loadUi()
  if (_mounted) ui.unmount()
  ui.mount({
    config: { position: cfg.position, launcher: cfg.launcher },
    capture,
    onSubmit: async ({ title, description }) => {
      if (!_config) return { ok: false, message: "Not initialized" }
      const screenshot = await capture()
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
  _ui?.open()
}

export function close(): void {
  _ui?.close()
}

export function identify(reporter: ReporterIdentity | null): void {
  _reporter = reporter
}

export function _unmount(): void {
  _ui?.unmount()
  _mounted = false
  _config = null
  _reporter = null
  _ui = null
}
