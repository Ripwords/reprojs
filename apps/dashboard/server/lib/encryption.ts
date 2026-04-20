import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

// Domain-separation context for HKDF. If this string changes, every value
// encrypted with the old key becomes undecryptable — treat it as versioned.
// Bump only when migrating to a new key-derivation scheme (and write a
// re-encryption script that reads with the old context and writes with the new).
const HKDF_INFO = "repro-encryption-v1"

function deriveKey(secret: string): Buffer {
  const keyMaterial = Buffer.from(secret, "base64")
  return Buffer.from(hkdfSync("sha256", keyMaterial, Buffer.alloc(0), HKDF_INFO, 32))
}

export function encrypt(value: string, secret: string): string {
  const key = deriveKey(secret)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString("base64")
}

export function decrypt(payload: string, secret: string): string {
  const key = deriveKey(secret)
  const buffer = Buffer.from(payload, "base64")
  const iv = buffer.subarray(0, IV_LENGTH)
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString("utf8")
}
