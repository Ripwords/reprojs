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

const TABS: Array<{ key: "all" | ReportStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
]

function isActive(key: "all" | ReportStatus): boolean {
  if (key === "all") return props.selected.length === 0
  return props.selected.length === 1 && props.selected[0] === key
}

function onClick(key: "all" | ReportStatus) {
  emit("change", key === "all" ? [] : [key])
}

function countFor(key: "all" | ReportStatus): number {
  return key === "all" ? props.total : (props.counts[key] ?? 0)
}
</script>

<template>
  <nav class="flex gap-1 border-b text-sm">
    <button
      v-for="t in TABS"
      :key="t.key"
      type="button"
      class="px-3 py-2 border-b-2 -mb-px"
      :class="
        isActive(t.key)
          ? 'border-neutral-900 font-semibold'
          : 'border-transparent text-neutral-500 hover:text-neutral-900'
      "
      @click="onClick(t.key)"
    >
      {{ t.label }}
      <span class="ml-1 text-xs text-neutral-400">{{ countFor(t.key) }}</span>
    </button>
  </nav>
</template>
