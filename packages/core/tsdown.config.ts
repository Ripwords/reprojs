import { defineConfig } from "tsdown"

const common = {
  platform: "browser" as const,
  target: "es2020" as const,
  loader: { ".css": "text" as const },
}

export default defineConfig([
  {
    ...common,
    entry: { index: "src/index.ts" },
    format: ["esm"],
    outDir: "dist",
    dts: true,
  },
  {
    ...common,
    entry: { "repro.iife": "src/index.ts" },
    format: ["iife"],
    outDir: "dist",
    minify: true,
    globalName: "Repro",
    noExternal: [/@reprokit\//, /preact/, /modern-screenshot/, /zod/],
  },
])
