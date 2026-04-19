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

const PRIORITIES: ReportPriority[] = ["urgent", "high", "normal", "low"]

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

function priorityLabel(p: ReportPriority): string {
  return p.charAt(0).toUpperCase() + p.slice(1)
}
</script>

<template>
  <aside class="space-y-6 text-sm">
    <section>
      <h3 class="text-xs font-semibold text-muted uppercase tracking-wide mb-2 px-2">Assignee</h3>
      <ul class="space-y-0.5">
        <li v-for="a in assignees" :key="a.id ?? '__unassigned'">
          <UButton
            :label="assigneeLabel(a)"
            :color="isAssigneeSelected(a) ? 'primary' : 'neutral'"
            :variant="isAssigneeSelected(a) ? 'soft' : 'ghost'"
            block
            size="sm"
            :ui="{ base: 'justify-between' }"
            @click="toggleAssignee(assigneeToken(a))"
          >
            <template #trailing>
              <UBadge :label="String(a.count)" color="neutral" variant="subtle" size="xs" />
            </template>
          </UButton>
        </li>
      </ul>
    </section>

    <section>
      <h3 class="text-xs font-semibold text-muted uppercase tracking-wide mb-2 px-2">Priority</h3>
      <ul class="space-y-0.5">
        <li v-for="p in PRIORITIES" :key="p">
          <UButton
            :label="priorityLabel(p)"
            :color="selectedPriority.includes(p) ? 'primary' : 'neutral'"
            :variant="selectedPriority.includes(p) ? 'soft' : 'ghost'"
            block
            size="sm"
            :ui="{ base: 'justify-between' }"
            @click="togglePriority(p)"
          >
            <template #trailing>
              <UBadge
                :label="String(priorityCounts[p] ?? 0)"
                color="neutral"
                variant="subtle"
                size="xs"
              />
            </template>
          </UButton>
        </li>
      </ul>
    </section>

    <section v-if="tags.length">
      <h3 class="text-xs font-semibold text-muted uppercase tracking-wide mb-2 px-2">Tags</h3>
      <ul class="space-y-0.5">
        <li v-for="t in tags" :key="t.name">
          <UButton
            :label="t.name"
            :color="selectedTags.includes(t.name) ? 'primary' : 'neutral'"
            :variant="selectedTags.includes(t.name) ? 'soft' : 'ghost'"
            block
            size="sm"
            :ui="{ base: 'justify-between' }"
            @click="toggleTag(t.name)"
          >
            <template #trailing>
              <UBadge :label="String(t.count)" color="neutral" variant="subtle" size="xs" />
            </template>
          </UButton>
        </li>
      </ul>
    </section>
  </aside>
</template>
