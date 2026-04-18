// packages/integrations/github/src/types.ts
export interface InstallationClientOptions {
  appId: string
  privateKey: string
  installationId: number
}

export interface GitHubIssueRef {
  number: number
  nodeId: string
  url: string
}

export interface CreateIssueInput {
  owner: string
  repo: string
  title: string
  body: string
  labels?: readonly string[]
  assignees?: readonly string[]
}

export interface IssueStateInput {
  owner: string
  repo: string
  number: number
}

export interface CloseIssueInput extends IssueStateInput {
  reason?: "completed" | "not_planned"
}

export interface UpdateLabelsInput extends IssueStateInput {
  labels: readonly string[]
}

export interface InstallationRepository {
  id: number
  owner: string
  name: string
  fullName: string
}

export interface GitHubInstallationClient {
  createIssue(input: CreateIssueInput): Promise<GitHubIssueRef>
  getIssue(input: IssueStateInput): Promise<{ state: "open" | "closed"; labels: string[] }>
  closeIssue(input: CloseIssueInput): Promise<void>
  reopenIssue(input: IssueStateInput): Promise<void>
  updateIssueLabels(input: UpdateLabelsInput): Promise<void>
  listInstallationRepositories(): Promise<InstallationRepository[]>
}
