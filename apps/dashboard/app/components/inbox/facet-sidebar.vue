<!-- apps/dashboard/app/components/inbox/facet-sidebar.vue -->
<script setup lang="ts">
import type { ReportPriority } from "@feedback-tool/shared"

interface Assignee {
  id: string | null
  name: string | null
  email: string | null
  count: number
}

interface Props {
  priorityCounts: Record<ReportPriority, number>
  assignees: Assignee[]
  tags: Array<{ name: string; count: number }>
  selectedPriority: ReportPriority[]
  selectedAssignee: string[]
  selectedTags: string[]
  sessionUserId: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  priority: [ReportPriority[]]
  assignee: [string[]]
  tag: [string[]]
}>()

function togglePriority(p: ReportPriority) {
  const has = props.selectedPriority.includes(p)
  emit(
    "priority",
    has ? props.selectedPriority.filter((x) => x !== p) : [...props.selectedPriority, p],
  )
}
function toggleAssignee(token: string) {
  const has = props.selectedAssignee.includes(token)
  emit(
    "assignee",
    has ? props.selectedAssignee.filter((x) => x !== token) : [...props.selectedAssignee, token],
  )
}
function toggleTag(name: string) {
  const has = props.selectedTags.includes(name)
  emit("tag", has ? props.selectedTags.filter((x) => x !== name) : [...props.selectedTags, name])
}

const PRIORITIES: ReportPriority[] = ["urgent", "high", "normal", "low"]

function isAssigneeSelected(a: Assignee): boolean {
  if (a.id === null) return props.selectedAssignee.includes("unassigned")
  if (a.id === props.sessionUserId) return props.selectedAssignee.includes("me")
  return props.selectedAssignee.includes(a.id)
}
function assigneeToken(a: Assignee): string {
  if (a.id === null) return "unassigned"
  if (a.id === props.sessionUserId) return "me"
  return a.id
}
function assigneeLabel(a: Assignee): string {
  if (a.id === null) return "Unassigned"
  if (a.id === props.sessionUserId) return "Me"
  return a.name ?? a.email ?? a.id
}
</script>

<template>
  <aside class="space-y-5 text-sm p-3">
    <section>
      <h3 class="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Assignee</h3>
      <ul class="space-y-1">
        <li v-for="a in assignees" :key="a.id ?? '__unassigned'">
          <label
            class="flex items-center gap-2 cursor-pointer hover:bg-neutral-50 rounded px-1 py-0.5"
          >
            <input
              type="checkbox"
              :checked="isAssigneeSelected(a)"
              @change="toggleAssignee(assigneeToken(a))"
            />
            <span class="truncate flex-1">{{ assigneeLabel(a) }}</span>
            <span class="text-xs text-neutral-400">{{ a.count }}</span>
          </label>
        </li>
      </ul>
    </section>

    <section>
      <h3 class="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Priority</h3>
      <ul class="space-y-1">
        <li v-for="p in PRIORITIES" :key="p">
          <label
            class="flex items-center gap-2 cursor-pointer hover:bg-neutral-50 rounded px-1 py-0.5 capitalize"
          >
            <input
              type="checkbox"
              :checked="selectedPriority.includes(p)"
              @change="togglePriority(p)"
            />
            <span class="flex-1">{{ p }}</span>
            <span class="text-xs text-neutral-400">{{ priorityCounts[p] ?? 0 }}</span>
          </label>
        </li>
      </ul>
    </section>

    <section v-if="tags.length">
      <h3 class="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Tags</h3>
      <ul class="space-y-1">
        <li v-for="t in tags" :key="t.name">
          <label
            class="flex items-center gap-2 cursor-pointer hover:bg-neutral-50 rounded px-1 py-0.5"
          >
            <input
              type="checkbox"
              :checked="selectedTags.includes(t.name)"
              @change="toggleTag(t.name)"
            />
            <span class="truncate flex-1">{{ t.name }}</span>
            <span class="text-xs text-neutral-400">{{ t.count }}</span>
          </label>
        </li>
      </ul>
    </section>
  </aside>
</template>
