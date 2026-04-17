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
  <div v-if="cookies.length === 0" class="p-4 text-sm text-neutral-500">No cookies captured.</div>
  <div v-else class="p-2">
    <input
      v-model="query"
      placeholder="filter by name…"
      class="mb-2 border rounded px-2 py-1 text-xs w-full"
    />
    <table class="w-full text-xs">
      <thead class="bg-neutral-50 text-left">
        <tr>
          <th class="p-2">Name</th>
          <th class="p-2">Value</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in filtered" :key="c.name" class="border-t">
          <td class="p-2 font-mono">{{ c.name }}</td>
          <td
            class="p-2 font-mono break-all"
            :class="c.value === '<redacted>' ? 'italic text-neutral-400' : ''"
          >
            {{ c.value }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
