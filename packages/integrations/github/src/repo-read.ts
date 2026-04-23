// packages/integrations/github/src/repo-read.ts
import type { Octokit } from "@octokit/rest"

export type RepoLabel = { name: string; color: string; description: string | null }
export type AssignableUser = { githubUserId: string; login: string; avatarUrl: string | null }
export type RepoMilestone = {
  number: number
  title: string
  state: "open" | "closed"
  dueOn: string | null
}

export async function listRepoLabels(
  client: Octokit,
  owner: string,
  repo: string,
): Promise<RepoLabel[]> {
  const items: RepoLabel[] = []
  const iterator = client.paginate.iterator(client.rest.issues.listLabelsForRepo, {
    owner,
    repo,
    per_page: 100,
  })
  for await (const { data } of iterator) {
    for (const l of data)
      items.push({ name: l.name, color: l.color, description: l.description ?? null })
  }
  return items
}

export async function listAssignableUsers(
  client: Octokit,
  owner: string,
  repo: string,
): Promise<AssignableUser[]> {
  const items: AssignableUser[] = []
  const iterator = client.paginate.iterator(client.rest.issues.listAssignees, {
    owner,
    repo,
    per_page: 100,
  })
  for await (const { data } of iterator) {
    for (const u of data)
      items.push({ githubUserId: String(u.id), login: u.login, avatarUrl: u.avatar_url ?? null })
  }
  return items
}

export async function listMilestones(
  client: Octokit,
  owner: string,
  repo: string,
  state: "open" | "all" = "open",
): Promise<RepoMilestone[]> {
  const items: RepoMilestone[] = []
  const iterator = client.paginate.iterator(client.rest.issues.listMilestones, {
    owner,
    repo,
    state,
    per_page: 100,
  })
  for await (const { data } of iterator) {
    for (const m of data)
      items.push({
        number: m.number,
        title: m.title,
        state: m.state as "open" | "closed",
        dueOn: m.due_on ?? null,
      })
  }
  return items
}
