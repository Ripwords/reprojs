import { describe, expect, test } from "bun:test"
import { generatePublicKey, isValidPublicKey } from "./project-key"

describe("generatePublicKey", () => {
  test("returns ft_pk_ prefix + 24 base62 chars", () => {
    const k = generatePublicKey()
    expect(k).toMatch(/^ft_pk_[A-Za-z0-9]{24}$/)
  })

  test("is unique across 1000 calls", () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(generatePublicKey())
    expect(seen.size).toBe(1000)
  })
})

describe("isValidPublicKey", () => {
  test("accepts well-formed keys", () => {
    expect(isValidPublicKey("ft_pk_abc123XYZ456defGHI7890jk")).toBe(true)
  })

  test("rejects wrong prefix", () => {
    expect(isValidPublicKey("abc_pk_abc123XYZ456defGHI7890jk")).toBe(false)
  })

  test("rejects wrong length", () => {
    expect(isValidPublicKey("ft_pk_short")).toBe(false)
  })

  test("rejects non-base62 chars", () => {
    expect(isValidPublicKey("ft_pk_!!!123XYZ456defGHI7890jk")).toBe(false)
  })
})
