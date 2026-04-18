<script setup lang="ts">
import type { ProjectDTO, ProjectOverviewDTO } from "@feedback-tool/shared"

const route = useRoute()
const projectId = computed(() => String(route.params.id))

const { data: project } = await useApi<ProjectDTO>(`/api/projects/${projectId.value}`)
const { data: overview, refresh } = await useApi<ProjectOverviewDTO>(
  `/api/projects/${projectId.value}/overview`,
)

const STATUS_ORDER = ["open", "in_progress", "resolved", "closed"] as const
const PRIORITY_ORDER = ["urgent", "high", "normal", "low"] as const

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  normal: "bg-neutral-100 text-neutral-700",
  low: "bg-neutral-50 text-neutral-400",
}

const STATUS_COLOR: Record<string, string> = {
  open: "text-blue-700",
  in_progress: "text-yellow-700",
  resolved: "text-green-700",
  closed: "text-neutral-500",
}

const EVENT_LABEL: Record<string, string> = {
  status_changed: "status",
  priority_changed: "priority",
  assignee_changed: "assignee",
  tag_added: "tag added",
  tag_removed: "tag removed",
  github_unlinked: "GitHub unlinked",
}

const maxVolume = computed(() => Math.max(1, ...(overview.value?.volume ?? []).map((v) => v.count)))

function fmtRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function fmtDayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })
}

