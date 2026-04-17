import type {
  CookieEntry,
  ReportContext,
  ReporterIdentity,
  SystemInfo,
} from "@feedback-tool/shared"

export function gatherContext(
  reporter: ReporterIdentity | null,
  metadata: Record<string, string | number | boolean> | undefined,
  extras?: { systemInfo?: SystemInfo; cookies?: CookieEntry[] },
): ReportContext {
  return {
    pageUrl: location.href,
    userAgent: navigator.userAgent,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    timestamp: new Date().toISOString(),
    ...(reporter ? { reporter } : {}),
    ...(metadata ? { metadata } : {}),
    ...(extras?.systemInfo ? { systemInfo: extras.systemInfo } : {}),
    ...(extras?.cookies ? { cookies: extras.cookies } : {}),
  }
}
