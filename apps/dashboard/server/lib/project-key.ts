const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const KEY_LEN = 24
const PREFIX = "ft_pk_"

export function generatePublicKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_LEN))
  let out = PREFIX
  for (let i = 0; i < KEY_LEN; i++) out += BASE62[bytes[i] % 62]
  return out
}

export function isValidPublicKey(s: unknown): s is string {
  if (typeof s !== "string") return false
  if (!s.startsWith(PREFIX)) return false
  const tail = s.slice(PREFIX.length)
  if (tail.length !== KEY_LEN) return false
  return /^[A-Za-z0-9]+$/.test(tail)
}
