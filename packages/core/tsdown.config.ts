import { defineConfig } from "tsdown"

// Every runtime dep is bundled into @reprokit/core so consumers install
// a single package (`npm install @reprokit/core`) with zero transitive
// npm resolution. @reprokit/{shared,ui,recorder} stay private workspace
// packages — they exist as build inputs only, never shipped standalone.
const INTERNAL_BUNDLE = [
  /^@reprokit\//,
  /^preact($|\/)/,
  /^@preact\//,
  /^modern-screenshot$/,
  /^zod$/,
]

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
    dts: { resolve: [/^@reprokit\//], eager: true },
    noExternal: INTERNAL_BUNDLE,
  },
  {
    ...common,
    entry: { repro: "src/index.ts" },
    format: ["iife"],
    outDir: "dist",
    minify: true,
    globalName: "Repro",
    noExternal: INTERNAL_BUNDLE,
  },
])
