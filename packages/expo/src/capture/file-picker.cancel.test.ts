import { describe, expect, mock, test } from "bun:test"

mock.module("expo-document-picker", () => ({
  getDocumentAsync: async () => ({ canceled: true }),
}))

describe("pickFiles", () => {
  test("returns empty array when canceled", async () => {
    const { pickFiles } = await import("./file-picker")
    const out = await pickFiles({ multiple: true })
    expect(out).toEqual([])
  })
})
