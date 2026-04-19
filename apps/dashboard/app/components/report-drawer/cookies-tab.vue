<!-- apps/dashboard/app/components/report-drawer/cookies-tab.vue -->
<script setup lang="ts">
import type { ReportContext, ReportSummaryDTO } from "@feedback-tool/shared"

const props = defineProps<{ projectId: string; report: ReportSummaryDTO }>()

// Cookies live in report.context, not in the logs attachment. Pull them from the same list
// endpoint (already includes the context since Task 16).
const { data } = await useApi<{
  items: Array<ReportSummaryDTO & { context?: ReportContext }>
}>(`/api/projects/${props.projectId}/reports?limit=50`)

const cookies = computed(() => {
  const row = data.value?.items.find((r) => r.id === props.report.id)
  return row?.context?.cookies ?? []
})

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
