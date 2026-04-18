<!-- apps/dashboard/app/components/inbox/report-row.vue -->
<script setup lang="ts">
import type { ReportSummaryDTO } from "@feedback-tool/shared"
import { safeHref } from "~/composables/use-safe-href"

interface Props {
  report: ReportSummaryDTO
  checked: boolean
}
defineProps<Props>()
const emit = defineEmits<{
  "toggle-check": []
  open: []
}>()

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  normal: "bg-neutral-100 text-neutral-600",
  low: "bg-neutral-50 text-neutral-400",
}

function initials(name: string | null, email: string): string {
  const base = name?.trim() || email
  return base.slice(0, 2).toUpperCase()
}
function relTime(iso: string): string {
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
</script>

<template>
  <tr class="border-t hover:bg-neutral-50 cursor-pointer" @click="emit('open')">
    <td class="p-2" @click.stop>
      <input type="checkbox" :checked="checked" @change="emit('toggle-check')" />
    </td>
    <td class="p-2">
      <span
        :class="[
          PRIORITY_COLOR[report.priority],
          'px-2 py-0.5 rounded text-xs uppercase font-semibold',
        ]"
        >{{ report.priority }}</span
      >
    </td>
    <td class="p-2 font-medium truncate max-w-md">{{ report.title }}</td>
    <td class="p-2 text-xs">
      <a
        v-if="report.githubIssueNumber && report.githubIssueUrl"
        :href="safeHref(report.githubIssueUrl)"
        target="_blank"
        rel="noopener"
        class="text-neutral-500 hover:text-neutral-900"
        :title="`GitHub issue #${report.githubIssueNumber}`"
        @click.stop
      >
        🐙#{{ report.githubIssueNumber }}
      </a>
      <span v-else class="text-neutral-300">—</span>
    </td>
    <td class="p-2">
      <span v-if="report.assignee" class="inline-flex items-center gap-1 text-xs">
        <span
          class="w-5 h-5 rounded-full bg-neutral-200 text-neutral-700 flex items-center justify-center text-[10px] font-semibold"
          >{{ initials(report.assignee.name, report.assignee.email) }}</span
        >
        <span class="truncate max-w-[8rem]">{{
          report.assignee.name ?? report.assignee.email
        }}</span>
      </span>
      <span v-else class="text-neutral-400 text-xs">—</span>
    </td>
    <td class="p-2 text-xs text-neutral-500 whitespace-nowrap">{{ relTime(report.updatedAt) }}</td>
  </tr>
</template>
