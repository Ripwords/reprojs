<script setup lang="ts">
import type { GithubConfigDTO } from "@feedback-tool/shared"
import RepoPicker from "./repo-picker.vue"
import SyncStatus from "./sync-status.vue"

interface Props {
  projectId: string
}
const props = defineProps<Props>()

const { data, refresh } = useApi<GithubConfigDTO>(
  `/api/projects/${props.projectId}/integrations/github`,
)

const repos = ref<Array<{ id: number; owner: string; name: string; fullName: string }>>([])
const selectedRepo = ref({ owner: "", name: "" })
const labelsText = ref("")
const assigneesText = ref("")
const saving = ref(false)

watch(
  data,
  (v) => {
    if (!v) return
    selectedRepo.value = { owner: v.repoOwner, name: v.repoName }
    labelsText.value = v.defaultLabels.join(", ")
    assigneesText.value = v.defaultAssignees.join(", ")
  },
  { immediate: true },
)

async function install() {
  const { url } = await $fetch<{ url: string }>(
    `/api/projects/${props.projectId}/integrations/github/install-redirect`,
    { method: "POST", credentials: "include" },
  )
  window.location.href = url
}

async function save() {
  saving.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/integrations/github`, {
      method: "PATCH",
      credentials: "include",
      body: {
        repoOwner: selectedRepo.value.owner,
        repoName: selectedRepo.value.name,
        defaultLabels: labelsText.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        defaultAssignees: assigneesText.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
    })
    await refresh()
  } finally {
    saving.value = false
  }
}

async function disconnect() {
  if (!confirm("Disconnect GitHub integration? Pending sync jobs will stop.")) return
  await $fetch(`/api/projects/${props.projectId}/integrations/github/disconnect`, {
    method: "POST",
    credentials: "include",
  })
  await refresh()
}
</script>

<template>
  <section class="space-y-4">
    <h2 class="text-xl font-semibold">GitHub integration</h2>

    <!-- Not installed -->
    <div v-if="!data?.installed" class="border rounded p-4 bg-white">
      <p class="text-sm text-neutral-600 mb-3">
        Auto-create GitHub issues for every new report and keep status synchronized.
      </p>
      <button type="button" class="border rounded px-3 py-1.5 text-sm" @click="install">
        🐙 Install on GitHub
      </button>
    </div>

    <!-- Connected -->
    <div v-else-if="data.status === 'connected'" class="border rounded p-4 bg-white space-y-3">
      <div class="flex items-center gap-2">
        <span class="inline-block w-2 h-2 rounded-full bg-green-500"></span>
        <span class="text-sm font-medium">connected</span>
      </div>
      <div v-if="data.repoOwner && data.repoName" class="text-sm">
        Repo: <strong>{{ data.repoOwner }}/{{ data.repoName }}</strong>
      </div>
      <div v-else class="text-sm text-orange-700">
        Pick a repo to start syncing:
        <RepoPicker v-model="selectedRepo" :repos="repos" class="mt-2" />
      </div>

      <label class="block text-sm">
        Default labels
        <input v-model="labelsText" class="border rounded px-2 py-1 w-full text-sm" />
      </label>

      <label class="block text-sm">
        Default assignees (GitHub usernames, comma-separated)
        <input v-model="assigneesText" class="border rounded px-2 py-1 w-full text-sm" />
      </label>

      <div class="flex gap-2">
        <button
          type="button"
          class="border rounded px-3 py-1.5 text-sm"
          :disabled="saving"
          @click="save"
        >
          {{ saving ? "Saving…" : "Save" }}
        </button>
        <button
          type="button"
          class="border rounded px-3 py-1.5 text-sm text-red-700"
          @click="disconnect"
        >
          Disconnect
        </button>
      </div>

      <SyncStatus :project-id="projectId" @retried="refresh()" />
    </div>

    <!-- Disconnected -->
    <div v-else class="border border-red-300 bg-red-50 rounded p-4 text-sm">
      ⚠ GitHub integration disconnected. The App was uninstalled or access was revoked.
      <button
        type="button"
        class="mt-3 border border-red-400 rounded px-3 py-1.5 bg-white"
        @click="install"
      >
        🐙 Reconnect
      </button>
    </div>
  </section>
</template>
