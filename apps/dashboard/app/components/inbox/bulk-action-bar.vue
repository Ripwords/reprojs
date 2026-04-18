<!-- apps/dashboard/app/components/inbox/bulk-action-bar.vue -->
<script setup lang="ts">
import type { ReportStatus } from "@feedback-tool/shared"

interface AssigneeOption {
  value: string | null
  label: string
}
interface Props {
  count: number
  assigneeOptions: AssigneeOption[]
  submitting: boolean
}
defineProps<Props>()
const emit = defineEmits<{
  status: [ReportStatus]
  assign: [string | null]
  clear: []
}>()

const STATUS_OPTIONS: ReportStatus[] = ["open", "in_progress", "resolved", "closed"]
</script>

<template>
  <div
    v-if="count > 0"
    class="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-neutral-900 text-white rounded-lg shadow-xl flex items-center gap-3 px-3 py-2 text-sm"
  >
    <span class="font-semibold">{{ count }} selected</span>
    <select
      class="bg-neutral-800 rounded px-2 py-1"
      :disabled="submitting"
      @change="emit('status', ($event.target as HTMLSelectElement).value as ReportStatus)"
    >
      <option value="" disabled selected>Status…</option>
      <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option>
    </select>
    <select
      class="bg-neutral-800 rounded px-2 py-1"
      :disabled="submitting"
      @change="
        emit('assign', (($event.target as HTMLSelectElement).value || null) as string | null)
      "
    >
      <option value="" disabled selected>Assign…</option>
      <option v-for="opt in assigneeOptions" :key="opt.value ?? '__none'" :value="opt.value ?? ''">
        {{ opt.label }}
      </option>
    </select>
    <button
      type="button"
      class="text-neutral-400 hover:text-white px-2"
      :disabled="submitting"
      @click="emit('clear')"
    >
      ✕ Clear
    </button>
  </div>
</template>
