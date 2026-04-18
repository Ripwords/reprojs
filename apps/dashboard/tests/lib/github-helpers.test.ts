// apps/dashboard/tests/lib/github-helpers.test.ts
import { describe, expect, test } from "bun:test"
import { buildIssueBody, computeBackoff, labelsFor } from "../../server/lib/github-helpers"

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

describe("buildIssueBody", () => {
  const minimal = {
    id: "rid1",
    title: "Checkout crash",
    description: "it crashed on pay",
    pageUrl: "https://app.example.com/checkout",
    reporterEmail: "reporter@example.com",
    createdAt: new Date("2026-04-18T10:42:00Z"),
    screenshotUrl:
      "https://dash.example.com/api/projects/p1/reports/rid1/attachment?kind=screenshot&token=abc&expires=1",
    dashboardUrl: "https://dash.example.com/projects/p1/reports/rid1",
  }

  test("full body contains reporter, page, description, screenshot, footer", () => {
    const body = buildIssueBody(minimal)
    expect(body).toContain("reporter@example.com")
    expect(body).toContain("https://app.example.com/checkout")
    expect(body).toContain("it crashed on pay")
    expect(body).toContain("![Screenshot]")
    expect(body).toContain(minimal.screenshotUrl)
    expect(body).toContain(minimal.dashboardUrl)
  })
  test("no reporter → 'anonymous'", () => {
    const body = buildIssueBody({ ...minimal, reporterEmail: null })
    expect(body).toContain("anonymous")
    expect(body).not.toContain("**anonymous**")
  })
  test("no screenshot → no img tag", () => {
    const body = buildIssueBody({ ...minimal, screenshotUrl: null })
    expect(body).not.toContain("![Screenshot]")
  })
  test("no pageUrl → page line omitted", () => {
    const body = buildIssueBody({ ...minimal, pageUrl: "" })
    expect(body).not.toContain("Page:")
  })
  test("description empty string renders empty description section header", () => {
    const body = buildIssueBody({ ...minimal, description: "" })
    expect(body).toContain("## Description")
  })
})
