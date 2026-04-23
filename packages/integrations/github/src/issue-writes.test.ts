// packages/integrations/github/src/issue-writes.test.ts
import { describe, expect, test } from "bun:test"
import type { Octokit } from "@octokit/rest"
import {
  addAssignees,
  removeAssignees,
  updateIssueMilestone,
  updateIssueState,
  updateIssueTitle,
} from "./issue-writes"

/** Build a minimal fake Octokit that records calls */
function makeFakeOctokit() {
  const calls: {
    update: Array<Record<string, unknown>>
    addAssignees: Array<Record<string, unknown>>
    removeAssignees: Array<Record<string, unknown>>
  } = { update: [], addAssignees: [], removeAssignees: [] }

  const octokit = {
    rest: {
      issues: {
        update: async (args: Record<string, unknown>) => {
          calls.update.push(args)
          return { data: {} }
        },
        addAssignees: async (args: Record<string, unknown>) => {
          calls.addAssignees.push(args)
          return { data: {} }
        },
        removeAssignees: async (args: Record<string, unknown>) => {
          calls.removeAssignees.push(args)
          return { data: {} }
        },
      },
    },
  } as unknown as Octokit

  return { octokit, calls }
}

describe("updateIssueTitle", () => {
  test("calls update with owner, repo, issue_number, title", async () => {
    const { octokit, calls } = makeFakeOctokit()
    await updateIssueTitle(octokit, "acme", "frontend", 42, "New title")
    expect(calls.update.length).toBe(1)
    expect(calls.update[0]).toMatchObject({
      owner: "acme",
      repo: "frontend",
      issue_number: 42,
      title: "New title",
    })
  })
})

describe("updateIssueMilestone", () => {
  test("calls update with milestone number", async () => {
    const { octokit, calls } = makeFakeOctokit()
    await updateIssueMilestone(octokit, "acme", "frontend", 42, 7)
    expect(calls.update.length).toBe(1)
    expect(calls.update[0]).toMatchObject({
      owner: "acme",
      repo: "frontend",
      issue_number: 42,
      milestone: 7,
    })
  })

  test("calls update with null to clear milestone", async () => {
    const { octokit, calls } = makeFakeOctokit()
    await updateIssueMilestone(octokit, "acme", "frontend", 42, null)
    expect(calls.update.length).toBe(1)
    expect(calls.update[0]).toMatchObject({
      owner: "acme",
      repo: "frontend",
      issue_number: 42,
      milestone: null,
    })
  })
})

describe("addAssignees", () => {
  test("calls addAssignees with provided logins", async () => {
    const { octokit, calls } = makeFakeOctokit()
    await addAssignees(octokit, "acme", "frontend", 42, ["alice", "bob"])
    expect(calls.addAssignees.length).toBe(1)
    expect(calls.addAssignees[0]).toMatchObject({
      owner: "acme",
      repo: "frontend",
      issue_number: 42,
      assignees: ["alice", "bob"],
    })
  })

  test("no-op on empty logins", async () => {
    const { octokit, calls } = makeFakeOctokit()
    await addAssignees(octokit, "acme", "frontend", 42, [])
    expect(calls.addAssignees.length).toBe(0)
  })
})

describe("removeAssignees", () => {
  test("calls removeAssignees with provided logins", async () => {
    const { octokit, calls } = makeFakeOctokit()
    await removeAssignees(octokit, "acme", "frontend", 42, ["carol"])
    expect(calls.removeAssignees.length).toBe(1)
    expect(calls.removeAssignees[0]).toMatchObject({
      owner: "acme",
      repo: "frontend",
      issue_number: 42,
      assignees: ["carol"],
    })
  })

  test("no-op on empty logins", async () => {
    const { octokit, calls } = makeFakeOctokit()
    await removeAssignees(octokit, "acme", "frontend", 42, [])
    expect(calls.removeAssignees.length).toBe(0)
  })
})

describe("updateIssueState", () => {
  test("closed with state_reason passed through", async () => {
    const { octokit, calls } = makeFakeOctokit()
    await updateIssueState(octokit, "acme", "frontend", 42, {
      state: "closed",
      stateReason: "not_planned",
    })
    expect(calls.update.length).toBe(1)
    expect(calls.update[0]).toMatchObject({
      owner: "acme",
      repo: "frontend",
      issue_number: 42,
      state: "closed",
      state_reason: "not_planned",
    })
  })

  test("open with reopened reason", async () => {
    const { octokit, calls } = makeFakeOctokit()
    await updateIssueState(octokit, "acme", "frontend", 42, {
      state: "open",
      stateReason: "reopened",
    })
    expect(calls.update.length).toBe(1)
    expect(calls.update[0]).toMatchObject({
      owner: "acme",
      repo: "frontend",
      issue_number: 42,
      state: "open",
      state_reason: "reopened",
    })
  })

  test("open with null stateReason omits state_reason from call", async () => {
    const { octokit, calls } = makeFakeOctokit()
    await updateIssueState(octokit, "acme", "frontend", 42, {
      state: "open",
      stateReason: null,
    })
    expect(calls.update.length).toBe(1)
    expect(calls.update[0]?.state).toBe("open")
    expect(calls.update[0]?.state_reason).toBeUndefined()
  })
})
