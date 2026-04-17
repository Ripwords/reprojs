<script setup lang="ts">
import type { LogsAttachment, ReportSummaryDTO } from "@feedback-tool/shared"
import OverviewTab from "./overview-tab.vue"
import ConsoleTab from "./console-tab.vue"
import NetworkTab from "./network-tab.vue"
import CookiesTab from "./cookies-tab.vue"
import Tabs from "./tabs.vue"

const props = defineProps<{ projectId: string; report: ReportSummaryDTO }>()
const emit = defineEmits<{ close: [] }>()

type TabName = "overview" | "console" | "network" | "cookies"
const activeTab = ref<TabName>("overview")
const logs = ref<LogsAttachment | null>(null)
const logsLoaded = ref(false)
const logsError = ref<string | null>(null)

async function ensureLogs() {
  if (logsLoaded.value) return
  logsLoaded.value = true
  try {
    const res = await $fetch<LogsAttachment>(
      `/api/projects/${props.projectId}/reports/${props.report.id}/attachment?kind=logs`,
      { credentials: "include" },
    ).catch(() => null)
    logs.value = res ?? null
  } catch (e: unknown) {
    logsError.value = e instanceof Error ? e.message : String(e)
  }
}

watch(activeTab, (t) => {
  if (t === "console" || t === "network" || t === "cookies") ensureLogs()
})

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close")
    return
  }
  if (e.key === "1") activeTab.value = "overview"
  if (e.key === "2") activeTab.value = "console"
  if (e.key === "3") activeTab.value = "network"
  if (e.key === "4") activeTab.value = "cookies"
}
onMounted(() => window.addEventListener("keydown", onKey))
onUnmounted(() => window.removeEventListener("keydown", onKey))
</script>

<template>
  <div class="fixed inset-0 bg-black/40 z-50" @click="emit('close')">
    <aside
      class="absolute right-0 top-0 h-full w-[640px] max-w-full bg-white shadow-2xl overflow-y-auto"
      @click.stop
    >
      <header class="p-4 border-b flex items-center justify-between">
        <h2 class="font-semibold truncate">{{ report.title }}</h2>
        <button type="button" class="text-neutral-500" @click="emit('close')">Close</button>
      </header>
      <Tabs :active-tab="activeTab" :logs="logs" @change="activeTab = $event" />
      <OverviewTab v-if="activeTab === 'overview'" :project-id="projectId" :report="report" />
      <ConsoleTab v-else-if="activeTab === 'console'" :logs="logs" />
      <NetworkTab v-else-if="activeTab === 'network'" :logs="logs" />
      <CookiesTab v-else-if="activeTab === 'cookies'" :project-id="projectId" :report="report" />
    </aside>
  </div>
</template>
