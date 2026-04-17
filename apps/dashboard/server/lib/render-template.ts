import { readFile } from "node:fs/promises"
import { join } from "node:path"

const TEMPLATE_DIR = join(process.cwd(), "server", "emails")

const cache = new Map<string, string>()

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export async function renderTemplate(
  name: string,
  vars: Record<string, string>,
  opts?: { inline?: string },
): Promise<string> {
  let source = opts?.inline
  if (source === undefined) {
    const cached = cache.get(name)
    if (cached !== undefined) {
      source = cached
    } else {
      source = await readFile(join(TEMPLATE_DIR, `${name}.html`), "utf8")
      cache.set(name, source)
    }
  }

  return source.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, key) => {
    const val = vars[key]
    return val === undefined ? match : escapeHtml(val)
  })
}