function describeEvent(e: ProjectOverviewDTO["recentEvents"][number]): string {
  const p = e.payload as Record<string, unknown>
  const from = p.from
  const to = p.to
  switch (e.kind) {
    case "status_changed":
      return `changed status from ${String(from).replace("_", " ")} → ${String(to).replace("_", " ")}`
    case "priority_changed":
      return `changed priority from ${String(from)} → ${String(to)}`
    case "assignee_changed":
      return `reassigned`
    case "tag_added":
      return `added tag "${String(p.name ?? "")}"`
    case "tag_removed":
      return `removed tag "${String(p.name ?? "")}"`
    case "github_unlinked":
      return `unlinked GitHub issue`
    default:
      return e.kind
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">{{ project?.name }}</h1>
        <div class="text-xs text-neutral-500">role: {{ project?.effectiveRole }}</div>
      </div>
      <div class="flex gap-3 text-sm">
        <NuxtLink :to="`/projects/${projectId}/reports`" class="underline">Reports</NuxtLink>
        <NuxtLink :to="`/projects/${projectId}/members`" class="underline">Members</NuxtLink>
        <NuxtLink
          v-if="project?.effectiveRole === 'owner'"
          :to="`/projects/${projectId}/settings`"
          class="underline"
          >Settings</NuxtLink
        >
      </div>
    </div>

    <!-- Stats row -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
      <div class="border rounded-lg p-4 bg-white">
        <div class="text-xs uppercase text-neutral-500">Total reports</div>
        <div class="text-3xl font-semibold mt-1">{{ overview?.counts.total ?? 0 }}</div>
        <div class="text-xs text-neutral-500 mt-1">
          {{ overview?.counts.last7Days ?? 0 }} in last 7d
        </div>
      </div>
      <div v-for="s in STATUS_ORDER" :key="s" class="border rounded-lg p-4 bg-white">
        <div class="text-xs uppercase text-neutral-500" :class="STATUS_COLOR[s]">
          {{ s.replace("_", " ") }}
        </div>
        <div class="text-3xl font-semibold mt-1">
          {{ overview?.counts.byStatus[s] ?? 0 }}
        </div>
      </div>
    </div>

    <!-- Priority breakdown chips -->
    <div class="flex flex-wrap gap-2 text-xs">
      <span
        v-for="p in PRIORITY_ORDER"
        :key="p"
        :class="[PRIORITY_COLOR[p], 'rounded px-2 py-0.5 font-semibold uppercase']"
      >
        {{ p }}: {{ overview?.counts.byPriority[p] ?? 0 }}
      </span>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Volume bar chart -->
      <div class="border rounded-lg p-4 bg-white">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold">Reports — last 7 days</h2>
          <span class="text-xs text-neutral-400">UTC</span>
        </div>
        <div class="flex gap-1 h-32">
          <div
            v-for="v in overview?.volume ?? []"
            :key="v.date"
            class="flex-1 h-full flex flex-col items-center gap-1"
            :title="`${v.date}: ${v.count} report${v.count === 1 ? '' : 's'}`"
          >
            <div class="text-[10px] text-neutral-500">{{ v.count }}</div>
            <div class="flex-1 w-full flex items-end">
              <div
                class="w-full rounded-t bg-neutral-800"
                :style="{ height: `${Math.max(2, (v.count / maxVolume) * 100)}%` }"
              />
            </div>
            <div class="text-[10px] text-neutral-500">{{ fmtDayLabel(v.date) }}</div>
          </div>
        </div>
      </div>

      <!-- GitHub sync status -->
      <div class="border rounded-lg p-4 bg-white">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold">GitHub sync</h2>
          <NuxtLink
            v-if="project?.effectiveRole === 'owner'"
            :to="`/projects/${projectId}/settings?tab=github`"
            class="text-xs underline text-neutral-500"
          >
            Settings →
          </NuxtLink>
        </div>
        <div v-if="!overview?.github.installed" class="text-sm text-neutral-500">
          Not installed. Configure GitHub integration in settings to auto-create issues for every
          report.
        </div>
        <div v-else-if="overview.github.status === 'disconnected'" class="text-sm text-red-700">
          ⚠ GitHub App was uninstalled or access revoked.
        </div>
        <div v-else class="space-y-2 text-sm">
          <div class="flex items-center gap-2">
            <span class="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span class="font-medium">connected</span>
            <span v-if="overview.github.repo" class="text-neutral-500">·</span>
            <a
              v-if="overview.github.repo"
              :href="`https://github.com/${overview.github.repo}`"
              target="_blank"
              rel="noopener"
              class="text-neutral-700 font-mono text-xs underline"
            >
              {{ overview.github.repo }}
            </a>
          </div>

          <div class="flex items-baseline gap-2 pt-2">
            <span class="text-3xl font-semibold">{{ overview.github.linkedCount }}</span>
            <span class="text-xs text-neutral-500">
              of {{ overview.counts.total }} report{{ overview.counts.total === 1 ? "" : "s" }}
              linked
            </span>
          </div>

          <div class="flex flex-wrap gap-3 text-xs pt-1">
            <span
              v-if="overview.github.pendingCount + overview.github.syncingCount > 0"
              class="text-neutral-600"
            >
              ⟳ {{ overview.github.pendingCount + overview.github.syncingCount }} in queue
            </span>
            <span v-if="overview.github.failedCount > 0" class="text-red-700 font-medium">
              ⚠ {{ overview.github.failedCount }} failed —
              <NuxtLink :to="`/projects/${projectId}/settings?tab=github`" class="underline">
                retry
              </NuxtLink>
            </span>
            <span
              v-if="
                overview.github.pendingCount === 0 &&
                overview.github.syncingCount === 0 &&
                overview.github.failedCount === 0
              "
              class="text-green-700"
            >
              ✓ all synced
            </span>
          </div>

          <div v-if="overview.github.lastSyncedAt" class="text-xs text-neutral-500 pt-1">
            Last synced {{ fmtRel(overview.github.lastSyncedAt) }}
          </div>
        </div>
      </div>
    </div>

    <!-- Recent activity -->
    <div class="border rounded-lg bg-white">
      <div class="flex items-center justify-between p-4 border-b">
        <h2 class="text-sm font-semibold">Recent activity</h2>
        <button type="button" class="text-xs underline text-neutral-500" @click="refresh()">
          Refresh
        </button>
      </div>
      <ul v-if="(overview?.recentEvents ?? []).length > 0" class="divide-y">
        <li
          v-for="e in overview?.recentEvents ?? []"
          :key="e.id"
          class="flex items-start gap-3 p-3 text-sm hover:bg-neutral-50"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2">
              <span class="text-neutral-700 font-medium">
                {{ e.actor?.name ?? e.actor?.email ?? "system" }}
              </span>
              <span class="text-neutral-500 text-xs">
                {{ EVENT_LABEL[e.kind] ?? e.kind }}
              </span>
              <span class="text-neutral-400 text-xs ml-auto whitespace-nowrap">
                {{ fmtRel(e.createdAt) }}
              </span>
            </div>
            <div class="text-neutral-500 text-xs">
              {{ describeEvent(e) }}
              <span class="text-neutral-400">on</span>
              <NuxtLink
                :to="`/projects/${projectId}/reports?open=${e.reportId}`"
                class="underline truncate"
              >
                {{ e.reportTitle }}
              </NuxtLink>
            </div>
          </div>
        </li>
      </ul>
      <div v-else class="p-6 text-center text-sm text-neutral-500">No activity yet.</div>
    </div>
  </div>
</template>
