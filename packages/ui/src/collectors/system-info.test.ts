import { beforeAll, describe, expect, test } from "bun:test"
import { snapshotSystemInfo } from "./system-info"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window({ url: "http://localhost:4000/app?x=1" })
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
    navigator: win.navigator,
    screen: win.screen,
    Intl: globalThis.Intl,
  })
})

describe("snapshotSystemInfo", () => {
  test("returns a well-shaped object", () => {
    const s = snapshotSystemInfo()
    expect(typeof s.userAgent).toBe("string")
    expect(typeof s.platform).toBe("string")
    expect(typeof s.language).toBe("string")
    expect(typeof s.timezone).toBe("string")
    expect(typeof s.timezoneOffset).toBe("number")
    expect(s.viewport.w).toBeGreaterThan(0)
    expect(s.viewport.h).toBeGreaterThan(0)
    expect(s.dpr).toBeGreaterThan(0)
    expect(typeof s.online).toBe("boolean")
    expect(s.pageUrl).toBe("http://localhost:4000/app?x=1")
    expect(s.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test("connection is omitted when navigator.connection is undefined", () => {
    const s = snapshotSystemInfo()
    expect(s.connection).toBeUndefined()
  })
})
