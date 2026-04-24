// packages/integrations/github/src/issue-writes.ts
import type { Octokit } from "@octokit/rest"

export async function updateIssueTitle(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  title: string,
): Promise<void> {
  await client.rest.issues.update({ owner, repo, issue_number: issueNumber, title })
}

export async function updateIssueMilestone(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  milestoneNumber: number | null,
): Promise<void> {
  await client.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    milestone: milestoneNumber,
  })
}

export async function addAssignees(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  logins: string[],
): Promise<void> {
  if (logins.length === 0) return
  await client.rest.issues.addAssignees({
    owner,
    repo,
    issue_number: issueNumber,
    assignees: logins,
  })
}

export async function removeAssignees(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  logins: string[],
): Promise<void> {
  if (logins.length === 0) return
  await client.rest.issues.removeAssignees({
    owner,
    repo,
    issue_number: issueNumber,
    assignees: logins,
  })
}

export type IssueStateUpdate =
  | { state: "open"; stateReason: "reopened" | null }
  | { state: "closed"; stateReason: "completed" | "not_planned" }

export async function updateIssueState(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  update: IssueStateUpdate,
): Promise<void> {
  await client.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    state: update.state,
    state_reason: update.stateReason ?? undefined,
  })
}
