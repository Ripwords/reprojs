import { defineConfig } from "vite"
import { crx } from "@crxjs/vite-plugin"
import preactPreset from "@preact/preset-vite"
import manifest from "./manifest.e2e.config"

export default defineConfig({
  plugins: [preactPreset(), crx({ manifest })],
  build: {
    target: "es2022",
    outDir: "dist-e2e",
  },
})
