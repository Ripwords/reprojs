<script setup lang="ts">
import type { GithubConfigDTO } from "@reprojs/shared"
import RepoPicker from "./repo-picker.vue"
import SyncStatus from "./sync-status.vue"
import UnlinkDialog from "./unlink-dialog.vue"

interface Props {
  projectId: string
}
const props = defineProps<Props>()

const toast = useToast()

const { data, refresh } = useApi<GithubConfigDTO>(
  `/api/projects/${props.projectId}/integrations/github`,
)

const selectedRepo = ref({ owner: "", name: "" })
const labelsText = ref("")
const assigneesText = ref("")
const saving = ref(false)
const installing = ref(false)
const unlinkOpen = ref(false)

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

const isInstalled = computed(() => Boolean(data.value?.installed))
const isConnected = computed(() => data.value?.status === "connected")

const statusLabel = computed(() => {
  if (!data.value?.installed) return "not connected"
  if (data.value.status === "connected") return "connected"
  return "disconnected"
})

const statusColor = computed<"neutral" | "success" | "warning">(() => {
  if (!data.value?.installed) return "neutral"
  if (data.value.status === "connected") return "success"
  return "warning"
})

const ctaLabel = computed(() =>
  data.value?.installed && data.value.status === "disconnected"
    ? "Reconnect on GitHub"
    : "Install on GitHub",
)

async function startInstall() {
  installing.value = true
  try {
    const { url } = await $fetch<{ url: string }>(
      `/api/projects/${props.projectId}/integrations/github/install-redirect`,
      { method: "POST", credentials: "include" },
    )
    window.location.href = url
  } catch (err) {
    installing.value = false
    toast.add({
      title: "Could not start install flow",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

async function saveRepo() {
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
    toast.add({
      title: "Saved",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
  } catch (err) {
    toast.add({
      title: "Could not save",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UCard :ui="{ header: 'p-5', body: 'p-5' }">
    <template #header>
      <div class="flex items-center gap-3">
        <div
          class="flex items-center justify-center size-10 rounded-lg bg-elevated text-default ring-1 ring-default shrink-0"
        >
          <UIcon name="i-simple-icons-github" class="size-5" />
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="text-base font-semibold text-default tracking-tight">GitHub Issues</h2>
          <p class="text-sm text-muted mt-0.5">
            Auto-create issues for every report, sync status both ways.
          </p>
        </div>
        <UBadge
          :label="statusLabel"
          :color="statusColor"
          variant="soft"
          size="md"
          class="capitalize"
        />
      </div>
    </template>

    <!-- Not installed yet -->
    <div v-if="!isInstalled" class="space-y-4">
      <p class="text-sm text-muted leading-relaxed">
        Install the GitHub App on a repository to start syncing reports as issues.
      </p>
      <UButton
        :label="ctaLabel"
        :loading="installing"
        icon="i-simple-icons-github"
        color="neutral"
        variant="solid"
        size="md"
        @click="startInstall"
      />
    </div>

    <!-- Installed but disconnected (App uninstalled / access revoked) -->
    <div v-else-if="!isConnected" class="space-y-4">
      <UAlert
        color="warning"
        variant="soft"
        icon="i-heroicons-exclamation-triangle"
        title="Integration disconnected"
        description="The GitHub App was uninstalled or access was revoked. Reconnect to resume syncing."
      />
      <UButton
        :label="ctaLabel"
        :loading="installing"
        icon="i-simple-icons-github"
        color="neutral"
        variant="solid"
        size="md"
        @click="startInstall"
      />
    </div>

    <!-- Installed + connected -->
    <div v-else class="space-y-5">
      <div>
        <div class="text-xs font-semibold uppercase tracking-[0.14em] text-muted mb-2">
          Repository
        </div>
        <RepoPicker v-model="selectedRepo" :project-id="projectId" @update:model-value="saveRepo" />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <UFormField label="Default labels">
          <UInput v-model="labelsText" placeholder="bug, triage" class="w-full" />
        </UFormField>
        <UFormField label="Default assignees">
          <UInput v-model="assigneesText" placeholder="octocat, hubot" class="w-full" />
        </UFormField>
      </div>

      <div class="flex gap-2">
        <UButton
          label="Save defaults"
          color="primary"
          variant="solid"
          size="md"
          :loading="saving"
          @click="saveRepo"
        />
      </div>

      <div>
        <div class="text-xs font-semibold uppercase tracking-[0.14em] text-muted mb-2">
          Sync status
        </div>
        <SyncStatus :project-id="projectId" @retried="refresh" />
      </div>

      <div class="pt-3 border-t border-default">
        <UButton
          label="Disconnect integration"
          color="error"
          variant="soft"
          size="md"
          @click="unlinkOpen = true"
        />
      </div>
    </div>

    <UnlinkDialog
      v-model:open="unlinkOpen"
      mode="disconnect-integration"
      :project-id="projectId"
      @confirmed="refresh"
    />
  </UCard>
</template>
