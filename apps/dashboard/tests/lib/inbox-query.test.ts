import { describe, expect, test } from "bun:test"
import { diffTags } from "../../server/lib/inbox-query"

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
