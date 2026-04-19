<!-- apps/dashboard/app/components/report-drawer/drawer.vue -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import type { LogsAttachment, ReportSummaryDTO } from "@feedback-tool/shared"
import ActivityTab from "./activity-tab.vue"
import ConsoleTab from "./console-tab.vue"
import CookiesTab from "./cookies-tab.vue"
import NetworkTab from "./network-tab.vue"
import OverviewTab from "./overview-tab.vue"
import ReplayTab from "./replay-tab.vue"
import DrawerTabs from "./tabs.vue"
import TriageFooter from "./triage-footer.vue"

interface Props {
  projectId: string
  report: ReportSummaryDTO
}
const props = defineProps<Props>()
const emit = defineEmits<{ close: [] }>()

// Drawer width is persisted across sessions via cookie so the reviewer's
// preferred sizing sticks after refresh.
const drawerWidth = useCookie<number>("drawer-width", { default: () => 560 })

type TabId =
  | "overview"
  | "console"
  | "network"
  | "replay"
  | "activity"
  | "cookies"
  | "system"
  | "raw"
const activeTab = ref<TabId>("overview")

// Local report copy so triage-footer updates feel instant. Re-sync when parent
// passes a new report.
const current = ref<ReportSummaryDTO>(props.report)
watch(
  () => props.report.id,
  () => {
    current.value = props.report
  },
)

// Role check for edit permission. Viewer-only users see disabled controls.
const { data: meRole } = useApi<{ role: string }>(`/api/projects/${props.projectId}/me`, {
  default: () => ({ role: "viewer" }),
})
const canEdit = computed(() => meRole.value?.role !== "viewer")

// Logs attachment is lazy-loaded when a tab that needs it is opened.
const logs = ref<LogsAttachment | null>(null)
const logsLoaded = ref(false)
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
  if (t === "console" || t === "network") ensureLogs()
})

const consoleHasData = computed(
  () => logs.value !== null && (logs.value.console.length > 0 || logs.value.breadcrumbs.length > 0),
)
const networkHasData = computed(() => logs.value !== null && logs.value.network.length > 0)
const cookiesHasData = computed(() => (current.value.context?.cookies?.length ?? 0) > 0)

const tabs = computed(() => [
  { id: "overview", label: "Overview" },
  { id: "console", label: "Console", hasData: consoleHasData.value },
  { id: "network", label: "Network", hasData: networkHasData.value },
  { id: "replay", label: "Replay", hasData: current.value.hasReplay },
  { id: "activity", label: "Activity" },
  { id: "cookies", label: "Cookies", hasData: cookiesHasData.value },
  { id: "system", label: "System" },
  { id: "raw", label: "Raw" },
])

// After triage mutations, re-fetch the row and refresh the activity tab.
const activityRef = ref<InstanceType<typeof ActivityTab> | null>(null)
async function onPatched() {
  const fresh = await $fetch<{
    items: Array<ReportSummaryDTO & { id: string }>
  }>(`/api/projects/${props.projectId}/reports?limit=50`, { credentials: "include" })
  const row = fresh.items.find((r) => r.id === current.value.id)
  if (row) current.value = row
  if (activityRef.value) await activityRef.value.refresh()
}

// Left-edge drag handle resizes the drawer. Bounded [400, 800]px.
const resizing = ref(false)
function startResize(e: MouseEvent) {
  e.preventDefault()
  resizing.value = true
  const startX = e.clientX
  const startW = drawerWidth.value

  function onMove(ev: MouseEvent) {
    const delta = startX - ev.clientX
    const next = Math.max(400, Math.min(900, startW + delta))
    drawerWidth.value = next
  }
  function onUp() {
    resizing.value = false
    document.removeEventListener("mousemove", onMove)
    document.removeEventListener("mouseup", onUp)
  }
  document.addEventListener("mousemove", onMove)
  document.addEventListener("mouseup", onUp)
}

