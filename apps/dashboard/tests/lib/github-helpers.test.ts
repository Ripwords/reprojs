// apps/dashboard/tests/lib/github-helpers.test.ts
import { describe, expect, test } from "bun:test"
import { computeBackoff, labelsFor } from "../../server/lib/github-helpers"

describe("computeBackoff", () => {
  test("attempt 1 → 10 seconds", () => {
    expect(computeBackoff(1)).toBe(10_000)
  })
  test("attempt 2 → 30 seconds", () => {
    expect(computeBackoff(2)).toBe(30_000)
  })
  test("attempt 3 → 2 minutes", () => {
    expect(computeBackoff(3)).toBe(120_000)
  })
  test("attempt 4 → 10 minutes", () => {
    expect(computeBackoff(4)).toBe(600_000)
  })
  test("attempt 5 → 1 hour", () => {
    expect(computeBackoff(5)).toBe(3_600_000)
  })
  test("attempts > 5 cap at 1 hour", () => {
    expect(computeBackoff(99)).toBe(3_600_000)
  })
  test("attempts < 1 treated as 1", () => {
    expect(computeBackoff(0)).toBe(10_000)
  })
})

describe("labelsFor", () => {
  test("combines defaults + priority prefix + tags verbatim, sorted", () => {
    const result = labelsFor(
      { priority: "urgent", tags: ["mobile", "checkout"] },
      { defaultLabels: ["feedback", "needs-triage"] },
    )
    expect(result).toEqual(["checkout", "feedback", "mobile", "needs-triage", "priority:urgent"])
  })
  test("dedupes when a tag clashes with a default label", () => {
    expect(
      labelsFor({ priority: "normal", tags: ["feedback"] }, { defaultLabels: ["feedback"] }),
    ).toEqual(["feedback", "priority:normal"])
  })
  test("empty tags + empty defaults still includes priority", () => {
    expect(labelsFor({ priority: "low", tags: [] }, { defaultLabels: [] })).toEqual([
      "priority:low",
    ])
  })
})
