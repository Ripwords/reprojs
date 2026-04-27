import { describe, expect, mock, test } from "bun:test"

mock.module("expo-document-picker", () => ({
  getDocumentAsync: async () => ({
    canceled: false,
    assets: [
      { uri: "file:///tmp/a.png", name: "a.png", mimeType: "image/png", size: 100 },
      { uri: "file:///tmp/b.pdf", name: "b.pdf", mimeType: "application/pdf", size: 200 },
    ],
  }),
}))

describe("pickFiles", () => {
  test("returns Attachment[] from a successful pick", async () => {
    const { pickFiles } = await import("./file-picker")
    const out = await pickFiles({ multiple: true })
    expect(out).toHaveLength(2)
    expect(out[0]?.filename).toBe("a.png")
    expect(out[0]?.mime).toBe("image/png")
    expect(out[0]?.size).toBe(100)
    expect(out[0]?.isImage).toBe(true)
  })
})
