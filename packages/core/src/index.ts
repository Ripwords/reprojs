// packages/core/src/index.ts
import type { ReporterIdentity } from "@reprojs/shared"
import {
  close as uiClose,
  mount,
  open as uiOpen,
  registerAllCollectors,
  unmount,
  type BreadcrumbLevel,
} from "@reprojs/ui"
import { resolveConfig, type InitOptions, type ResolvedConfig } from "./config"
import { gatherContext } from "./context"
import { postReport } from "./intake-client"
import { capture } from "./screenshot"

let _config: ResolvedConfig | null = null
let _reporter: ReporterIdentity | null = null
let _mounted = false
let _collectors: ReturnType<typeof registerAllCollectors> | null = null

export interface FeedbackHandle {
  pauseReplay: () => void
  resumeReplay: () => void
}

export function init(options: InitOptions): FeedbackHandle {
  // SSR no-op: the widget mounts into the DOM and the recorder subscribes
  // to DOM events, so init() only makes sense in a browser. Under Next.js
  // RSC / Nuxt server routes / SvelteKit load / etc. the module is also
  // evaluated server-side — short-circuit there instead of throwing, so
  // users can call init() from framework-agnostic code without guards.
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      pauseReplay: () => {},
      resumeReplay: () => {},
    }
  }
  const cfg = resolveConfig(options)
  _config = cfg
  if (_mounted) unmount()
  if (_collectors) _collectors.stopAll()
  _collectors = registerAllCollectors({
    ...options.collectors,
    replay: cfg.replay ?? options.collectors?.replay,
  })
  const collectors = _collectors
  mount({
    config: { position: cfg.position, launcher: cfg.launcher },
    capture: () =>
      capture({
        method: cfg.screenshot?.method,
        excludeSelectors: cfg.screenshot?.excludeSelectors,
      }),
    // Pause the rolling replay buffer the moment the wizard opens. Without
    // this, the buffer keeps overwriting itself with the user's annotation
    // work, so by submit time the original 30s of pre-click activity is
    // gone and only the report flow itself remains. Resume on close so the
    // next bug report still has a hot buffer to draw from.
    onOpen: () => _collectors?.pauseReplay(),
    onClose: () => _collectors?.resumeReplay(),
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
      const replay = await _collectors.flushReplay()
      const result = await postReport(_config, {
        title: final.title,
        description: final.description,
        context: final.context,
        metadata: _config.metadata,
        screenshot: final.screenshot,
        logs: final.logs,
        replayBytes: replay.bytes,
        dwellMs,
        honeypot,
      })
      if (result.ok && result.replayDisabled) {
        _collectors.markReplayDisabled()
      }
      return result.ok ? { ok: true } : { ok: false, message: result.message }
    },
  })
  _mounted = true
  return {
    pauseReplay: () => collectors.pauseReplay(),
    resumeReplay: () => collectors.resumeReplay(),
  }
}

export function open(): void {
  if (!_config) throw new Error("Repro.open called before init")
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

export function pauseReplay(): void {
  _collectors?.pauseReplay()
}

export function resumeReplay(): void {
  _collectors?.resumeReplay()
}

export function _unmount(): void {
  if (_mounted) unmount()
  if (_collectors) _collectors.stopAll()
  _mounted = false
  _config = null
  _reporter = null
  _collectors = null
}
