const MAX_LEN = 200

/**
 * Make a user-supplied filename safe to put in a storage key. Strips path
 * separators (../, .\, /) and control bytes. Truncates to MAX_LEN. Returns
 * `attachment-${idx}` if nothing usable is left.
 */
export function sanitizeFilename(input: string, idx = 0): string {
  // First strip path-traversal sequences (..) — must run before the single
  // char pass so that "../../" becomes "" rather than leaving orphan dots.
  // eslint-disable-next-line no-control-regex
  let cleaned = input.replace(/\.\./g, "").replace(/[\x00-\x1F\x7F /\\]/g, "")
  if (cleaned.length > MAX_LEN) cleaned = cleaned.slice(0, MAX_LEN)
  if (cleaned.length === 0) return `attachment-${idx}`
  return cleaned
}
