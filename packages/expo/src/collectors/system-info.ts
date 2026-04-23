import { Platform, Dimensions, PixelRatio } from "react-native"
import * as Device from "expo-device"
import Constants from "expo-constants"
import { fetch as fetchNetInfo } from "@react-native-community/netinfo"
import type { SystemInfo } from "@reprojs/shared"

export async function collectSystemInfo(opts: { pageUrl: string }): Promise<SystemInfo> {
  const os = Platform.OS
  const devicePlatform = os === "ios" ? "ios" : os === "android" ? "android" : undefined
  const windowDims = Dimensions.get("window")
  const screenDims = Dimensions.get("screen")
  const net = await fetchNetInfo().catch(() => null)
  const language =
    (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().locale) || "en"
  const timezone =
    (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC"
  const timezoneOffset = -new Date().getTimezoneOffset()
  const appVersion = (Constants.expoConfig?.version as string | undefined) ?? undefined
  const appBuild =
    ((Constants as unknown as { nativeBuildVersion?: string }).nativeBuildVersion as
      | string
      | undefined) ?? undefined

  return {
    userAgent: `Expo/${(Constants as unknown as { expoVersion?: string }).expoVersion ?? "unknown"} ${os} ${Platform.Version}`,
    platform: os,
    devicePlatform,
    appVersion,
    appBuild,
    deviceModel: Device.modelName ?? undefined,
    osVersion: String(Platform.Version),
    language,
    timezone,
    timezoneOffset,
    viewport: { w: Math.round(windowDims.width), h: Math.round(windowDims.height) },
    screen: { w: Math.round(screenDims.width), h: Math.round(screenDims.height) },
    dpr: PixelRatio.get(),
    online: !!net?.isConnected,
    connection: net?.details
      ? {
          effectiveType: (net.details as { effectiveType?: string }).effectiveType ?? undefined,
          rtt: (net.details as { rtt?: number }).rtt,
          downlink: (net.details as { downlink?: number }).downlink,
        }
      : undefined,
    pageUrl: opts.pageUrl,
    timestamp: new Date().toISOString(),
  }
}
