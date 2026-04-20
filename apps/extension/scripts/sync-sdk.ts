import { existsSync } from "node:fs"
import { copyFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dirname, "../../../packages/core/dist/repro.iife.js")
const DEST = resolve(__dirname, "../public/repro.iife.js")

if (!existsSync(SRC)) {
  console.error(
    `[sync-sdk] Missing ${SRC}.\n` +
      `Run 'bun run sdk:build' from the repo root before building the extension.`,
  )
  process.exit(1)
}

await mkdir(dirname(DEST), { recursive: true })
await copyFile(SRC, DEST)
console.log(`[sync-sdk] Copied @reprojs/core IIFE → ${DEST}`)
