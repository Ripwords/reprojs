/**
 * Best-effort OS + browser extraction from a User-Agent string. The SDK
 * only captures raw UA + `navigator.platform` ("MacIntel", "Win32"…), so
 * versions come from UA tokens — there is no reliable way to map
 * macOS 14 → "Sonoma" or Windows NT 10.0 → "Windows 11" without a
 * runtime signal the browser doesn't expose, so we surface the raw
 * version instead.
 */

export type UserAgentInfo = {
  label: string
  icon: string
}

export function parseOs(userAgent: string | undefined, platform?: string): UserAgentInfo {
  const ua = userAgent ?? ""

  const mac = ua.match(/Mac OS X (\d+)[_.](\d+)(?:[_.](\d+))?/)
  if (mac) {
    const version = [mac[1], mac[2], mac[3]].filter(Boolean).join(".")
    return { label: `macOS ${version}`, icon: "i-simple-icons-apple" }
  }

  const iphone = ua.match(/iPhone OS (\d+)_(\d+)(?:_(\d+))?/)
  if (iphone) {
    const v = [iphone[1], iphone[2], iphone[3]].filter(Boolean).join(".")
    return { label: `iOS ${v}`, icon: "i-simple-icons-apple" }
  }
  const ipad = ua.match(/CPU OS (\d+)_(\d+)(?:_(\d+))?.*like Mac OS X/)
  if (ipad) {
    const v = [ipad[1], ipad[2], ipad[3]].filter(Boolean).join(".")
    return { label: `iPadOS ${v}`, icon: "i-simple-icons-apple" }
  }

  const win = ua.match(/Windows NT (\d+(?:\.\d+)?)/)
  if (win?.[1]) {
    const version = win[1]
    const map: Record<string, string> = {
      "10.0": "Windows 10/11",
      "6.3": "Windows 8.1",
      "6.2": "Windows 8",
      "6.1": "Windows 7",
    }
    return { label: map[version] ?? `Windows NT ${version}`, icon: "i-simple-icons-windows" }
  }

  const android = ua.match(/Android (\d+(?:\.\d+)*)/)
  if (android) return { label: `Android ${android[1]}`, icon: "i-simple-icons-android" }
  if (/Android/i.test(ua)) return { label: "Android", icon: "i-simple-icons-android" }

  if (/CrOS/i.test(ua)) return { label: "ChromeOS", icon: "i-simple-icons-googlechrome" }
  if (/Linux/i.test(ua)) return { label: "Linux", icon: "i-simple-icons-linux" }

  return { label: platform || "Unknown", icon: "i-heroicons-computer-desktop" }
}

export function parseBrowser(userAgent: string | undefined): UserAgentInfo {
  const ua = userAgent ?? ""

  const edge = ua.match(/Edg(?:e|A|iOS)?\/(\d+(?:\.\d+)*)/)
  if (edge) return { label: `Edge ${edge[1]}`, icon: "i-simple-icons-microsoftedge" }

  const opera = ua.match(/OPR\/(\d+(?:\.\d+)*)/)
  if (opera) return { label: `Opera ${opera[1]}`, icon: "i-simple-icons-opera" }

  const firefox = ua.match(/(?:Firefox|FxiOS)\/(\d+(?:\.\d+)*)/)
  if (firefox) return { label: `Firefox ${firefox[1]}`, icon: "i-simple-icons-firefoxbrowser" }

  // Chrome must be checked after Edge/Opera (they include "Chrome/…" too).
  const chrome = ua.match(/(?:Chrome|CriOS)\/(\d+(?:\.\d+)*)/)
  if (chrome) return { label: `Chrome ${chrome[1]}`, icon: "i-simple-icons-googlechrome" }

  // Safari's real version is in "Version/"; the trailing "Safari/" token is
  // the WebKit build number, not the user-visible version.
  if (/Safari/.test(ua)) {
    const version = ua.match(/Version\/(\d+(?:\.\d+)*)/)
    return {
      label: version ? `Safari ${version[1]}` : "Safari",
      icon: "i-simple-icons-safari",
    }
  }

  return { label: "Unknown", icon: "i-heroicons-globe-alt" }
}
