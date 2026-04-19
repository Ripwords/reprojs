import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { createError, defineEventHandler, setHeader, setResponseStatus } from "h3"
import { env } from "../../lib/env"

// `bun run dev` at the repo root invokes `bun --filter dashboard dev`, which
// sets cwd to `apps/dashboard/`. In production, cwd will be the `.output/`
// deploy root. An explicit SDK_PATH env var overrides both for custom deploys.
const SDK_PATH =
  env.SDK_PATH !== ""
    ? env.SDK_PATH
    : join(process.cwd(), "..", "..", "packages", "core", "dist", "repro.iife.js")

// Keyed on file mtime so a rebuild (new sdk:build output) invalidates the cache
// automatically — no dashboard restart required.
let cached: { mtimeMs: number; bytes: Uint8Array } | null = null

export default defineEventHandler(async (event) => {
  setHeader(event, "Content-Type", "application/javascript; charset=utf-8")
  // Short cache so browsers pick up a rebuilt SDK within a minute during dev.
  setHeader(event, "Cache-Control", "public, max-age=60")
  setHeader(event, "Access-Control-Allow-Origin", "*")

  try {
    const stats = await stat(SDK_PATH)
    if (!cached || cached.mtimeMs !== stats.mtimeMs) {
      const buf = await readFile(SDK_PATH)
      cached = { mtimeMs: stats.mtimeMs, bytes: new Uint8Array(buf) }
    }
    return cached.bytes
  } catch (err) {
    setResponseStatus(event, 503)
    throw createError({
      statusCode: 503,
      statusMessage: "SDK bundle not found. Run `bun run sdk:build` at the repo root.",
      data: { path: SDK_PATH, err: err instanceof Error ? err.message : String(err) },
    })
  }
})
