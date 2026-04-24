import { describe, test, expect } from "bun:test"
import { signIdentityState, verifyIdentityState } from "./identity-oauth-state"

const SECRET = "test-secret-abcdef"

describe("identity oauth state", () => {
  test("round-trips a userId", () => {
    const state = signIdentityState({ userId: "u-123", secret: SECRET, ttlSeconds: 600 })
    expect(verifyIdentityState({ state, secret: SECRET })).toEqual({ userId: "u-123" })
  })

  test("rejects tampered state", () => {
    const state = signIdentityState({ userId: "u-123", secret: SECRET, ttlSeconds: 600 })
    // Flip a character in the middle of the string — reliably changes decoded bytes
    const mid = Math.floor(state.length / 2)
    const bad = state.slice(0, mid) + (state[mid] === "a" ? "b" : "a") + state.slice(mid + 1)
    expect(() => verifyIdentityState({ state: bad, secret: SECRET })).toThrow()
  })

  test("rejects expired state", () => {
    const state = signIdentityState({ userId: "u-123", secret: SECRET, ttlSeconds: -1 })
    expect(() => verifyIdentityState({ state, secret: SECRET })).toThrow(/expired/i)
  })

  test("rejects state signed with a different secret", () => {
    const state = signIdentityState({ userId: "u-123", secret: SECRET, ttlSeconds: 600 })
    expect(() => verifyIdentityState({ state, secret: "other-secret" })).toThrow()
  })
})