// Keyboard shortcuts: Esc closes; 1–8 jump to each tab.
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close")
    return
  }
  const map: Record<string, TabId> = {
    "1": "overview",
    "2": "console",
    "3": "network",
    "4": "replay",
    "5": "activity",
    "6": "cookies",
    "7": "system",
    "8": "raw",
  }
  const next = map[e.key]
  if (next) activeTab.value = next
}
onMounted(() => window.addEventListener("keydown", onKey))
onUnmounted(() => window.removeEventListener("keydown", onKey))

// Drive USlideover open state from the presence of a report.
const open = ref(true)
function handleOpenUpdate(v: boolean) {
  open.value = v
  if (!v) emit("close")
}

function priorityColor(p: string): "error" | "warning" | "neutral" | "primary" {
  if (p === "urgent") return "error"
  if (p === "high") return "warning"
  if (p === "normal") return "primary"
  return "neutral"
}
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}
</script>

<template>
  <USlideover
    :open="open"
    side="right"
    :ui="{ content: 'shadow-xl' }"
    @update:open="handleOpenUpdate"
  >
    <template #content>
      <div class="h-full flex flex-col bg-default relative" :style="{ width: drawerWidth + 'px' }">
        <div
          class="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-primary-500/30 z-10"
          :class="{ 'bg-primary-500/50': resizing }"
          role="separator"
          aria-label="Resize drawer"
          @mousedown="startResize"
        />

        <div class="flex items-center justify-end px-5 h-14 border-b border-default">
          <UButton
            icon="i-heroicons-x-mark"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Close"
            @click="emit('close')"
          />
        </div>

        <div class="px-5 py-4 border-b border-default">
          <div class="flex items-start justify-between gap-4">
            <h2 class="text-lg font-semibold text-default truncate">{{ current.title }}</h2>
            <UBadge
              :label="current.priority"
              :color="priorityColor(current.priority)"
              variant="soft"
              size="xs"
              class="capitalize flex-shrink-0"
            />
          </div>
          <div class="mt-1 text-xs text-muted truncate">
            {{ current.context?.pageUrl ?? current.pageUrl }} ·
            {{ relativeTime(current.receivedAt) }}
          </div>
        </div>

        <DrawerTabs
          :model-value="activeTab"
          :tabs="tabs"
          class="border-b border-default px-2"
          @update:model-value="(v) => (activeTab = v as TabId)"
        />

        <div class="flex-1 min-h-0 overflow-y-auto">
          <OverviewTab v-if="activeTab === 'overview'" :project-id="projectId" :report="current" />
          <ConsoleTab v-else-if="activeTab === 'console'" :logs="logs" />
          <NetworkTab v-else-if="activeTab === 'network'" :logs="logs" />
          <ReplayTab
            v-else-if="activeTab === 'replay'"
            :key="current.id"
            :project-id="projectId"
            :report-id="current.id"
            :has-replay="current.hasReplay"
          />
          <ActivityTab
            v-else-if="activeTab === 'activity'"
            ref="activityRef"
            :project-id="projectId"
            :report="current"
          />
          <CookiesTab
            v-else-if="activeTab === 'cookies'"
            :project-id="projectId"
            :report="current"
          />
          <div v-else-if="activeTab === 'system'" class="p-5">
            <UCard :ui="{ body: 'p-4' }">
              <pre class="text-xs font-mono whitespace-pre-wrap break-all">{{
                JSON.stringify(current.context?.systemInfo ?? {}, null, 2)
              }}</pre>
            </UCard>
          </div>
          <div v-else-if="activeTab === 'raw'" class="p-5">
            <UCard :ui="{ body: 'p-4' }">
              <pre class="text-xs font-mono whitespace-pre-wrap break-all">{{
                JSON.stringify(current, null, 2)
              }}</pre>
            </UCard>
          </div>
        </div>

        <TriageFooter
          :project-id="projectId"
          :report="current"
          :can-edit="canEdit"
          @patched="onPatched"
        />
      </div>
    </template>
  </USlideover>
</template>
