// apps/dashboard/server/lib/comment-serializer.ts
// Pure functions for serializing/deserializing dashboard comment bodies
// with a GitHub-style attribution footer.
const FOOTER_MARKER = "(via Repro dashboard)"

export type CommentAuthor = { name: string | null; githubLogin: string | null }

export function withBotFooter(body: string, author: CommentAuthor): string {
  const attribution = author.githubLogin
    ? `@${author.githubLogin}`
    : (author.name ?? "Repro dashboard user")
  return `${body}\n\n> — *${attribution}* ${FOOTER_MARKER}`
}

export function hasBotFooter(body: string): boolean {
  // Our footer specifically: a trailing blockquote line containing the marker.
  // Match only the last non-empty line.
  const lines = body.trimEnd().split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line === "") continue
    return line.startsWith(">") && line.includes(FOOTER_MARKER)
  }
  return false
}

export function stripBotFooter(body: string): string {
  if (!hasBotFooter(body)) return body
  const lines = body.split("\n")
  // Walk backwards removing trailing blank + the footer line
  let lastContentIdx = lines.length - 1
  while (lastContentIdx >= 0 && lines[lastContentIdx].trim() === "") lastContentIdx--
  if (lastContentIdx < 0) return ""
  // Remove the footer line
  lines.splice(lastContentIdx, 1)
  // Trim trailing blank lines that were separators
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop()
  return lines.join("\n")
}
