const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const KEY_LEN = 24
const PREFIX = "ft_pk_"

export function generatePublicKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_LEN))
  let out = PREFIX
  for (let i = 0; i < KEY_LEN; i++) {
    const b = bytes[i] ?? 0
    out += BASE62[b % 62] ?? "0"
  }
  return out
}
