import { describe, expect, test } from "bun:test"
import { signManifestState, verifyManifestState } from "../../server/lib/manifest-state"

const SECRET = "test-better-auth-secret-abcdef0123456789"

describe("manifest-state", () => {
  test("round-trips with matching secret", () => {
    const exp = Math.floor(Date.now() / 1000) + 600
    const state = signManifestState({ userId: "u1", exp }, SECRET)
    expect(verifyManifestState(state, SECRET)).toEqual({ userId: "u1", exp })
  })

  test("rejects tampered body", () => {
    const state = signManifestState(
      { userId: "u1", exp: Math.floor(Date.now() / 1000) + 600 },
      SECRET,
    )
    const [, sig] = state.split(".")
    const tampered = `${Buffer.from('{"userId":"attacker","exp":9999999999}').toString("base64url")}.${sig}`
    expect(verifyManifestState(tampered, SECRET)).toBeNull()
  })

  test("rejects wrong secret", () => {
    const state = signManifestState(
      { userId: "u1", exp: Math.floor(Date.now() / 1000) + 600 },
      SECRET,
    )
    expect(verifyManifestState(state, "different-secret")).toBeNull()
  })

  test("rejects expired state", () => {
    const exp = Math.floor(Date.now() / 1000) - 10
    const state = signManifestState({ userId: "u1", exp }, SECRET)
    expect(verifyManifestState(state, SECRET)).toBeNull()
  })

  test("rejects malformed state (no dot separator)", () => {
    expect(verifyManifestState("not-a-state", SECRET)).toBeNull()
  })
})
