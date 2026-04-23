import { createHmac, timingSafeEqual } from "node:crypto"

type SignInput = { userId: string; secret: string; ttlSeconds: number }

export function signIdentityState({ userId, secret, ttlSeconds }: SignInput): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
  const nonce = crypto.randomUUID()
  const payload = `${userId}.${expiresAt}.${nonce}`
  const sig = createHmac("sha256", secret).update(payload).digest("hex")
  return Buffer.from(`${payload}.${sig}`).toString("base64url")
}

export function verifyIdentityState({ state, secret }: { state: string; secret: string }): {
  userId: string
} {
  const decoded = Buffer.from(state, "base64url").toString("utf8")
  const parts = decoded.split(".")
  if (parts.length !== 4) throw new Error("malformed state")
  const [userId, expiresAtStr, nonce, sig] = parts
  const expected = createHmac("sha256", secret)
    .update(`${userId}.${expiresAtStr}.${nonce}`)
    .digest("hex")
  const a = Buffer.from(sig, "hex")
  const b = Buffer.from(expected, "hex")
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("bad signature")
  const expiresAt = Number(expiresAtStr)
  if (!Number.isFinite(expiresAt)) throw new Error("malformed state")
  if (expiresAt < Math.floor(Date.now() / 1000)) throw new Error("state expired")
  return { userId }
}
