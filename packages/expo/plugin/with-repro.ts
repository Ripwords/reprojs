import type { ConfigPlugin } from "@expo/config-plugins"

const withRepro: ConfigPlugin = (config) => {
  // v1 intentionally no-op. Future: add Info.plist / AndroidManifest patches
  // (e.g. NSPhotoLibraryAddUsageDescription if we add camera-roll save).
  return config
}

export default withRepro
