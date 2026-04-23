import { describe, test, expect } from "bun:test"
import { checkBodySize, MAX_WEBHOOK_BODY_BYTES } from "./github-webhook-auth"

describe("checkBodySize", () => {
  test("accepts body at the limit", () => {
    const body = Buffer.alloc(MAX_WEBHOOK_BODY_BYTES)
    expect(checkBodySize(body.byteLength)).toBe(true)
  })

  test("rejects body over the limit", () => {
    expect(checkBodySize(MAX_WEBHOOK_BODY_BYTES + 1)).toBe(false)
  })

  test("accepts missing content-length", () => {
    expect(checkBodySize(undefined)).toBe(true)
  })

  test("rejects non-numeric content-length", () => {
    expect(checkBodySize(Number.NaN)).toBe(false)
  })
})
