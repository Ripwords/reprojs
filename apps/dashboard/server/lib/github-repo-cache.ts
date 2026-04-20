// apps/dashboard/server/lib/github-repo-cache.ts
import type { InstallationRepository } from "@reprojs/integrations-github"

interface CachedEntry {
  repos: InstallationRepository[]
  expiresAt: number
  inflight: Promise<InstallationRepository[]> | null
}

// GitHub's installation-repos endpoint has no search param, so we fetch all
// repos once per installation and filter/paginate against the cached list.
// TTL is deliberately modest — the webhook handler explicitly invalidates on
// installation_repositories (added|removed) and installation (deleted|suspend),
// so the TTL only covers drift from out-of-band admin changes on GitHub.
const TTL_MS = 5 * 60 * 1000

const cache = new Map<number, CachedEntry>()

type Fetcher = () => Promise<InstallationRepository[]>

export async function getInstallationRepos(
  installationId: number,
  fetcher: Fetcher,
): Promise<InstallationRepository[]> {
  const now = Date.now()
  const entry = cache.get(installationId)
  if (entry && entry.expiresAt > now) return entry.repos
  // Dedupe concurrent cold-cache requests so 900-repo fetches don't fan out.
  if (entry?.inflight) return entry.inflight

  const inflight = fetcher()
    .then((repos) => {
      cache.set(installationId, {
        repos,
        expiresAt: Date.now() + TTL_MS,
        inflight: null,
      })
      return repos
    })
    .catch((err: unknown) => {
      cache.delete(installationId)
      throw err
    })

  cache.set(installationId, {
    repos: entry?.repos ?? [],
    expiresAt: 0,
    inflight,
  })
  return inflight
}

export function invalidateInstallationRepos(installationId: number): void {
  cache.delete(installationId)
}

// Test-only helper.
export function __clearAllInstallationRepos(): void {
  cache.clear()
}
