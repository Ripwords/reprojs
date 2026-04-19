<script setup lang="ts">
import type { ProjectDTO, ProjectOverviewDTO, ReportSummaryDTO } from "@feedback-tool/shared"

const route = useRoute()
const projectId = computed(() => String(route.params.id))

const { data: project } = await useApi<ProjectDTO>(`/api/projects/${projectId.value}`)
const { data: overview } = await useApi<ProjectOverviewDTO>(
  `/api/projects/${projectId.value}/overview`,
)
const { data: recentReportsResp } = await useApi<{ items: ReportSummaryDTO[] }>(
  `/api/projects/${projectId.value}/reports`,
  { query: { limit: 5, sort: "newest" } },
)

const metrics = computed(() => {
  const c = overview.value?.counts
  if (!c) return null
  return {
    open: c.byStatus.open ?? 0,
    newThisWeek: c.last7Days,
    total: c.total,
  }
})

const integration = computed(() => {
  const g = overview.value?.github
  if (!g || !g.installed) return { status: "not connected" as const, repoFullName: null }
  return {
    status: g.status ?? "not connected",
    repoFullName: g.repo,
    linkedCount: g.linkedCount,
    failedCount: g.failedCount,
  }
})

const recentReports = computed<ReportSummaryDTO[]>(() => recentReportsResp.value?.items ?? [])
const recentActivity = computed(() => overview.value?.recentEvents ?? [])

function priorityColor(p: string): "error" | "warning" | "neutral" | "primary" {
  if (p === "urgent") return "error"
  if (p === "high") return "warning"
  if (p === "normal") return "primary"
  return "neutral"
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diffMs / 3_600_000)
  if (h < 1) return "just now"
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

const EVENT_LABEL: Record<string, string> = {
  status_changed: "changed status",
  priority_changed: "changed priority",
  assignee_changed: "reassigned",
  tag_added: "added a tag",
  tag_removed: "removed a tag",
  github_unlinked: "unlinked GitHub issue",
}

function describeEvent(e: ProjectOverviewDTO["recentEvents"][number]): string {
  const label = EVENT_LABEL[e.kind] ?? e.kind
  return `${label} on "${e.reportTitle}"`
}
</script>

<template>
  <div class="space-y-6">
    <!-- Page header -->
    <header class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold text-default">{{ project?.name ?? "..." }}</h1>
        <p class="text-sm text-muted mt-1">Project overview</p>
      </div>
      <UButton
        :to="`/projects/${projectId}/reports`"
        label="Go to inbox"
        trailing-icon="i-heroicons-arrow-right"
        color="primary"
      />
    </header>

    <!-- Metric tiles -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <UCard>
        <div class="text-sm text-muted">Open reports</div>
        <div class="mt-1 text-3xl font-semibold text-default">{{ metrics?.open ?? 0 }}</div>
      </UCard>
      <UCard>
        <div class="text-sm text-muted">New this week</div>
        <div class="mt-1 text-3xl font-semibold text-default">{{ metrics?.newThisWeek ?? 0 }}</div>
      </UCard>
      <UCard>
        <div class="text-sm text-muted">Total reports</div>
        <div class="mt-1 text-3xl font-semibold text-default">{{ metrics?.total ?? 0 }}</div>
      </UCard>
      <UCard>
        <div class="text-sm text-muted">GitHub sync</div>
        <div class="mt-2 flex items-center gap-2">
          <UBadge
            :label="integration.status"
            :color="integration.status === 'connected' ? 'success' : 'neutral'"
            variant="soft"
            size="xs"
          />
          <span v-if="integration.repoFullName" class="text-sm text-muted truncate">
            {{ integration.repoFullName }}
          </span>
        </div>
      </UCard>
    </div>

    <!-- Two-column: recent reports + recent activity -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold text-default">Recent reports</h2>
        </template>
        <div
          v-if="!recentReports || recentReports.length === 0"
          class="text-sm text-muted py-8 text-center"
        >
          No reports yet.
        </div>
        <ul v-else class="space-y-2">
          <li v-for="r in recentReports" :key="r.id" class="flex items-center gap-3 text-sm py-1">
            <UBadge
              :label="r.priority"
              :color="priorityColor(r.priority)"
              variant="soft"
              size="xs"
            />
            <NuxtLink
              :to="`/projects/${projectId}/reports/${r.id}`"
              class="flex-1 min-w-0 truncate text-default hover:text-primary-600"
            >
              {{ r.title }}
            </NuxtLink>
            <span class="text-xs text-muted whitespace-nowrap">
              {{ relativeTime(r.receivedAt) }}
            </span>
          </li>
        </ul>
      </UCard>
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold text-default">Activity</h2>
        </template>
        <div
          v-if="!recentActivity || recentActivity.length === 0"
          class="text-sm text-muted py-8 text-center"
        >
          No activity yet.
        </div>
        <ul v-else class="space-y-3">
          <li v-for="e in recentActivity" :key="e.id" class="text-sm">
            <span class="text-default font-medium">
              {{ e.actor?.name ?? e.actor?.email ?? "System" }}
            </span>
            <span class="text-muted"> {{ describeEvent(e) }}</span>
            <span class="ml-2 text-xs text-muted">{{ relativeTime(e.createdAt) }}</span>
          </li>
        </ul>
      </UCard>
    </div>

    <!-- Activation CTA when no reports -->
    <AppEmptyState
      v-if="recentReports && recentReports.length === 0"
      variant="gradient"
      icon="i-heroicons-code-bracket"
      title="Install the SDK to start receiving reports"
      description="Add a single <script> tag to your site or npm-install @feedback-tool/core."
      action-label="View install instructions"
      action-to="/settings/install"
    />
  </div>
</template>
