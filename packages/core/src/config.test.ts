import { describe, expect, test } from "bun:test"
import { resolveConfig } from "./config"

describe("resolveConfig", () => {
  test("accepts a valid minimal config", () => {
    const c = resolveConfig({
      projectKey: "rp_pk_ABCDEF1234567890abcdef12",
      endpoint: "https://dash.example.com",
    })
    expect(c.projectKey).toBe("rp_pk_ABCDEF1234567890abcdef12")
    expect(c.endpoint).toBe("https://dash.example.com")
    expect(c.position).toBe("bottom-right")
    expect(c.launcher).toBe(true)
  })

  test("strips trailing slash from endpoint", () => {
    const c = resolveConfig({
      projectKey: "rp_pk_ABCDEF1234567890abcdef12",
      endpoint: "https://dash.example.com/",
    })
    expect(c.endpoint).toBe("https://dash.example.com")
  })

  test("throws on missing projectKey", () => {
    // @ts-expect-error — deliberately invalid
    expect(() => resolveConfig({ endpoint: "https://x" })).toThrow(/projectKey/)
  })

  test("throws on malformed endpoint", () => {
    expect(() =>
      resolveConfig({ projectKey: "rp_pk_ABCDEF1234567890abcdef12", endpoint: "not a url" }),
    ).toThrow(/endpoint/)
  })

  test("throws on malformed projectKey", () => {
    expect(() => resolveConfig({ projectKey: "bad", endpoint: "https://x" })).toThrow(/projectKey/)
  })
})
