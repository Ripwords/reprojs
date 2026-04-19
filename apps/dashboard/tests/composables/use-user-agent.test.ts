import { describe, expect, test } from "bun:test"
import { parseBrowser, parseOs } from "../../app/composables/use-user-agent"

describe("parseOs", () => {
  test("macOS with underscore version", () => {
    const r = parseOs(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    )
    expect(r.label).toBe("macOS 10.15.7")
    expect(r.icon).toBe("i-simple-icons-apple")
  })

  test("Windows NT 10.0 maps to 10/11", () => {
    const r = parseOs(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    )
    expect(r.label).toBe("Windows 10/11")
    expect(r.icon).toBe("i-simple-icons-windows")
  })

  test("Android with version", () => {
    const r = parseOs(
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    )
    expect(r.label).toBe("Android 14")
    expect(r.icon).toBe("i-simple-icons-android")
  })

  test("iOS from iPhone UA", () => {
    const r = parseOs(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    )
    expect(r.label).toBe("iOS 17.4.1")
    expect(r.icon).toBe("i-simple-icons-apple")
  })

  test("Linux fallback (no Android)", () => {
    const r = parseOs(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    )
    expect(r.label).toBe("Linux")
    expect(r.icon).toBe("i-simple-icons-linux")
  })

  test("empty UA falls back to platform", () => {
    expect(parseOs("", "MacIntel").label).toBe("MacIntel")
    expect(parseOs(undefined).label).toBe("Unknown")
  })
})

describe("parseBrowser", () => {
  test("Chrome on macOS", () => {
    const r = parseBrowser(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.129 Safari/537.36",
    )
    expect(r.label).toBe("Chrome 120.0.6099.129")
    expect(r.icon).toBe("i-simple-icons-googlechrome")
  })

  test("Safari on macOS (not Chrome even though Safari/ present)", () => {
    const r = parseBrowser(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    )
    expect(r.label).toBe("Safari 17.4")
    expect(r.icon).toBe("i-simple-icons-safari")
  })

  test("Firefox", () => {
    const r = parseBrowser(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:124.0) Gecko/20100101 Firefox/124.0",
    )
    expect(r.label).toBe("Firefox 124.0")
    expect(r.icon).toBe("i-simple-icons-firefoxbrowser")
  })

  test("Edge takes precedence over Chrome token", () => {
    const r = parseBrowser(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91",
    )
    expect(r.label).toBe("Edge 120.0.2210.91")
    expect(r.icon).toBe("i-simple-icons-microsoftedge")
  })

  test("Opera takes precedence over Chrome token", () => {
    const r = parseBrowser(
      "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0",
    )
    expect(r.label).toBe("Opera 106.0.0.0")
    expect(r.icon).toBe("i-simple-icons-opera")
  })

  test("empty UA", () => {
    expect(parseBrowser("").label).toBe("Unknown")
    expect(parseBrowser(undefined).label).toBe("Unknown")
  })
})
