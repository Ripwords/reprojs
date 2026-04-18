// packages/integrations/github/src/client.ts
import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/rest"
import type {
  CloseIssueInput,
  CreateIssueInput,
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
      const res = await octokit.apps.listReposAccessibleToInstallation({ per_page: 100 })
      return res.data.repositories.map((r) => ({
        id: r.id,
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
      }))
    },
  }
}
