import { describe, expect, test } from "bun:test"
import { sanitizeFilename } from "./sanitize-filename"

describe("sanitizeFilename", () => {
  test("strips path separators", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("etcpasswd")
    expect(sanitizeFilename("a\\b\\c.png")).toBe("abc.png")
  })

  test("strips control bytes and NULs", () => {
    expect(sanitizeFilename("a bc.txt")).toBe("abc.txt")
  })

  test("truncates to 200 chars", () => {
    const long = "a".repeat(500) + ".png"
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(200)
  })

  test("returns fallback for empty input", () => {
    expect(sanitizeFilename("", 7)).toBe("attachment-7")
    expect(sanitizeFilename("///", 3)).toBe("attachment-3")
  })

  test("preserves unicode word characters", () => {
    expect(sanitizeFilename("rapport-é.png")).toBe("rapport-é.png")
  })
})
