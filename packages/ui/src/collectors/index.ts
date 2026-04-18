// packages/ui/src/collectors/index.ts
import type { LogsAttachment, ReportContext } from "@feedback-tool/shared"
import { type BreadcrumbLevel, createBreadcrumbsCollector } from "./breadcrumbs"
import { createConsoleCollector } from "./console"
import { createCookiesCollector } from "./cookies"
import { createNetworkCollector } from "./network"
import { DEFAULT_STRING_REDACTORS } from "./serialize"
import { snapshotSystemInfo } from "./system-info"

export type { LogsAttachment }

export interface PendingReport {
  title: string
  description: string
  context: ReportContext
  logs: LogsAttachment | null
  screenshot: Blob | null
}

export interface CollectorConfig {
  console?: {
    maxEntries?: number
    maxArgBytes?: number
    maxEntryBytes?: number
    enabled?: boolean
  }
  network?: {
    maxEntries?: number
    requestBody?: boolean
    responseBody?: boolean
    maxBodyBytes?: number
    allowedHeaders?: string[]
    allHeaders?: boolean
    redactQueryParams?: boolean
    enabled?: boolean
  }
  cookies?: { maskNames?: string[]; allowNames?: string[]; enabled?: boolean }
  breadcrumbs?: { maxEntries?: number; maxDataBytes?: number; enabled?: boolean }
  stringRedactors?: RegExp[]
  beforeSend?: (report: PendingReport) => PendingReport | null
}

export function registerAllCollectors(config: CollectorConfig): {
  snapshotAll: () => {
    systemInfo: ReturnType<typeof snapshotSystemInfo>
    cookies: ReturnType<ReturnType<typeof createCookiesCollector>["snapshot"]>
    logs: LogsAttachment
  }
  stopAll: () => void
  breadcrumb: (
    event: string,
    data?: Record<string, string | number | boolean | null>,
    level?: BreadcrumbLevel,
  ) => void
  applyBeforeSend: (report: PendingReport) => PendingReport | null
} {
  const stringRedactors = config.stringRedactors ?? [...DEFAULT_STRING_REDACTORS]
  const consoleCollector = createConsoleCollector({})
  const networkCollector = createNetworkCollector({})
  const cookiesCollector = createCookiesCollector({})
  const breadcrumbsCollector = createBreadcrumbsCollector({})

  consoleCollector.start({ ...config.console, stringRedactors })
  networkCollector.start({ ...config.network, stringRedactors })
  cookiesCollector.start({ ...config.cookies })
  breadcrumbsCollector.start({ ...config.breadcrumbs })

  return {
    snapshotAll() {
      const consoleSnap = consoleCollector.snapshot()
      const networkSnap = networkCollector.snapshot()
      const breadcrumbsSnap = breadcrumbsCollector.snapshot()
      const cookiesSnap = cookiesCollector.snapshot()
      return {
        systemInfo: snapshotSystemInfo(),
        cookies: cookiesSnap,
        logs: {
          version: 1,
          console: consoleSnap,
          network: networkSnap,
          breadcrumbs: breadcrumbsSnap,
          config: {
            consoleMax: config.console?.maxEntries ?? 100,
            networkMax: config.network?.maxEntries ?? 50,
            breadcrumbsMax: config.breadcrumbs?.maxEntries ?? 50,
            capturesBodies: Boolean(config.network?.requestBody || config.network?.responseBody),
            capturesAllHeaders: Boolean(config.network?.allHeaders),
          },
        },
      }
    },
    stopAll() {
      consoleCollector.stop()
      networkCollector.stop()
      cookiesCollector.stop()
      breadcrumbsCollector.stop()
    },
    breadcrumb: breadcrumbsCollector.breadcrumb,
    applyBeforeSend(report) {
      const hook = config.beforeSend
      if (!hook) return report
      try {
        const result = hook(report)
        return result === undefined ? report : result
      } catch (err) {
        console.warn(
          "[feedback-tool] collectors.beforeSend threw; proceeding with original report",
          err,
        )
        return report
      }
    },
  }
}
