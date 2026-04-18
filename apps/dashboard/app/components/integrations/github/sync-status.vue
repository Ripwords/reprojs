<script setup lang="ts">
import type { GithubConfigDTO } from "@feedback-tool/shared"

interface Props {
  projectId: string
}
const props = defineProps<Props>()
const emit = defineEmits<{ retried: [] }>()

const { data, refresh } = useApi<GithubConfigDTO>(
  `/api/projects/${props.projectId}/integrations/github`,
)

async function retryAll() {
  await $fetch(`/api/projects/${props.projectId}/integrations/github/retry-failed`, {
    method: "POST",
    credentials: "include",
  })
  await refresh()
  emit("retried")
}

async function retryOne(reportId: string) {
  await $fetch(`/api/projects/${props.projectId}/reports/${reportId}/github-sync`, {
    method: "POST",
    credentials: "include",
  })
  await refresh()
  emit("retried")
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
</script>

<template>
  <div class="border-t pt-3 space-y-2">
    <div class="flex items-baseline justify-between">
      <h3 class="text-sm font-medium">Sync status</h3>
      <button
        v-if="(data?.failedJobs.length ?? 0) > 0"
        type="button"
        class="text-xs border rounded px-2 py-0.5"
        @click="retryAll"
      >
        Retry all
      </button>
    </div>
    <div v-if="data?.lastSyncedAt" class="text-xs text-neutral-500">
      Last synced: {{ relTime(data.lastSyncedAt) }}
    </div>
    <div v-if="!data?.failedJobs.length" class="text-xs text-neutral-400">No failed jobs.</div>
    <ul v-else class="text-xs space-y-1">
      <li
        v-for="j in data.failedJobs"
        :key="j.reportId"
        class="flex items-start gap-2 bg-red-50 rounded p-2"
      >
        <div class="flex-1">
          <div class="font-medium">{{ j.reportTitle }}</div>
          <div class="text-neutral-600">{{ j.lastError ?? "Unknown error" }}</div>
          <div class="text-neutral-400">{{ j.attempts }} attempts · {{ relTime(j.updatedAt) }}</div>
        </div>
        <button
          type="button"
          class="border border-red-300 rounded px-2 py-0.5 self-center"
          @click="retryOne(j.reportId)"
        >
          Retry
        </button>
      </li>
    </ul>
  </div>
</template>
