import { describe, expect, mock, test } from "bun:test"

mock.module("expo-document-picker", () => ({
  getDocumentAsync: async () => ({ canceled: true }),
}))

describe("pickFromFiles", () => {
  test("returns empty array when canceled", async () => {
    const { pickFromFiles } = await import("./file-picker")
    const out = await pickFromFiles({ multiple: true })
    expect(out).toEqual([])
  })
})
