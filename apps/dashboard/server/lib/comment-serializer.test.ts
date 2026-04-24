// apps/dashboard/server/lib/comment-serializer.test.ts
import { describe, test, expect } from "bun:test"
import { withBotFooter, stripBotFooter, hasBotFooter } from "./comment-serializer"

const SECRET = "test-secret-please-ignore"
const OTHER_SECRET = "different-secret"

describe("withBotFooter", () => {
  test("appends a markdown blockquote with the author name", () => {
    const out = withBotFooter("hello", { name: "Jane Doe", githubLogin: null }, SECRET)
    expect(out).toContain("hello")
    expect(out).toMatch(/—\s*\*Jane Doe\*\s+\(via Repro dashboard\)/)
    expect(out.split("\n").some((l) => l.trim().startsWith(">"))).toBe(true)
  })

  test("uses @handle when the author has a linked github identity", () => {
    const out = withBotFooter("hi", { name: "Jane", githubLogin: "jane-gh" }, SECRET)
    expect(out).toContain("@jane-gh")
  })

  test("multi-line body preserves original", () => {
    const out = withBotFooter("line1\n\nline2", { name: "X", githubLogin: null }, SECRET)
    expect(out).toContain("line1\n\nline2")
  })

  test("uses fallback attribution when both name and githubLogin are null", () => {
    const out = withBotFooter("test", { name: null, githubLogin: null }, SECRET)
    expect(out).toContain("Repro dashboard user")
  })

  test("includes an HTML-comment signature line", () => {
    const out = withBotFooter("hi", { name: "J", githubLogin: null }, SECRET)
    expect(out).toMatch(/<!-- repro-bot:[a-f0-9]{32} -->\s*$/)
  })
})

describe("stripBotFooter", () => {
  test("removes a trailing footer produced by withBotFooter", () => {
    const body = withBotFooter("hello", { name: "Jane", githubLogin: null }, SECRET)
    expect(stripBotFooter(body, SECRET)).toBe("hello")
  })

  test("leaves a body without footer unchanged", () => {
    expect(stripBotFooter("plain body", SECRET)).toBe("plain body")
  })

  test("does not strip a blockquote that is NOT our footer", () => {
    const body = "first\n\n> a user's own quote"
    expect(stripBotFooter(body, SECRET)).toBe(body)
  })

  test("handles multi-line body correctly", () => {
    const body = withBotFooter("line1\n\nline2", { name: "Jane", githubLogin: null }, SECRET)
    expect(stripBotFooter(body, SECRET)).toBe("line1\n\nline2")
  })

  test("does NOT strip a user-crafted lookalike footer (no valid signature)", () => {
    const spoofed = "attack\n\n> — *victim* (via Repro dashboard)"
    expect(stripBotFooter(spoofed, SECRET)).toBe(spoofed)
  })

  test("does NOT strip when signed with a different secret", () => {
    const body = withBotFooter("hello", { name: "Jane", githubLogin: null }, SECRET)
    expect(stripBotFooter(body, OTHER_SECRET)).toBe(body)
  })

  test("does NOT strip when the body has been tampered with after signing", () => {
    const body = withBotFooter("original", { name: "Jane", githubLogin: null }, SECRET)
    const tampered = body.replace(/^original/, "tampered")
    expect(stripBotFooter(tampered, SECRET)).toBe(tampered)
  })
})

describe("hasBotFooter", () => {
  test("detects a valid footer", () => {
    const body = withBotFooter("hello", { name: "J", githubLogin: null }, SECRET)
    expect(hasBotFooter(body, SECRET)).toBe(true)
  })

  test("returns false without a footer", () => {
    expect(hasBotFooter("hello", SECRET)).toBe(false)
  })

  test("returns false for random blockquotes", () => {
    expect(hasBotFooter("> some quoted text", SECRET)).toBe(false)
  })

  test("returns false for a user-crafted lookalike footer", () => {
    expect(hasBotFooter("attack\n\n> — *victim* (via Repro dashboard)", SECRET)).toBe(false)
  })

  test("returns false under a different secret", () => {
    const body = withBotFooter("hi", { name: null, githubLogin: null }, SECRET)
    expect(hasBotFooter(body, OTHER_SECRET)).toBe(false)
  })
})
