export const MAX_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024

export function checkBodySize(length: number | undefined): boolean {
  if (length === undefined) return true
  if (!Number.isFinite(length)) return false
  return length <= MAX_WEBHOOK_BODY_BYTES
}
