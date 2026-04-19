<!--
  Faceted filter sidebar for the inbox. Renders Assignee / Priority / Tags
  sections, each a list of togglable rows with a live count.

  Visual treatment:
    - Section labels are eyebrow caps with wide tracking, separated from
      rows by breathing room (not a border) — matches the rest of the app.
    - Rows are flex label/count pairs; hover lights the background, active
      state lights it teal and tints the label + adds a teal leading
      indicator. No UButton / no UBadge — the tiny pills in the old
      version read as "form widget" rather than "filter". Plain tabular
      numerals read as data.
    - Counts in tabular-nums so 11-digit counters (realistic for inboxes)
      don't dance as filters change.
-->
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

// Priority rows get a colored leading dot (urgent=red, high=orange,
// normal=teal, low=muted). That single dot carries more signal than a
// pill badge and pairs visually with the priority column in the table.
const priorityDot: Record<ReportPriority, string> = {
  urgent: "bg-error",
  high: "bg-warning",
  normal: "bg-primary/70",
  low: "bg-muted-foreground/40",
}
</script>

<template>
  <aside class="space-y-7 text-sm">
    <section>
      <h3 class="px-2 mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        Assignee
      </h3>
      <ul>
        <li v-for="a in assignees" :key="a.id ?? '__unassigned'">
          <button
            type="button"
            :aria-pressed="isAssigneeSelected(a)"
            class="group w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
            :class="
              isAssigneeSelected(a)
                ? 'bg-elevated text-default font-semibold'
                : 'text-muted hover:text-default hover:bg-elevated/60'
            "
            @click="toggleAssignee(assigneeToken(a))"
          >
            <span
              class="size-1.5 rounded-full"
              :class="
                isAssigneeSelected(a) ? 'bg-primary' : 'bg-transparent group-hover:bg-muted/60'
              "
              aria-hidden="true"
            />
            <span class="flex-1 truncate text-left font-medium">{{ assigneeLabel(a) }}</span>
            <span
              class="text-xs font-medium tabular-nums"
              :class="isAssigneeSelected(a) ? 'text-primary' : 'text-muted'"
            >
              {{ a.count }}
            </span>
          </button>
        </li>
      </ul>
    </section>

    <section>
      <h3 class="px-2 mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        Priority
      </h3>
      <ul>
        <li v-for="p in PRIORITIES" :key="p">
          <button
            type="button"
            :aria-pressed="selectedPriority.includes(p)"
            class="group w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
            :class="
              selectedPriority.includes(p)
                ? 'bg-elevated text-default font-semibold'
                : 'text-muted hover:text-default hover:bg-elevated/60'
            "
            @click="togglePriority(p)"
          >
            <span
              class="size-1.5 rounded-full shrink-0"
              :class="priorityDot[p]"
              aria-hidden="true"
            />
            <span class="flex-1 text-left font-medium">{{ priorityLabel(p) }}</span>
            <span
              class="text-xs font-medium tabular-nums"
              :class="selectedPriority.includes(p) ? 'text-primary' : 'text-muted'"
            >
              {{ priorityCounts[p] ?? 0 }}
            </span>
          </button>
        </li>
      </ul>
    </section>

    <section v-if="tags.length">
      <h3 class="px-2 mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        Tags
      </h3>
      <ul>
        <li v-for="t in tags" :key="t.name">
          <button
            type="button"
            :aria-pressed="selectedTags.includes(t.name)"
            class="group w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
            :class="
              selectedTags.includes(t.name)
                ? 'bg-elevated text-default font-semibold'
                : 'text-muted hover:text-default hover:bg-elevated/60'
            "
            @click="toggleTag(t.name)"
          >
            <UIcon
              name="i-heroicons-hashtag"
              class="size-3.5 shrink-0"
              :class="selectedTags.includes(t.name) ? 'text-primary' : 'text-muted'"
            />
            <span class="flex-1 truncate text-left font-medium">{{ t.name }}</span>
            <span
              class="text-xs font-medium tabular-nums"
              :class="selectedTags.includes(t.name) ? 'text-primary' : 'text-muted'"
            >
              {{ t.count }}
            </span>
          </button>
        </li>
      </ul>
    </section>
  </aside>
</template>
