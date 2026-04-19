import { describe, expect, test } from "bun:test"
import { generatePublicKey } from "./project-key"

describe("generatePublicKey", () => {
  test("returns rp_pk_ prefix + 24 base62 chars", () => {
    const k = generatePublicKey()
    expect(k).toMatch(/^rp_pk_[A-Za-z0-9]{24}$/)
  })

  test("is unique across 1000 calls", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(generatePublicKey())
    expect(seen.size).toBe(1000)
  })
})
