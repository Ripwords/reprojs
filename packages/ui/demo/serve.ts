import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const sdkIife = join(repoRoot, "packages", "core", "dist", "feedback-tool.iife.js")
const indexHtml = join(here, "index.html")

Bun.serve({
  port: 4000,
  hostname: "localhost",
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const body = await readFile(indexHtml, "utf8")
      return new Response(body, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }
    if (url.pathname === "/sdk.iife.js") {
      try {
        const body = await readFile(sdkIife)
        return new Response(body, {
          headers: { "Content-Type": "application/javascript" },
        })
      } catch {
        return new Response("// Build the SDK first: bun run sdk:build\n", {
          status: 503,
          headers: { "Content-Type": "application/javascript" },
        })
      }
    }
    return new Response("Not found", { status: 404 })
  },
})

console.info("Feedback Tool demo playground: http://localhost:4000")
