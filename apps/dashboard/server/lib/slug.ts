const MAX_LEN = 64

export function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")

  if (!cleaned) {
    const suffix = Math.random().toString(36).slice(2, 8)
    return `project-${suffix}`
  }

  if (cleaned.length <= MAX_LEN) return cleaned

  const truncated = cleaned.slice(0, MAX_LEN)
  const lastDash = truncated.lastIndexOf("-")
  return lastDash > 20 ? truncated.slice(0, lastDash) : truncated
}
