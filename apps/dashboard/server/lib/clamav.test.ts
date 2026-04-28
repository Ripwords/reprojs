import { afterEach, describe, expect, test } from "bun:test"
import { _reloadEnvForTesting } from "./env"
import { _setClientForTesting, scanBytes } from "./clamav"

function fakeClient(impl: { isInfected: boolean | null; viruses?: string[]; throws?: Error }) {
  return {
    scanStream: async () => {
      if (impl.throws) throw impl.throws
      return { isInfected: impl.isInfected, viruses: impl.viruses ?? [] }
    },
  }
}

describe("scanBytes", () => {
  afterEach(() => {
    _setClientForTesting(null)
    delete process.env.INTAKE_USER_FILE_SCAN_ENABLED
    _reloadEnvForTesting()
  })

  test("returns clean immediately when scanning is disabled", async () => {
    delete process.env.INTAKE_USER_FILE_SCAN_ENABLED
    _reloadEnvForTesting()
    // Inject a client that would mark anything infected — proves we skipped it.
    _setClientForTesting(fakeClient({ isInfected: true, viruses: ["FAIL"] }))
    const result = await scanBytes(new Uint8Array([1, 2, 3]))
    expect(result).toEqual({ clean: true })
  })

  test("returns clean when scanner reports no infection", async () => {
    process.env.INTAKE_USER_FILE_SCAN_ENABLED = "true"
    _reloadEnvForTesting()
    _setClientForTesting(fakeClient({ isInfected: false }))
    const result = await scanBytes(new Uint8Array([1, 2, 3]))
    expect(result).toEqual({ clean: true })
  })

  test("returns clean=false with the first virus name when scanner finds one", async () => {
    process.env.INTAKE_USER_FILE_SCAN_ENABLED = "true"
    _reloadEnvForTesting()
    _setClientForTesting(
      fakeClient({ isInfected: true, viruses: ["Eicar-Test-Signature", "Other"] }),
    )
    const result = await scanBytes(new Uint8Array([1, 2, 3]))
    expect(result).toEqual({ clean: false, reason: "Eicar-Test-Signature" })
  })

  test("falls back to a generic reason when viruses array is empty", async () => {
    process.env.INTAKE_USER_FILE_SCAN_ENABLED = "true"
    _reloadEnvForTesting()
    _setClientForTesting(fakeClient({ isInfected: true, viruses: [] }))
    const result = await scanBytes(new Uint8Array([1, 2, 3]))
    expect(result).toEqual({ clean: false, reason: "infected" })
  })

  test("throws (fail-closed) when scanner errors", async () => {
    process.env.INTAKE_USER_FILE_SCAN_ENABLED = "true"
    _reloadEnvForTesting()
    _setClientForTesting(fakeClient({ isInfected: null, throws: new Error("ECONNREFUSED") }))
    await expect(scanBytes(new Uint8Array([1, 2, 3]))).rejects.toThrow(/scan failed/)
  })
})
