import { describe, test, expect } from "bun:test"
import { listRepoLabels, listAssignableUsers, listMilestones } from "./repo-read"

function fakeClient(pages: Array<{ data: unknown[] }>) {
  return {
    paginate: {
      iterator: () => ({
        async *[Symbol.asyncIterator]() {
          for (const p of pages) yield p
        },
      }),
    },
    rest: {
      issues: {
        listLabelsForRepo: () => {},
        listAssignees: () => {},
        listMilestones: () => {},
      },
    },
  } as never
}

describe("listRepoLabels", () => {
  test("flattens paginated labels", async () => {
    const client = fakeClient([
      { data: [{ name: "bug", color: "f00", description: "a bug" }] },
      { data: [{ name: "feat", color: "0f0", description: null }] },
    ])
    const res = await listRepoLabels(client, "o", "r")
    expect(res).toEqual([
      { name: "bug", color: "f00", description: "a bug" },
      { name: "feat", color: "0f0", description: null },
    ])
  })
})

describe("listAssignableUsers", () => {
  test("maps to AssignableUser shape", async () => {
    const client = fakeClient([
      { data: [{ id: 42, login: "octocat", avatar_url: "https://a.png" }] },
    ])
    const res = await listAssignableUsers(client, "o", "r")
    expect(res).toEqual([{ githubUserId: "42", login: "octocat", avatarUrl: "https://a.png" }])
  })
})

describe("listMilestones", () => {
  test("maps to RepoMilestone shape with null dueOn", async () => {
    const client = fakeClient([{ data: [{ number: 1, title: "M1", state: "open", due_on: null }] }])
    const res = await listMilestones(client, "o", "r", "open")
    expect(res).toEqual([{ number: 1, title: "M1", state: "open", dueOn: null }])
  })
})
