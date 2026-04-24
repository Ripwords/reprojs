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

// GitHub's `POST /repos/:owner/:repo/issues/:n/assignees` silently drops any
// login that isn't assignable to the repo (non-collaborator, missing access,
// suspended user, etc.) — it still returns 201 with the updated issue, but
// the `assignees` array on the response body won't include the rejected
// login. Surfacing that as a return value lets callers detect the drop and
// warn / retry / alert instead of silently accepting a failed assignment.
// Same behaviour for `DELETE /.../assignees` (removes only what it can).
export async function addAssignees(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  logins: string[],
): Promise<{ currentAssigneeLogins: string[] }> {
  if (logins.length === 0) return { currentAssigneeLogins: [] }
  const res = await client.rest.issues.addAssignees({
    owner,
    repo,
    issue_number: issueNumber,
    assignees: logins,
  })
  return {
    currentAssigneeLogins: (res.data.assignees ?? []).map((a) => a.login),
  }
}

export async function removeAssignees(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  logins: string[],
): Promise<{ currentAssigneeLogins: string[] }> {
  if (logins.length === 0) return { currentAssigneeLogins: [] }
  const res = await client.rest.issues.removeAssignees({
    owner,
    repo,
    issue_number: issueNumber,
    assignees: logins,
  })
  return {
    currentAssigneeLogins: (res.data.assignees ?? []).map((a) => a.login),
  }
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
