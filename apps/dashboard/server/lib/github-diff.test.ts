// apps/dashboard/server/lib/github-diff.test.ts
import { describe, expect, test } from "bun:test"
import {
  diffAssignees,
  signAssignees,
  signCommentDelete,
  signCommentUpsert,
  signLabels,
  signMilestone,
  signState,
  signTitle,
} from "./github-diff"

describe("signLabels", () => {
  test("same labels in different order produce same signature", () => {
    const a = signLabels(["bug", "priority:high", "feature"])
    const b = signLabels(["priority:high", "feature", "bug"])
    expect(a).toBe(b)
  })

  test("different labels produce different signatures", () => {
    const a = signLabels(["bug"])
    const b = signLabels(["feature"])
    expect(a).not.toBe(b)
  })

  test("empty label set has stable signature", () => {
    expect(signLabels([])).toBe(signLabels([]))
  })
})

describe("signAssignees", () => {
  test("same logins in different order produce same signature", () => {
    const a = signAssignees(["alice", "bob"])
    const b = signAssignees(["bob", "alice"])
    expect(a).toBe(b)
  })

  test("different logins produce different signatures", () => {
    expect(signAssignees(["alice"])).not.toBe(signAssignees(["bob"]))
  })

  test("empty assignees has stable signature", () => {
    expect(signAssignees([])).toBe(signAssignees([]))
  })
})

describe("signMilestone", () => {
  test("null milestone is distinct from any numbered milestone", () => {
    expect(signMilestone(null)).not.toBe(signMilestone(0))
    expect(signMilestone(null)).not.toBe(signMilestone(1))
  })

  test("same number produces same signature", () => {
    expect(signMilestone(7)).toBe(signMilestone(7))
  })

  test("different numbers produce different signatures", () => {
    expect(signMilestone(1)).not.toBe(signMilestone(2))
  })
})

describe("signState", () => {
  test("different close reasons produce different signatures", () => {
    const completed = signState("closed", "completed")
    const notPlanned = signState("closed", "not_planned")
    expect(completed).not.toBe(notPlanned)
  })

  test("open vs closed produce different signatures", () => {
    expect(signState("open", null)).not.toBe(signState("closed", "completed"))
  })

  test("open with reopened reason is distinct from open with null", () => {
    expect(signState("open", "reopened")).not.toBe(signState("open", null))
  })
})

describe("signTitle", () => {
  test("same title produces same signature", () => {
    expect(signTitle("My Bug")).toBe(signTitle("My Bug"))
  })

  test("different titles produce different signatures", () => {
    expect(signTitle("Bug A")).not.toBe(signTitle("Bug B"))
  })
})

describe("signCommentUpsert", () => {
  test("is stable for same inputs", () => {
    expect(signCommentUpsert(100, "hello")).toBe(signCommentUpsert(100, "hello"))
  })

  test("differs across different comment ids", () => {
    expect(signCommentUpsert(100, "hello")).not.toBe(signCommentUpsert(200, "hello"))
  })

  test("differs across different bodies", () => {
    expect(signCommentUpsert(100, "hello")).not.toBe(signCommentUpsert(100, "world"))
  })
})

describe("signCommentDelete", () => {
  test("is stable for same id", () => {
    expect(signCommentDelete(100)).toBe(signCommentDelete(100))
  })

  test("differs across different ids", () => {
    expect(signCommentDelete(100)).not.toBe(signCommentDelete(200))
  })

  test("differs from signCommentUpsert", () => {
    // The two signature functions should not collide even with same id
    expect(signCommentDelete(100)).not.toBe(signCommentUpsert(100, ""))
  })
})

describe("diffAssignees", () => {
  test("adds logins not in current", () => {
    const { toAdd, toRemove } = diffAssignees(["alice"], ["alice", "bob"])
    expect(toAdd).toEqual(["bob"])
    expect(toRemove).toEqual([])
  })

  test("removes logins not in desired", () => {
    const { toAdd, toRemove } = diffAssignees(["alice", "bob"], ["alice"])
    expect(toAdd).toEqual([])
    expect(toRemove).toEqual(["bob"])
  })

  test("no change when sets are equal", () => {
    const { toAdd, toRemove } = diffAssignees(["alice"], ["alice"])
    expect(toAdd).toEqual([])
    expect(toRemove).toEqual([])
  })

  test("handles complete replacement", () => {
    const { toAdd, toRemove } = diffAssignees(["alice"], ["bob"])
    expect(toAdd).toEqual(["bob"])
    expect(toRemove).toEqual(["alice"])
  })
})
