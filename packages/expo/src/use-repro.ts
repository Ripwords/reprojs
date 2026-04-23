import { useContext } from "react"
import { ReproContext } from "./context"
import type { ReporterIdentity } from "@reprojs/shared"

declare const __DEV__: boolean

export interface ReproHandle {
  open: (opts?: { initialTitle?: string; initialDescription?: string }) => void
  close: () => void
  identify: (reporter: ReporterIdentity | null) => void
  log: (event: string, data?: Record<string, string | number | boolean | null>) => void
  setMetadata: (patch: Record<string, string | number | boolean>) => void
  queue: { pending: number; lastError: string | null; flush: () => Promise<void> }
}

export function useRepro(): ReproHandle {
  const ctx = useContext(ReproContext)
  if (!ctx) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      throw new Error("Repro: useRepro() must be called inside <ReproProvider>")
    }
    return {
      open: () => undefined,
      close: () => undefined,
      identify: () => undefined,
      log: () => undefined,
      setMetadata: () => undefined,
      queue: { pending: 0, lastError: null, flush: async () => undefined },
    }
  }
  const status = ctx.queueStatus()
  return {
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
