// apps/dashboard/server/lib/comment-serializer.ts
//
// Serializes dashboard comment bodies with a GitHub-style attribution footer
// plus an HMAC signature line so we can safely strip only footers we produced.
//
// Threat model: without a signature, a GitHub user could type the literal
// footer text (e.g. `> — *them* (via Repro dashboard)`) at the end of their
// own comment — and our backfill path would strip that last line as if it
// were a bot-generated footer, mangling the original body. The HMAC covers
// the comment body, so an attacker can copy the shape of the footer but can
// never produce a signature that verifies against their own content.
//
// Layout (trailing lines of a serialized body):
//   <body>
//
//   > — *<attribution>* (via Repro dashboard)
//   <!-- repro-bot:<hex-sig> -->
//
// `hex-sig` = first 32 hex chars of HMAC-SHA256(secret, <body>). The HTML
// comment survives GitHub's markdown render (invisible in the UI) and is
// both a recognition marker and the integrity check.
import { createHmac, timingSafeEqual } from "node:crypto"

const FOOTER_MARKER = "(via Repro dashboard)"
const SIG_PREFIX = "<!-- repro-bot:"
const SIG_SUFFIX = " -->"
const SIG_HEX_LEN = 32

export type CommentAuthor = { name: string | null; githubLogin: string | null }

function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex").slice(0, SIG_HEX_LEN)
}

export function withBotFooter(body: string, author: CommentAuthor, secret: string): string {
  const attribution = author.githubLogin
    ? `@${author.githubLogin}`
    : (author.name ?? "Repro dashboard user")
  const sig = signBody(body, secret)
  return `${body}\n\n> — *${attribution}* ${FOOTER_MARKER}\n${SIG_PREFIX}${sig}${SIG_SUFFIX}`
}

interface ParsedFooter {
  sig: string
  footerLineIdx: number
}

// Locate the two trailing lines that together form a bot footer: the HTML
// comment with the signature, preceded (optionally through blank lines) by
// the human-readable blockquote attribution. Returns null if either line is
// missing or malformed — without committing to whether the signature is
// actually valid, that's `hasBotFooter`'s job.
function parseFooter(body: string): ParsedFooter | null {
  const lines = body.trimEnd().split("\n")
  let markerIdx = -1
  let markerLine = ""
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? ""
    if (line.trim() === "") continue
    markerIdx = i
    markerLine = line.trim()
    break
  }
  if (markerIdx < 0) return null
  if (!markerLine.startsWith(SIG_PREFIX) || !markerLine.endsWith(SIG_SUFFIX)) return null
  const sig = markerLine.slice(SIG_PREFIX.length, markerLine.length - SIG_SUFFIX.length)
  if (sig.length !== SIG_HEX_LEN || !/^[a-f0-9]+$/.test(sig)) return null

  let footerIdx = -1
  let footerLine = ""
  for (let i = markerIdx - 1; i >= 0; i--) {
    const line = lines[i] ?? ""
    if (line.trim() === "") continue
    footerIdx = i
    footerLine = line.trim()
    break
  }
  if (footerIdx < 0) return null
  if (!footerLine.startsWith(">") || !footerLine.includes(FOOTER_MARKER)) return null

  return { sig, footerLineIdx: footerIdx }
}

// The body that was signed — everything before the blockquote footer line,
// with the separator blank line(s) trimmed off the end.
function originalBody(body: string, footerLineIdx: number): string {
  const lines = body.split("\n")
  const kept = lines.slice(0, footerLineIdx)
  while (kept.length && (kept[kept.length - 1] ?? "").trim() === "") kept.pop()
  return kept.join("\n")
}

export function hasBotFooter(body: string, secret: string): boolean {
  const parsed = parseFooter(body)
  if (!parsed) return false
  const expected = signBody(originalBody(body, parsed.footerLineIdx), secret)
  if (expected.length !== parsed.sig.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(parsed.sig, "utf8"))
  } catch {
    return false
  }
}

export function stripBotFooter(body: string, secret: string): string {
  const parsed = parseFooter(body)
  if (!parsed) return body
  const expected = signBody(originalBody(body, parsed.footerLineIdx), secret)
  if (expected.length !== parsed.sig.length) return body
  let valid = false
  try {
    valid = timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(parsed.sig, "utf8"))
  } catch {
    return body
  }
  if (!valid) return body
  return originalBody(body, parsed.footerLineIdx)
}
