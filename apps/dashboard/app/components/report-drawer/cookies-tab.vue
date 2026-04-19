<!-- apps/dashboard/app/components/report-drawer/cookies-tab.vue -->
<script setup lang="ts">
import { computed, ref } from "vue"
import type { ReportSummaryDTO } from "@feedback-tool/shared"

interface Props {
  projectId: string
  report: ReportSummaryDTO
}
const props = defineProps<Props>()

const cookies = computed(() => props.report.context?.cookies ?? [])

const query = ref("")
const filtered = computed(() => {
  if (!query.value) return cookies.value
  const q = query.value.toLowerCase()
  return cookies.value.filter((c) => c.name.toLowerCase().includes(q))
})
</script>

<template>
  <div v-if="cookies.length === 0" class="p-5 text-sm text-muted">No cookies captured.</div>
  <div v-else class="p-3 space-y-3">
    <UInput
      v-model="query"
      placeholder="Filter by name…"
      size="xs"
      icon="i-heroicons-magnifying-glass"
      class="w-full"
    />
    <table class="w-full text-xs">
      <thead class="text-left text-muted">
        <tr class="border-b border-default">
          <th class="p-2 font-medium">Name</th>
          <th class="p-2 font-medium">Value</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in filtered" :key="c.name" class="border-b border-default">
          <td class="p-2 font-mono text-default">{{ c.name }}</td>
          <td
            class="p-2 font-mono break-all"
            :class="c.value === '<redacted>' ? 'italic text-muted' : 'text-default'"
          >
            {{ c.value }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
