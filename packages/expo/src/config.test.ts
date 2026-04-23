import { test, expect } from "bun:test"
import { normalizeConfig } from "./config"

test("normalizeConfig fills sensible defaults", () => {
  const cfg = normalizeConfig({
    projectKey: "rp_pk_" + "a".repeat(24),
    intakeUrl: "https://example.com/api/intake",
  })
  expect(cfg.collectors.console).toBe(true)
  expect(cfg.collectors.network.enabled).toBe(true)
  expect(cfg.queue.maxReports).toBe(5)
  expect(cfg.queue.maxBytes).toBe(10 * 1024 * 1024)
  expect(cfg.queue.backoffMs).toEqual([1000, 5000, 30000, 120000])
  expect(cfg.redact.headerDenylist).toContain("authorization")
})

test("normalizeConfig rejects malformed projectKey at runtime", () => {
  expect(() =>
    normalizeConfig({ projectKey: "nope", intakeUrl: "https://example.com/api/intake" }),
  ).toThrow(/projectKey/)
})

test("normalizeConfig respects overrides", () => {
  const cfg = normalizeConfig({
    projectKey: "rp_pk_" + "a".repeat(24),
    intakeUrl: "https://example.com/api/intake",
    queue: { maxReports: 3 },
    collectors: { network: { enabled: false } },
  })
  expect(cfg.queue.maxReports).toBe(3)
  expect(cfg.queue.maxBytes).toBe(10 * 1024 * 1024)
  expect(cfg.collectors.network.enabled).toBe(false)
})
