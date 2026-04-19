<!-- apps/dashboard/app/components/inbox/status-tabs.vue -->
<script setup lang="ts">
import type { ReportStatus } from "@feedback-tool/shared"

interface Props {
  selected: ReportStatus[]
  counts: Record<ReportStatus, number>
  total: number
}

const props = defineProps<Props>()
const emit = defineEmits<{ change: [ReportStatus[]] }>()

type TabKey = "all" | ReportStatus

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
]

function isActive(key: TabKey): boolean {
  if (key === "all") return props.selected.length === 0
  return props.selected.length === 1 && props.selected[0] === key
}

function countFor(key: TabKey): number {
  return key === "all" ? props.total : (props.counts[key] ?? 0)
}

function onClick(key: TabKey) {
  emit("change", key === "all" ? [] : [key])
}
</script>

<template>
  <nav
    class="flex items-center gap-1 border-b border-default text-sm"
    role="tablist"
    aria-label="Filter by status"
  >
    <button
      v-for="t in TABS"
      :key="t.key"
      type="button"
      role="tab"
      :aria-selected="isActive(t.key)"
      class="inline-flex items-center gap-2 px-3 py-2 border-b-2 -mb-px transition-colors"
      :class="
        isActive(t.key)
          ? 'border-primary text-default font-medium'
          : 'border-transparent text-muted hover:text-default'
      "
      @click="onClick(t.key)"
    >
      <span>{{ t.label }}</span>
      <UBadge
        :label="String(countFor(t.key))"
        :color="isActive(t.key) ? 'primary' : 'neutral'"
        :variant="isActive(t.key) ? 'soft' : 'subtle'"
        size="xs"
      />
    </button>
  </nav>
</template>
