import { createHmac, timingSafeEqual } from "node:crypto"

export interface VerifyWebhookSignatureInput {
  secret: string
  payload: string
  signatureHeader: string
}

export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
  if (!input.signatureHeader.startsWith("sha256=")) return false
  const provided = input.signatureHeader.slice("sha256=".length)
  if (!/^[0-9a-f]+$/i.test(provided)) return false
  const hmac = createHmac("sha256", input.secret)
  hmac.update(input.payload)
  const expected = hmac.digest("hex")
  if (expected.length !== provided.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"))
  } catch {
    return false
  }
}
