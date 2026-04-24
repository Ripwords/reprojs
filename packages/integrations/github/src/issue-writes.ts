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

// Pre-flight check against `GET /repos/:owner/:repo/assignees/:username`.
// Returns true if GitHub considers the login assignable on this repo, false
// otherwise. GitHub's endpoint returns 204 for assignable and 404 for not —
// anything else (rate limit, auth failure, network blip) also resolves to
// false so we treat "can't verify" as "don't push" rather than pushing and
// hitting a silent drop.
export async function checkUserCanBeAssigned(
  client: Octokit,
  owner: string,
  repo: string,
  username: string,
): Promise<boolean> {
  try {
    await client.rest.issues.checkUserCanBeAssigned({ owner, repo, assignee: username })
    return true
  } catch (err: unknown) {
    // Octokit throws with a `status` field on the RequestError. 404 is the
    // canonical "not assignable" signal from GitHub; any other status means
    // we couldn't verify, which we still treat as a negative result above.
    const status = (err as { status?: number } | null)?.status
    if (status === 404) return false
    // Re-throw unexpected errors so the caller sees them (rate limits,
    // auth failures, 5xx) instead of silently treating them as "not
    // assignable" and skipping the write forever.
    throw err
  }
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
