// Rasterize the dashboard's canonical brand SVG into the 16/48/128 PNGs the
// Chrome Web Store + manifest require. The SVG stays single-sourced at
// apps/dashboard/public/icon-light.svg so the extension and dashboard can
// never drift.
//
// Run automatically by `bun run build` inside apps/extension (same pattern
// as sync-sdk.ts). Generated PNGs are gitignored.

import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dirname, "../../../apps/dashboard/public/icon-light.svg")
const OUT_DIR = resolve(__dirname, "../public/icons")

if (!existsSync(SRC)) {
  console.error(`[sync-icons] Missing ${SRC}. Brand SVG was moved or deleted.`)
  process.exit(1)
}

const SIZES = [16, 48, 128] as const

await mkdir(OUT_DIR, { recursive: true })
await Promise.all(
  SIZES.map(async (size) => {
    const out = resolve(OUT_DIR, `${size}.png`)
    await sharp(SRC).resize(size, size).png({ compressionLevel: 9 }).toFile(out)
    console.log(`[sync-icons] ✓ ${size}×${size} → ${out}`)
  }),
)
