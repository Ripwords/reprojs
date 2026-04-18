// packages/integrations/github/src/client.ts
import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/rest"
import type {
  CloseIssueInput,
  CreateIssueInput,
  FindIssueByMarkerInput,
  GitHubInstallationClient,
  GitHubIssueRef,
  InstallationClientOptions,
  InstallationRepository,
  IssueStateInput,
  UpdateLabelsInput,
} from "./types"

export function createInstallationClient(
  opts: InstallationClientOptions,
): GitHubInstallationClient {
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: opts.appId,
      privateKey: opts.privateKey,
      installationId: opts.installationId,
    },
    request: {
      headers: { "X-GitHub-Api-Version": "2026-03-10" },
    },
  })

  return {
    async createIssue(input: CreateIssueInput): Promise<GitHubIssueRef> {
      const res = await octokit.issues.create({
        owner: input.owner,
        repo: input.repo,
        title: input.title,
        body: input.body,
        labels: input.labels ? [...input.labels] : undefined,
        assignees: input.assignees ? [...input.assignees] : undefined,
      })
      return {
        number: res.data.number,
        nodeId: res.data.node_id,
        url: res.data.html_url,
      }
    },

    async getIssue(input: IssueStateInput) {
      const res = await octokit.issues.get({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
      })
      return {
        state: res.data.state === "closed" ? "closed" : ("open" as const),
        labels: res.data.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
      }
    },

    async closeIssue(input: CloseIssueInput): Promise<void> {
      await octokit.issues.update({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
        state: "closed",
        ...(input.reason !== undefined ? { state_reason: input.reason } : {}),
      })
    },

    async reopenIssue(input: IssueStateInput): Promise<void> {
      await octokit.issues.update({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
        state: "open",
      })
    },

    async updateIssueLabels(input: UpdateLabelsInput): Promise<void> {
      await octokit.issues.setLabels({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
        labels: [...input.labels],
      })
    },

    async listInstallationRepositories(): Promise<InstallationRepository[]> {
      const repos = await octokit.paginate(octokit.apps.listReposAccessibleToInstallation, {
        per_page: 100,
      })
      return repos.map((r) => ({
        id: r.id,
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
      }))
    },

    async findIssueByMarker(input: FindIssueByMarkerInput): Promise<GitHubIssueRef | null> {
      // Use Search API — indexed across issue bodies. Trailing quoting guards
      // against markers with special characters being parsed as qualifiers.
      const q = `repo:${input.owner}/${input.repo} in:body "${input.marker}"`
      try {
        const res = await octokit.search.issuesAndPullRequests({
          q,
          per_page: 5,
          advanced_search: "true",
        })
        const hit = res.data.items.find((i) => !i.pull_request && i.body?.includes(input.marker))
        if (!hit) return null
        return { number: hit.number, nodeId: hit.node_id, url: hit.html_url }
      } catch {
        // Search index may be cold or the endpoint unavailable. Return null and
        // let the caller CREATE — worst case is a rare duplicate on retry.
        return null
      }
    },
  }
}
