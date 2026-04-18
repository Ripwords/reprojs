#!/usr/bin/env bun
// apps/dashboard/scripts/generate-icons.ts
//
// Rasterizes icon-light.svg + icon-dark.svg into PNGs at the sizes the
// dashboard needs. Run: `bun run icons` from apps/dashboard.

import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import sharp from "sharp"

const ROOT = join(import.meta.dir, "..", "public")
const LIGHT_SVG = join(ROOT, "icon-light.svg")
const DARK_SVG = join(ROOT, "icon-dark.svg")

interface Target {
  src: string
  out: string
  size: number
}

const TARGETS: Target[] = [
  { src: LIGHT_SVG, out: "icon-light.png", size: 1024 },
  { src: DARK_SVG, out: "icon-dark.png", size: 1024 },
  { src: LIGHT_SVG, out: "apple-touch-icon.png", size: 180 },
  { src: LIGHT_SVG, out: "pwa-192x192.png", size: 192 },
  { src: LIGHT_SVG, out: "pwa-512x512.png", size: 512 },
  { src: LIGHT_SVG, out: "favicon-32x32.png", size: 32 },
  { src: LIGHT_SVG, out: "favicon-16x16.png", size: 16 },
]

async function render(t: Target): Promise<void> {
  const out = join(ROOT, t.out)
  await mkdir(dirname(out), { recursive: true })
  await sharp(t.src).resize(t.size, t.size).png({ compressionLevel: 9 }).toFile(out)
  console.log(`✓ ${t.out} (${t.size}×${t.size})`)
}

await mkdir(ROOT, { recursive: true })
await Promise.all(TARGETS.map(render))
