import { useContext } from "react"
import { ReproContext } from "./context"
import type { ReporterIdentity } from "@reprojs/shared"

declare const __DEV__: boolean

export interface ReproHandle {
  /** True when the provider is in silent-disable mode (empty projectKey or
   *  intakeUrl). Callers that render UI based on Repro availability can gate
   *  on this — e.g. `<ReproLauncher />` returns null when disabled. */
  disabled: boolean
  open: (opts?: { initialTitle?: string; initialDescription?: string }) => void
  close: () => void
  identify: (reporter: ReporterIdentity | null) => void
  log: (event: string, data?: Record<string, string | number | boolean | null>) => void
  setMetadata: (patch: Record<string, string | number | boolean>) => void
  queue: { pending: number; lastError: string | null; flush: () => Promise<void> }
}

const NOOP_HANDLE: ReproHandle = {
  disabled: true,
  open: () => undefined,
  close: () => undefined,
  identify: () => undefined,
  log: () => undefined,
  setMetadata: () => undefined,
  queue: { pending: 0, lastError: null, flush: async () => undefined },
}

export function useRepro(): ReproHandle {
  const ctx = useContext(ReproContext)
  if (!ctx) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      throw new Error("Repro: useRepro() must be called inside <ReproProvider>")
    }
    return NOOP_HANDLE
  }
  // Silent-disable: provider rendered but projectKey/intakeUrl were empty.
  if (ctx.config === null) {
    return NOOP_HANDLE
  }
  const status = ctx.queueStatus()
  return {
    disabled: false,
    open: ctx.openWizard,
    close: ctx.closeWizard,
    identify: ctx.setReporter,
    log: ctx.logBreadcrumb,
    setMetadata: ctx.setMetadata,
    queue: {
      pending: status.pending,
      lastError: status.lastError,
      flush: ctx.flushQueue,
    },
  }
}
