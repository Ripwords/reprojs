import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { createCookiesCollector } from "./cookies"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window()
  Object.assign(globalThis, { window: win, document: win.document })
})

beforeEach(() => {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0]?.trim()
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`
  }
})

describe("cookies collector", () => {
  test("empty cookie string yields empty array", () => {
    const c = createCookiesCollector({})
    c.start({})
    expect(c.snapshot()).toEqual([])
  })

  test("parses name=value pairs", () => {
    document.cookie = "a=1"
    document.cookie = "b=2"
    const c = createCookiesCollector({})
    c.start({})
    const snap = c.snapshot()
    expect(snap).toContainEqual({ name: "a", value: "1" })
    expect(snap).toContainEqual({ name: "b", value: "2" })
  })

  test("applies default redaction to sensitive names", () => {
    document.cookie = "session=abc"
    document.cookie = "locale=en"
    const c = createCookiesCollector({})
    c.start({})
    const snap = c.snapshot()
    expect(snap.find((e) => e.name === "session")?.value).toBe("<redacted>")
    expect(snap.find((e) => e.name === "locale")?.value).toBe("en")
  })

  test("snapshot is pure — re-reading sees new cookies", () => {
    const c = createCookiesCollector({})
    c.start({})
    expect(c.snapshot()).toEqual([])
    document.cookie = "fresh=1"
    expect(c.snapshot()).toContainEqual({ name: "fresh", value: "1" })
  })
})
