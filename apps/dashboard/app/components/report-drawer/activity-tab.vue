<!-- apps/dashboard/app/components/report-drawer/activity-tab.vue -->
<script setup lang="ts">
import type { ReportEventDTO, ReportSummaryDTO } from "@repro/shared"

interface Props {
  projectId: string
  report: ReportSummaryDTO
}
const props = defineProps<Props>()

const { data, refresh } = useApi<{ items: ReportEventDTO[]; total: number }>(
  `/api/projects/${props.projectId}/reports/${props.report.id}/events?limit=50`,
)

defineExpose({ refresh })

function summary(e: ReportEventDTO): string {
  const p = e.payload as Record<string, unknown>
  switch (e.kind) {
    case "status_changed":
      return `changed status ${String(p.from)} → ${String(p.to)}`
    case "priority_changed":
      return `set priority ${String(p.to)} (was ${String(p.from)})`
    case "assignee_changed": {
      const from = p.from ? "someone" : "nobody"
      const to = p.to ? "someone" : "nobody"
      return `reassigned from ${from} to ${to}`
    }
    case "tag_added":
      return `added tag ${String(p.name)}`
    case "tag_removed":
      return `removed tag ${String(p.name)}`
    default:
      return e.kind
  }
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
function actorLabel(e: ReportEventDTO): string {
  return e.actor?.name ?? e.actor?.email ?? "System"
}
function actorInitials(e: ReportEventDTO): string {
  return actorLabel(e).slice(0, 2).toUpperCase()
}
</script>

<template>
  <div class="p-5 text-sm">
    <div v-if="!data?.items?.length" class="text-muted">No activity yet.</div>
    <ul v-else class="space-y-3">
      <li v-for="e in data.items" :key="e.id" class="flex items-start gap-3">
        <UAvatar :text="actorInitials(e)" size="sm" class="flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-default">
            <span class="font-medium">{{ actorLabel(e) }}</span>
            <span class="text-muted"> {{ summary(e) }}</span>
          </div>
          <div class="text-xs text-muted mt-0.5">{{ relTime(e.createdAt) }}</div>
        </div>
      </li>
    </ul>
  </div>
</template>
