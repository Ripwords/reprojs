import { createContext } from "react"
import type { ReproConfig } from "./config"
import type { Breadcrumb } from "@reprojs/sdk-utils"
import type { ReporterIdentity } from "@reprojs/shared"

export interface ReproInternalContext {
  config: ReproConfig
  getReporter: () => ReporterIdentity | null
  setReporter: (r: ReporterIdentity | null) => void
  getMetadata: () => Record<string, string | number | boolean>
  setMetadata: (patch: Record<string, string | number | boolean>) => void
  logBreadcrumb: (event: string, data?: Record<string, string | number | boolean | null>) => void
  openWizard: (opts?: {
    initialTitle?: string
    initialDescription?: string
  }) => Promise<void> | void
  closeWizard: () => void
  captureRoot: () => Promise<{ uri: string; width: number; height: number; bytes: number }>
  snapshotBreadcrumbs: () => Breadcrumb[]
  queueStatus: () => { pending: number; lastError: string | null }
  flushQueue: () => Promise<void>
}

export const ReproContext = createContext<ReproInternalContext | null>(null)
