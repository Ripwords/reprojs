import { describe, expect, test } from "bun:test"
import { labelsFor, parseGithubLabels } from "./github-helpers"

describe("parseGithubLabels", () => {
  test("extracts priority label", () => {
    const result = parseGithubLabels(["priority:high", "bug"], [])
    expect(result.priority).toBe("high")
    expect(result.tags).toEqual(["bug"])
  })

  test("returns null priority when no priority:* label present", () => {
    const result = parseGithubLabels(["bug", "needs-repro"], [])
    expect(result.priority).toBeNull()
    expect(result.tags).toEqual(["bug", "needs-repro"])
  })

  test("skips defaultLabels from tags", () => {
    const result = parseGithubLabels(["repro", "priority:low", "ui"], ["repro"])
    expect(result.priority).toBe("low")
    expect(result.tags).toEqual(["ui"])
  })

  test("empty label list returns null priority and empty tags", () => {
    const result = parseGithubLabels([], ["repro"])
    expect(result.priority).toBeNull()
    expect(result.tags).toEqual([])
  })

  test("defaultLabel that matches priority:* pattern is still skipped", () => {
    // Unusual but possible: admin adds priority:urgent as a default label.
    // It should be treated as a defaultLabel (skipped), not extracted as priority.
    const result = parseGithubLabels(["priority:urgent", "bug"], ["priority:urgent"])
    expect(result.priority).toBeNull()
    expect(result.tags).toEqual(["bug"])
  })

  test("last priority:* label wins when duplicates exist", () => {
    // In practice GitHub labels are unique, but guard anyway.
    const result = parseGithubLabels(["priority:low", "priority:high"], [])
    expect(result.priority).toBe("high")
  })
})

describe("labelsFor", () => {
  test("round-trip: parseGithubLabels reverses labelsFor", () => {
    const report = { priority: "high" as const, tags: ["bug", "ui"] }
    const integration = { defaultLabels: ["repro"] }
    const labels = labelsFor(report, integration)
    const parsed = parseGithubLabels(labels, integration.defaultLabels)
    expect(parsed.priority).toBe(report.priority)
    expect(parsed.tags.toSorted()).toEqual(report.tags.toSorted())
  })
})
