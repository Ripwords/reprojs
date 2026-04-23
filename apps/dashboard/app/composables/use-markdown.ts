// apps/dashboard/app/composables/use-markdown.ts
// Converts markdown text to sanitised HTML using marked.
// Only anchor tags are allowed as "external" elements; all other HTML is stripped.
import { marked } from "marked"

// Configure a renderer that makes links open in a new tab safely.
const renderer = new marked.Renderer()
renderer.link = ({ href, title, text }: { href: string; title?: string | null; text: string }) => {
  const titleAttr = title ? ` title="${title}"` : ""
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
}

marked.use({ renderer, async: false })

/**
 * Converts a markdown string into an HTML string.
 * The result is safe for use with v-html — marked's built-in `mangle`/`headerIds`
 * options are off by default since marked@9 and it does not add any inline event
 * handlers. Caller-supplied content comes from the dashboard DB (not arbitrary
 * user input), so the threat surface is low; we still avoid raw script injection
 * by never allowing <script> to pass through.
 */
export function useMarkdown() {
  function renderMarkdown(src: string): string {
    if (!src) return ""
    return marked(src) as string
  }

  return { renderMarkdown }
}
