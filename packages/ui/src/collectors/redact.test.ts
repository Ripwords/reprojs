// packages/ui/src/collectors/redact.test.ts
import { describe, expect, test } from "bun:test"
import {
  DEFAULT_ALLOWED_REQUEST_HEADERS,
  DEFAULT_ALLOWED_RESPONSE_HEADERS,
  DEFAULT_REDACTED_QUERY_PARAMS,
  DEFAULT_SENSITIVE_COOKIE_NAMES,
  redactBody,
  redactCookies,
  redactHeaders,
  redactUrl,
} from "./redact"

describe("redactCookies", () => {
  test("redacts denylist names case-insensitively", () => {
    const out = redactCookies([
      { name: "session", value: "abc" },
      { name: "SessionId", value: "xyz" },
      { name: "locale", value: "en" },
    ])
    expect(out).toEqual([
      { name: "session", value: "<redacted>" },
      { name: "SessionId", value: "<redacted>" },
      { name: "locale", value: "en" },
    ])
  })

  test("strips __Secure- and __Host- prefixes before matching", () => {
    const out = redactCookies([
      { name: "__Secure-session", value: "s" },
      { name: "__Host-auth", value: "a" },
    ])
    expect(out.every((c) => c.value === "<redacted>")).toBe(true)
  })

  test("allowNames overrides redaction", () => {
    const out = redactCookies([{ name: "session", value: "keepme" }], { allowNames: ["session"] })
    expect(out[0].value).toBe("keepme")
  })

  test("maskNames extends the defaults", () => {
    const out = redactCookies([{ name: "my_custom_id", value: "abc" }], {
      maskNames: ["custom_id"],
    })
    expect(out[0].value).toBe("<redacted>")
  })
})

describe("redactHeaders", () => {
  test("request headers allowlist strips unlisted", () => {
    const out = redactHeaders(
      { "Content-Type": "application/json", Authorization: "Bearer x", "X-Custom": "y" },
      "request",
    )
    expect(out).toEqual({ "content-type": "application/json" })
  })

  test("response headers allowlist strips unlisted", () => {
    const out = redactHeaders(
      { "Content-Type": "application/json", "Set-Cookie": "x", ETag: "abc" },
      "response",
    )
    expect(Object.keys(out).toSorted()).toEqual(["content-type", "etag"])
  })

  test("all: true passes everything through (lowercased)", () => {
    const out = redactHeaders({ Authorization: "Bearer x" }, "request", { all: true })
    expect(out).toEqual({ authorization: "Bearer x" })
  })

  test("extra allowed headers merge with defaults", () => {
    const out = redactHeaders(
      { "Content-Type": "application/json", "X-Feature": "on", Authorization: "Bearer x" },
      "request",
      { allowed: ["x-feature"] },
    )
    expect(out).toEqual({
      "content-type": "application/json",
      "x-feature": "on",
    })
  })
})

describe("redactUrl", () => {
  test("scrubs default sensitive params", () => {
    const out = redactUrl("https://api.example.com/x?api_key=secret&debug=1")
    expect(out).toBe("https://api.example.com/x?api_key=REDACTED&debug=1")
  })

  test("preserves non-sensitive params", () => {
    const out = redactUrl("https://api.example.com/x?page=2&limit=10")
    expect(out).toBe("https://api.example.com/x?page=2&limit=10")
  })

  test("leaves unparseable URLs alone", () => {
    expect(redactUrl("not a url")).toBe("not a url")
  })

  test("accepts custom redact key list", () => {
    const out = redactUrl("https://x/y?custom_key=secret&page=1", ["custom_key"])
    expect(out).toBe("https://x/y?custom_key=REDACTED&page=1")
  })
})

describe("redactBody", () => {
  test("returns null for null input", () => {
    expect(redactBody(null, { maxBytes: 100 })).toBeNull()
  })

  test("truncates when over maxBytes", () => {
    const out = redactBody("x".repeat(1000), { maxBytes: 50 })
    expect(out?.length).toBeLessThan(100)
    expect(out).toContain("[truncated")
  })

  test("leaves small bodies alone", () => {
    expect(redactBody("small", { maxBytes: 100 })).toBe("small")
  })
})

describe("exported constants", () => {
  test("default arrays are non-empty", () => {
    expect(DEFAULT_SENSITIVE_COOKIE_NAMES.length).toBeGreaterThan(5)
    expect(DEFAULT_ALLOWED_REQUEST_HEADERS).toContain("content-type")
    expect(DEFAULT_ALLOWED_RESPONSE_HEADERS).toContain("etag")
    expect(DEFAULT_REDACTED_QUERY_PARAMS).toContain("api_key")
  })
})
