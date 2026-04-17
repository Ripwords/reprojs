import { describe, expect, test } from "bun:test"
import { slugify } from "./slug"

describe("slugify", () => {
  test("lowercases and replaces spaces with dashes", () => {
    expect(slugify("Hello World")).toBe("hello-world")
  })
  test("collapses multiple separators", () => {
    expect(slugify("  Foo   Bar  ")).toBe("foo-bar")
    expect(slugify("foo--bar")).toBe("foo-bar")
  })
  test("strips non-alphanumeric characters", () => {
    expect(slugify("Foo@Bar!")).toBe("foobar")
    expect(slugify("日本語 project")).toBe("project")
  })
  test("truncates to 64 chars at a word boundary", () => {
    const long = "a".repeat(80)
    expect(slugify(long).length).toBeLessThanOrEqual(64)
  })
  test("returns a fallback for empty input", () => {
    expect(slugify("")).toMatch(/^project-[a-z0-9]{6}$/)
    expect(slugify("!!!")).toMatch(/^project-[a-z0-9]{6}$/)
  })
})
