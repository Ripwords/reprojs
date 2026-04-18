import { createHmac } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { verifyWebhookSignature } from "./signature"

const SECRET = "test-secret"

function sign(secret: string, payload: string): string {
  const h = createHmac("sha256", secret)
  h.update(payload)
  return `sha256=${h.digest("hex")}`
}

describe("verifyWebhookSignature", () => {
  test("valid signature returns true", () => {
    const payload = `{"a":1}`
    const signatureHeader = sign(SECRET, payload)
    expect(verifyWebhookSignature({ secret: SECRET, payload, signatureHeader })).toBe(true)
  })
  test("wrong secret returns false", () => {
    const payload = `{"a":1}`
    const signatureHeader = sign("other-secret", payload)
    expect(verifyWebhookSignature({ secret: SECRET, payload, signatureHeader })).toBe(false)
  })
  test("tampered payload returns false", () => {
    const payload = `{"a":1}`
    const signatureHeader = sign(SECRET, payload)
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        payload: `{"a":2}`,
        signatureHeader,
      }),
    ).toBe(false)
  })
  test("missing sha256 prefix returns false", () => {
    expect(
      verifyWebhookSignature({ secret: SECRET, payload: "x", signatureHeader: "abcd1234" }),
    ).toBe(false)
  })
  test("malformed hex returns false", () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        payload: "x",
        signatureHeader: "sha256=zzz",
      }),
    ).toBe(false)
  })
})
