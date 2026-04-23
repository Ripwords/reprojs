// apps/dashboard/server/lib/comment-serializer.test.ts
import { describe, test, expect } from "bun:test"
import { withBotFooter, stripBotFooter, hasBotFooter } from "./comment-serializer"

describe("withBotFooter", () => {
  test("appends a markdown blockquote with the author name", () => {
    const out = withBotFooter("hello", { name: "Jane Doe", githubLogin: null })
    expect(out).toContain("hello")
    expect(out).toMatch(/—\s*\*Jane Doe\*\s+\(via Repro dashboard\)/)
    expect(out.split("\n").some((l) => l.trim().startsWith(">"))).toBe(true)
  })

  test("uses @handle when the author has a linked github identity", () => {
    const out = withBotFooter("hi", { name: "Jane", githubLogin: "jane-gh" })
    expect(out).toContain("@jane-gh")
  })

  test("multi-line body preserves original", () => {
    const out = withBotFooter("line1\n\nline2", { name: "X", githubLogin: null })
    expect(out).toContain("line1\n\nline2")
  })

  test("uses fallback attribution when both name and githubLogin are null", () => {
    const out = withBotFooter("test", { name: null, githubLogin: null })
    expect(out).toContain("Repro dashboard user")
  })
})

describe("stripBotFooter", () => {
  test("removes a trailing footer produced by withBotFooter", () => {
    const body = withBotFooter("hello", { name: "Jane", githubLogin: null })
    expect(stripBotFooter(body)).toBe("hello")
  })

  test("leaves a body without footer unchanged", () => {
    expect(stripBotFooter("plain body")).toBe("plain body")
  })

  test("does not strip a blockquote that is NOT our footer", () => {
    const body = "first\n\n> a user's own quote"
    expect(stripBotFooter(body)).toBe(body)
  })

  test("handles multi-line body correctly", () => {
    const body = withBotFooter("line1\n\nline2", { name: "Jane", githubLogin: null })
    expect(stripBotFooter(body)).toBe("line1\n\nline2")
  })
})

describe("hasBotFooter", () => {
  test("detects the footer", () => {
    const body = withBotFooter("hello", { name: "J", githubLogin: null })
    expect(hasBotFooter(body)).toBe(true)
  })

  test("returns false without a footer", () => {
    expect(hasBotFooter("hello")).toBe(false)
  })

  test("returns false for random blockquotes", () => {
    expect(hasBotFooter("> some quoted text")).toBe(false)
  })
})
