import { defineConfig } from "vite"
import { crx } from "@crxjs/vite-plugin"
import preactPreset from "@preact/preset-vite"
import manifest from "./manifest.config"

export default defineConfig({
  plugins: [preactPreset(), crx({ manifest })],
  build: {
    target: "es2022",
  },
})
