import { beforeAll, describe, expect, test } from "bun:test"
import { safeHref } from "../../app/composables/use-safe-href"

// Mock window.location.origin for testing
beforeAll(() => {
  if (typeof window === "undefined") {
    Object.assign(globalThis, {
      window: {
        location: { origin: "http://localhost:3000" },
      },
    })
  }
})

describe("safeHref", () => {
  test("returns # for null/undefined", () => {
    expect(safeHref(null)).toBe("#")
    expect(safeHref(undefined)).toBe("#")
    expect(safeHref("")).toBe("#")
  })

  test("blocks javascript: URIs", () => {
    expect(safeHref("javascript:alert(1)")).toBe("#")
    expect(safeHref("JAVASCRIPT:alert(1)")).toBe("#")
  })

  test("blocks data: URIs", () => {
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBe("#")
  })

  test("allows http/https/mailto", () => {
    expect(safeHref("http://example.com/")).toContain("example.com")
    expect(safeHref("https://example.com/x?y=1")).toContain("example.com")
    expect(safeHref("mailto:a@b.com")).toContain("mailto:")
  })

  test("resolves relative URLs against window origin", () => {
    expect(safeHref("/some/path")).toContain("localhost:3000/some/path")
  })
})
