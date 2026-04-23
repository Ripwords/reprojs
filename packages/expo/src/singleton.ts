import type { ReproInternalContext } from "./context"
import type { ReporterIdentity } from "@reprojs/shared"

declare const __DEV__: boolean

let handle: ReproInternalContext | null = null

export function setSingletonHandle(h: ReproInternalContext) {
  handle = h
}
export function clearSingletonHandle() {
  handle = null
}

const NOOP_HANDLE: ReproInternalContext = {
  config: null as never,
  getReporter: () => null,
  setReporter: () => undefined,
  getMetadata: () => ({}),
  setMetadata: () => undefined,
  logBreadcrumb: () => undefined,
  openWizard: () => undefined,
  closeWizard: () => undefined,
  captureRoot: async () => ({ uri: "", width: 0, height: 0 }),
  snapshotBreadcrumbs: () => [],
  queueStatus: () => ({ pending: 0, lastError: null }),
  flushQueue: async () => undefined,
}

function assert(): ReproInternalContext {
  if (!handle) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      throw new Error("Repro: provider not mounted — wrap your app in <ReproProvider>.")
    }
    return NOOP_HANDLE
  }
  return handle
}

export const Repro = {
  open: (opts?: { initialTitle?: string; initialDescription?: string }) =>
    assert().openWizard(opts),
  close: () => assert().closeWizard(),
  identify: (r: ReporterIdentity | null) => assert().setReporter(r),
  log: (event: string, data?: Record<string, string | number | boolean | null>) =>
    assert().logBreadcrumb(event, data),
  flush: () => assert().flushQueue(),
}
