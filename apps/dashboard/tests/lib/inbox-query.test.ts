import { describe, expect, test } from "bun:test"
import { diffTags, resolveAssigneeFilter } from "../../server/lib/inbox-query"

describe("diffTags", () => {
  test("returns added-only when tags are appended", () => {
    expect(diffTags(["a", "b"], ["a", "b", "c"])).toEqual({ added: ["c"], removed: [] })
  })
  test("returns removed-only when tags are dropped", () => {
    expect(diffTags(["a", "b"], ["a"])).toEqual({ added: [], removed: ["b"] })
  })
  test("returns both when tags are swapped", () => {
    expect(diffTags(["a", "b"], ["a", "c"])).toEqual({ added: ["c"], removed: ["b"] })
  })
  test("ignores order-only changes", () => {
    expect(diffTags(["a", "b"], ["b", "a"])).toEqual({ added: [], removed: [] })
  })
  test("deduplicates so the same tag added twice is one entry", () => {
    expect(diffTags([], ["a", "a", "b"])).toEqual({ added: ["a", "b"], removed: [] })
  })
  test("empty → empty returns nothing", () => {
    expect(diffTags([], [])).toEqual({ added: [], removed: [] })
  })
})

describe("resolveAssigneeFilter", () => {
  test("'me' returns { type: 'user', userId: session }", () => {
    expect(resolveAssigneeFilter(["me"], "user-1")).toEqual([{ type: "user", userId: "user-1" }])
  })
  test("'unassigned' returns { type: 'null' }", () => {
    expect(resolveAssigneeFilter(["unassigned"], "user-1")).toEqual([{ type: "null" }])
  })
  test("plain user ids pass through", () => {
    expect(resolveAssigneeFilter(["user-2", "user-3"], "user-1")).toEqual([
      { type: "user", userId: "user-2" },
      { type: "user", userId: "user-3" },
    ])
  })
  test("mixed tokens preserve order", () => {
    expect(resolveAssigneeFilter(["me", "unassigned", "user-2"], "user-1")).toEqual([
      { type: "user", userId: "user-1" },
      { type: "null" },
      { type: "user", userId: "user-2" },
    ])
  })
  test("empty array returns empty", () => {
    expect(resolveAssigneeFilter([], "user-1")).toEqual([])
  })
  test("dedupes identical tokens", () => {
    expect(resolveAssigneeFilter(["me", "me"], "user-1")).toEqual([
      { type: "user", userId: "user-1" },
    ])
  })
})
