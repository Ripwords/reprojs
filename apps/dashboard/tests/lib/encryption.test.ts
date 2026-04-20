import { describe, expect, test } from "bun:test"
import { decrypt, encrypt } from "../../server/lib/encryption"

// 32 raw bytes, base64 — shape matches `openssl rand -base64 32` output.
const SECRET = "T8fMqNpToqnaHRrk673aSy/pcl6Gqe1vmOs55s9/zSM="
const OTHER_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa="

describe("encryption", () => {
  test("round-trips a string with the same secret", () => {
    const ciphertext = encrypt("hello world", SECRET)
    expect(decrypt(ciphertext, SECRET)).toBe("hello world")
  })

  test("produces different ciphertext for identical inputs (random IV)", () => {
    const a = encrypt("same input", SECRET)
    const b = encrypt("same input", SECRET)
    expect(a).not.toBe(b)
  })

  test("ciphertext is base64 with non-zero length", () => {
    const ciphertext = encrypt("x", SECRET)
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(ciphertext.length).toBeGreaterThan(0)
  })

  test("decrypting with a different secret throws", () => {
    const ciphertext = encrypt("hello world", SECRET)
    expect(() => decrypt(ciphertext, OTHER_SECRET)).toThrow()
  })

  test("decrypting a tampered ciphertext throws", () => {
    const ciphertext = encrypt("hello world", SECRET)
    // Flip one byte inside the ciphertext portion (beyond iv+authTag).
    const buf = Buffer.from(ciphertext, "base64")
    buf[buf.length - 1] ^= 0xff
    const tampered = buf.toString("base64")
    expect(() => decrypt(tampered, SECRET)).toThrow()
  })

  test("round-trips multi-line PEM content (GitHub App private key shape)", () => {
    const pem = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEA0abc...",
      "AbCdEf1234567890...",
      "-----END RSA PRIVATE KEY-----",
      "",
    ].join("\n")
    expect(decrypt(encrypt(pem, SECRET), SECRET)).toBe(pem)
  })

  test("round-trips unicode", () => {
    const input = "héllo 👋 世界"
    expect(decrypt(encrypt(input, SECRET), SECRET)).toBe(input)
  })
})
