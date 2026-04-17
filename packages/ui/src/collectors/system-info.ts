import type { SystemInfo } from "@feedback-tool/shared"

interface NetworkInformationLike {
  effectiveType?: string
  rtt?: number
  downlink?: number
}

export function snapshotSystemInfo(): SystemInfo {
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return "UTC"
    }
  })()
  const offset = -new Date().getTimezoneOffset()
  const conn = (navigator as unknown as { connection?: NetworkInformationLike }).connection
  const referrer = document.referrer || undefined
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    timezone: tz,
    timezoneOffset: offset,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    screen: { w: window.screen.width, h: window.screen.height },
    dpr: window.devicePixelRatio || 1,
    online: navigator.onLine,
    connection: conn
      ? { effectiveType: conn.effectiveType, rtt: conn.rtt, downlink: conn.downlink }
      : undefined,
    pageUrl: location.href,
    referrer,
    documentReferrer: referrer,
    timestamp: new Date().toISOString(),
  }
}
