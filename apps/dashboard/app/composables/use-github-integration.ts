import type { GithubConfigDTO } from "@reprojs/shared"
import type { Ref } from "vue"

export type GithubIntegrationState = {
  isLinked: boolean
  repoOwner: string | null
  repoName: string | null
}

export function useGithubIntegration(projectId: Ref<string> | string) {
  const pid = typeof projectId === "string" ? ref(projectId) : projectId
  const { data } = useFetch<GithubConfigDTO>(
    () => `/api/projects/${pid.value}/integrations/github`,
    {
      default: () => ({
        installed: false,
        status: null,
        repoOwner: "",
        repoName: "",
        defaultLabels: [],
        defaultAssignees: [],
        lastSyncedAt: null,
        failedJobs: [],
      }),
    },
  )
  const state = computed<GithubIntegrationState>(() => {
    const cfg = data.value
    if (!cfg || !cfg.installed || cfg.status !== "connected" || !cfg.repoOwner || !cfg.repoName) {
      return { isLinked: false, repoOwner: null, repoName: null }
    }
    return { isLinked: true, repoOwner: cfg.repoOwner, repoName: cfg.repoName }
  })
  return { state }
}
