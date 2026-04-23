import { test, expect, mock } from "bun:test"

// Mock the native modules BEFORE importing the collector.
mock.module("react-native", () => ({
  Platform: { OS: "ios", Version: "17.4" },
  Dimensions: {
    get: (k: "window" | "screen") =>
      k === "window" ? { width: 390, height: 844 } : { width: 1179, height: 2556 },
  },
  PixelRatio: { get: () => 3 },
}))
mock.module("expo-device", () => ({
  modelName: "iPhone 15",
}))
mock.module("expo-constants", () => ({
  default: { expoConfig: { version: "1.2.3" }, nativeBuildVersion: "42" },
}))
mock.module("@react-native-community/netinfo", () => ({
  fetch: async () => ({
    isConnected: true,
    details: { effectiveType: "4g", rtt: 50, downlink: 10 },
  }),
}))

test("assembles a mobile SystemInfo record", async () => {
  const { collectSystemInfo } = await import("./system-info")
  const info = await collectSystemInfo({ pageUrl: "myapp://home" })
  expect(info.devicePlatform).toBe("ios")
  expect(info.deviceModel).toBe("iPhone 15")
  expect(info.appVersion).toBe("1.2.3")
  expect(info.appBuild).toBe("42")
  expect(info.osVersion).toBe("17.4")
  expect(info.viewport).toEqual({ w: 390, h: 844 })
  expect(info.screen).toEqual({ w: 1179, h: 2556 })
  expect(info.dpr).toBe(3)
  expect(info.online).toBe(true)
  expect(info.connection?.effectiveType).toBe("4g")
  expect(info.pageUrl).toBe("myapp://home")
  expect(info.userAgent).toMatch(/Expo/)
})
