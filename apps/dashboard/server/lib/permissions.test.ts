import { describe, expect, test } from "bun:test"
import { compareRole, type ProjectRoleName } from "./permissions"

describe("compareRole", () => {
  const roles: ProjectRoleName[] = ["viewer", "developer", "owner"]

  test("owner satisfies all minimums", () => {
    for (const min of roles) {
      expect(compareRole("owner", min)).toBe(true)
    }
  })

  test("developer satisfies developer and viewer, not owner", () => {
    expect(compareRole("developer", "viewer")).toBe(true)
    expect(compareRole("developer", "developer")).toBe(true)
    expect(compareRole("developer", "owner")).toBe(false)
  })

  test("viewer satisfies only viewer", () => {
    expect(compareRole("viewer", "viewer")).toBe(true)
    expect(compareRole("viewer", "developer")).toBe(false)
    expect(compareRole("viewer", "owner")).toBe(false)
  })
})
