import { defineConfig } from "tsdown"

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    external: [
      "react",
      "react-native",
      "react-native-view-shot",
      "react-native-svg",
      "react-native-gesture-handler",
      "@react-native-async-storage/async-storage",
      "@react-native-community/netinfo",
      "expo",
      "expo-device",
      "expo-constants",
    ],
  },
  {
    entry: ["plugin/with-repro.ts"],
    format: ["cjs"],
    dts: false,
    clean: false,
    outDir: "dist/plugin",
    external: ["@expo/config-plugins"],
  },
])
