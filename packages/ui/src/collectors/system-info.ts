import type { SystemInfo } from "@reprojs/shared"

interface NetworkInformationLike {
  effectiveType?: string
  rtt?: number
  downlink?: number
}

interface NavigatorUADataLike {
  platform?: string
}

// navigator.platform is deprecated and hardcodes "MacIntel" on Apple Silicon for
// web-compat reasons. Prefer navigator.userAgentData.platform when available
// (Chromium: "macOS", "Windows", "Linux", "Android") and fall back otherwise.
function resolvePlatform(): string {
  // `as unknown as` is required here: `userAgentData` is not in TS's lib.dom
  // Navigator type (it's Chromium-only and intentionally behind `lib.dom`'s
  // stable API bar). The two-step cast is the idiomatic way to augment a
  // built-in without widening to `any` — safe because we optional-chain the
  // .platform access below.
  const uaData = (navigator as unknown as { userAgentData?: NavigatorUADataLike }).userAgentData
  if (uaData?.platform) return uaData.platform
  return navigator.platform
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
  // `navigator.connection` is the Network Information API (Chromium, partial
  // support). Not in TS's built-in Navigator type; cast via `unknown` and
  // guard every property read below with optional chaining.
  const conn = (navigator as unknown as { connection?: NetworkInformationLike }).connection
  const referrer = document.referrer || undefined
  return {
    userAgent: navigator.userAgent,
    platform: resolvePlatform(),
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
    timestamp: new Date().toISOString(),
  }
}
