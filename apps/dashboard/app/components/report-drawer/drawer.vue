<!-- apps/dashboard/app/components/report-drawer/drawer.vue -->
<script setup lang="ts">
import type { LogsAttachment, ReportSummaryDTO } from "@feedback-tool/shared"
import ActivityTab from "./activity-tab.vue"
import ConsoleTab from "./console-tab.vue"
import CookiesTab from "./cookies-tab.vue"
import NetworkTab from "./network-tab.vue"
import OverviewTab from "./overview-tab.vue"
import Tabs from "./tabs.vue"
import TriagePanel from "./triage-panel.vue"

const props = defineProps<{ projectId: string; report: ReportSummaryDTO }>()
const emit = defineEmits<{ close: [] }>()

type TabName = "activity" | "overview" | "console" | "network" | "cookies"
const activeTab = ref<TabName>("activity")
const logs = ref<LogsAttachment | null>(null)
const logsLoaded = ref(false)

// Local report copy so triage-panel updates feel instant. Re-sync when parent
// passes a new report.
const current = ref<ReportSummaryDTO>(props.report)
watch(
  () => props.report.id,
  () => {
    current.value = props.report
  },
)

// Role check for edit permission. Viewer-only users see read-only pills.
const { data: meRole } = useApi<{ role: string }>(`/api/projects/${props.projectId}/me`, {
  default: () => ({ role: "viewer" }),
})
const canEdit = computed(() => meRole.value?.role !== "viewer")

async function ensureLogs() {
  if (logsLoaded.value) return
  logsLoaded.value = true
  const res = await $fetch<LogsAttachment>(
    `/api/projects/${props.projectId}/reports/${props.report.id}/attachment?kind=logs`,
    { credentials: "include" },
  ).catch(() => null)
  logs.value = res ?? null
}

watch(activeTab, (t) => {
  if (t === "console" || t === "network" || t === "cookies") ensureLogs()
})

const activityRef = ref<InstanceType<typeof ActivityTab> | null>(null)
async function onPatched() {
  const fresh = await $fetch<{
    items: Array<ReportSummaryDTO & { id: string }>
  }>(`/api/projects/${props.projectId}/reports?limit=50`, { credentials: "include" })
  const row = fresh.items.find((r) => r.id === current.value.id)
  if (row) current.value = row
  if (activityRef.value) await activityRef.value.refresh()
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close")
    return
  }
  if (e.key === "1") activeTab.value = "activity"
  if (e.key === "2") activeTab.value = "overview"
  if (e.key === "3") activeTab.value = "console"
  if (e.key === "4") activeTab.value = "network"
  if (e.key === "5") activeTab.value = "cookies"
}
onMounted(() => window.addEventListener("keydown", onKey))
onUnmounted(() => window.removeEventListener("keydown", onKey))
</script>

<template>
  <div class="fixed inset-0 bg-black/40 z-50" @click="emit('close')">
    <aside
      class="absolute right-0 top-0 h-full w-[720px] max-w-full bg-white shadow-2xl overflow-y-auto"
      @click.stop
    >
      <header class="p-4 border-b flex items-center justify-between">
        <h2 class="font-semibold truncate">{{ current.title }}</h2>
        <button type="button" class="text-neutral-500" @click="emit('close')">Close</button>
      </header>
      <TriagePanel
        :project-id="projectId"
        :report="current"
        :can-edit="canEdit"
        @patched="onPatched"
      />
      <Tabs :active-tab="activeTab" :logs="logs" @change="activeTab = $event" />
      <ActivityTab
        v-if="activeTab === 'activity'"
        ref="activityRef"
        :project-id="projectId"
        :report="current"
      />
      <OverviewTab v-else-if="activeTab === 'overview'" :project-id="projectId" :report="current" />
      <ConsoleTab v-else-if="activeTab === 'console'" :logs="logs" />
      <NetworkTab v-else-if="activeTab === 'network'" :logs="logs" />
      <CookiesTab v-else-if="activeTab === 'cookies'" :project-id="projectId" :report="current" />
    </aside>
  </div>
</template>
