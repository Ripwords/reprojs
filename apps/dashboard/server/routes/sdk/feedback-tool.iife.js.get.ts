import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { createError, defineEventHandler, setHeader, setResponseStatus } from "h3"

// `bun run dev` at the repo root invokes `bun --filter dashboard dev`, which
// sets cwd to `apps/dashboard/`. In production, cwd will be the `.output/`
// deploy root. An explicit SDK_PATH env var overrides both for custom deploys.
const SDK_PATH =
  process.env.SDK_PATH ??
  join(process.cwd(), "..", "..", "packages", "core", "dist", "feedback-tool.iife.js")

let cached: Uint8Array | null = null

export default defineEventHandler(async (event) => {
  setHeader(event, "Content-Type", "application/javascript; charset=utf-8")
  setHeader(event, "Cache-Control", "public, max-age=300")
  setHeader(event, "Access-Control-Allow-Origin", "*")

  if (!cached) {
    try {
      const buf = await readFile(SDK_PATH)
      cached = new Uint8Array(buf)
    } catch (err) {
      setResponseStatus(event, 503)
      throw createError({
        statusCode: 503,
        statusMessage: "SDK bundle not found. Run `bun run sdk:build` at the repo root.",
        data: { path: SDK_PATH, err: err instanceof Error ? err.message : String(err) },
      })
    }
  }
  return cached
})
