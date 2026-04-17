import type { ReportContext, ReporterIdentity } from "@feedback-tool/shared"

export function gatherContext(
  reporter: ReporterIdentity | null,
  metadata: Record<string, string | number | boolean> | undefined,
): ReportContext {
  return {
    pageUrl: location.href,
    userAgent: navigator.userAgent,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    timestamp: new Date().toISOString(),
    ...(reporter ? { reporter } : {}),
    ...(metadata ? { metadata } : {}),
  }
}
