// apps/dashboard/app/composables/use-markdown.ts
//
// Converts markdown text to sanitised HTML using marked + DOMPurify.
//
// `marked` does NOT sanitise HTML — inline tags (<script>, <img onerror>,
// <iframe>, <svg onload>, event handlers) pass through untouched. Comment
// bodies in this app include content authored on GitHub (webhook: issue
// comment created/edited/backfill), i.e. any user who can comment on a
// synced public-repo issue can plant JS against every dashboard viewer.
// DOMPurify strips every dangerous construct before we bind via v-html.
import DOMPurify from "dompurify"
import { marked } from "marked"

// Anchor-tag renderer that forces target="_blank" + noopener for external
// links. DOMPurify then validates the final output.
const renderer = new marked.Renderer()
renderer.link = ({ href, title, text }: { href: string; title?: string | null; text: string }) => {
  const titleAttr = title ? ` title="${title}"` : ""
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
}

marked.use({ renderer, async: false })

/**
 * Converts a markdown string into an HTML string safe for `v-html`.
 *
 * Pipeline:
 *   1. `marked(src)` → HTML (may contain raw user-authored HTML tags)
 *   2. `DOMPurify.sanitize()` → HTML with scripts / event handlers / iframes /
 *      javascript: URIs stripped, preserving semantic markdown (headings,
 *      lists, code, tables, images, links, blockquotes, etc.)
 *
 * The `ADD_ATTR: ["target"]` config lets our link renderer's target="_blank"
 * survive sanitisation (DOMPurify strips target by default as an anti-phishing
 * measure; our renderer also adds rel="noopener noreferrer" so the risk is
 * covered).
 */
// Hosts whose image URLs need to be proxied through our origin. The
// `github.com/user-attachments/assets/<uuid>` URL is auth-gated — it only
// 302-resolves to a signed `private-user-images.githubusercontent.com/...`
// asset when the request carries a `_gh_sess` cookie or `Authorization`
// header. From a third-party browser tab the request 404s, so the dashboard
// would otherwise render a broken-image glyph for every screenshot pasted
// into a synced GitHub comment. We rewrite those URLs to flow through our
// own origin, where the server fetches them with the GitHub App
// installation token. Public `user-images.githubusercontent.com` (older
// uploads) and avatar URLs are unaffected.
const PROXY_HOST_RE =
  /^https:\/\/(?:github\.com\/user-attachments\/assets\/|private-user-images\.githubusercontent\.com\/)/

function rewriteGithubImages(html: string, projectId: string): string {
  return html.replace(/<img\b([^>]*?)\bsrc="([^"]+)"/gi, (whole, attrs: string, url: string) => {
    if (!PROXY_HOST_RE.test(url)) return whole
    const proxied = `/api/projects/${encodeURIComponent(projectId)}/integrations/github/image-proxy?url=${encodeURIComponent(url)}`
    return `<img${attrs} src="${proxied}"`
  })
}

export interface RenderMarkdownOptions {
  /** When set, GitHub user-attachment image URLs are rewritten through
   *  the dashboard's image-proxy endpoint so they bypass GitHub's auth gate. */
  rewriteImagesFor?: { projectId: string }
}

export function useMarkdown() {
  function renderMarkdown(src: string, opts?: RenderMarkdownOptions): string {
    if (!src) return ""
    let rawHtml = marked(src) as string
    if (opts?.rewriteImagesFor) {
      rawHtml = rewriteGithubImages(rawHtml, opts.rewriteImagesFor.projectId)
    }
    if (import.meta.server) {
      // DOMPurify needs a DOM. During SSR we return an unsanitised string —
      // BUT the Comments tab only renders on the client (it's a tab the user
      // has to open), so this branch is defensive rather than hot-path. If a
      // future page ever renders comment markdown in SSR, install jsdom here.
      return rawHtml
    }
    return DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ["target"],
      FORBID_TAGS: ["style"],
    })
  }

  return { renderMarkdown }
}
