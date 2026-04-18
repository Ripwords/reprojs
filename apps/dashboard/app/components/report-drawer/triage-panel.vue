<!-- apps/dashboard/app/components/report-drawer/triage-panel.vue -->
<script setup lang="ts">
import type { ReportPriority, ReportStatus, ReportSummaryDTO } from "@feedback-tool/shared"

interface Member {
  userId: string
  name: string | null
  email: string
}
interface Props {
  projectId: string
  report: ReportSummaryDTO
  canEdit: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{ patched: [] }>()

const STATUSES: ReportStatus[] = ["open", "in_progress", "resolved", "closed"]
const PRIORITIES: ReportPriority[] = ["urgent", "high", "normal", "low"]
const STATUS_COLOR: Record<ReportStatus, string> = {
  open: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  resolved: "bg-green-100 text-green-800",
  closed: "bg-neutral-200 text-neutral-700",
}
const PRIORITY_COLOR: Record<ReportPriority, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  normal: "bg-neutral-100 text-neutral-600",
  low: "bg-neutral-50 text-neutral-400",
}

const { data: members } = useApi<Member[]>(
  `/api/projects/${props.projectId}/members?role=developer,owner`,
)

const tagDraft = ref("")
const posting = ref(false)

async function patch(body: Record<string, unknown>) {
  posting.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/reports/${props.report.id}`, {
      method: "PATCH",
      body,
      credentials: "include",
    })
    emit("patched")
  } finally {
    posting.value = false
  }
}

async function addTag() {
  const name = tagDraft.value.trim()
  if (!name || props.report.tags.includes(name)) {
    tagDraft.value = ""
    return
  }
  tagDraft.value = ""
  await patch({ tags: [...props.report.tags, name] })
}
async function removeTag(name: string) {
  await patch({ tags: props.report.tags.filter((t) => t !== name) })
}
</script>

<template>
  <div class="p-3 border-b space-y-2 text-sm">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-xs uppercase text-neutral-500">Status</span>
      <select
        :value="report.status"
        :disabled="!canEdit || posting"
        class="rounded px-2 py-0.5 text-xs font-semibold"
        :class="STATUS_COLOR[report.status]"
        @change="patch({ status: ($event.target as HTMLSelectElement).value })"
      >
        <option v-for="s in STATUSES" :key="s" :value="s">{{ s.replace("_", " ") }}</option>
      </select>

      <span class="text-xs uppercase text-neutral-500 ml-2">Priority</span>
      <select
        :value="report.priority"
        :disabled="!canEdit || posting"
        class="rounded px-2 py-0.5 text-xs uppercase font-semibold"
        :class="PRIORITY_COLOR[report.priority]"
        @change="patch({ priority: ($event.target as HTMLSelectElement).value })"
      >
        <option v-for="p in PRIORITIES" :key="p" :value="p">{{ p }}</option>
      </select>

      <span class="text-xs uppercase text-neutral-500 ml-2">Assignee</span>
      <select
        :value="report.assignee?.id ?? ''"
        :disabled="!canEdit || posting"
        class="rounded px-2 py-0.5 text-xs border"
        @change="
          patch({
            assigneeId: ($event.target as HTMLSelectElement).value || null,
          })
        "
      >
        <option value="">Unassigned</option>
        <option v-for="m in members ?? []" :key="m.userId" :value="m.userId">
          {{ m.name ?? m.email }}
        </option>
      </select>
    </div>

    <div class="flex flex-wrap items-center gap-1">
      <span class="text-xs uppercase text-neutral-500 mr-1">Tags</span>
      <span
        v-for="t in report.tags"
        :key="t"
        class="inline-flex items-center gap-1 bg-neutral-100 rounded px-2 py-0.5 text-xs"
      >
        {{ t }}
        <button
          v-if="canEdit"
          type="button"
          class="text-neutral-400 hover:text-neutral-900"
          @click="removeTag(t)"
        >
          ×
        </button>
      </span>
      <input
        v-if="canEdit"
        v-model="tagDraft"
        class="border rounded px-2 py-0.5 text-xs w-24"
        placeholder="+ tag"
        @keydown.enter.prevent="addTag"
      />
    </div>
  </div>
</template>
