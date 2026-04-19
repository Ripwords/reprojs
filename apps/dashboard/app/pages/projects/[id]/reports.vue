<!-- apps/dashboard/app/pages/projects/[id]/reports.vue -->
<script setup lang="ts">
import { h, resolveComponent } from "vue"
import type { TableColumn } from "@nuxt/ui"
import type { ReportPriority, ReportStatus, ReportSummaryDTO } from "@feedback-tool/shared"
import StatusTabs from "~/components/inbox/status-tabs.vue"
import FacetSidebar from "~/components/inbox/facet-sidebar.vue"
import SearchSort from "~/components/inbox/search-sort.vue"
import BulkActionBar from "~/components/inbox/bulk-action-bar.vue"
import AppEmptyState from "~/components/common/app-empty-state.vue"
import { useInboxQuery } from "~/composables/use-inbox-query"
import { useKeyboardShortcuts } from "~/composables/useKeyboardShortcuts"

const UCheckbox = resolveComponent("UCheckbox")
const UBadge = resolveComponent("UBadge")
const UTooltip = resolveComponent("UTooltip")
const UIcon = resolveComponent("UIcon")

const route = useRoute()
const router = useRouter()
const projectId = computed(() => route.params.id as string)
const { session } = useSession()
const sessionUserId = computed(() => session.value?.data?.user?.id ?? "")

const { query, update, toApi } = useInboxQuery()

const listUrl = computed(() => `/api/projects/${projectId.value}/reports?${toApi()}`)
const { data, pending, refresh } = useApi<{
  items: ReportSummaryDTO[]
  total: number
  facets: {
    status: Record<ReportStatus, number>
    priority: Record<ReportPriority, number>
    assignees: Array<{
      id: string | null
      name: string | null
      email: string | null
      count: number
    }>
    tags: Array<{ name: string; count: number }>
  }
}>(listUrl, { watch: [listUrl] })

const reports = computed<ReportSummaryDTO[]>(() => data.value?.items ?? [])

const submittingBulk = ref(false)

// UTable uses a row-selection map keyed by row index (or id). We map it to our
// checked Set of report IDs so the existing bulk handlers still work.
const rowSelection = ref<Record<string, boolean>>({})
const checkedIds = computed<string[]>(() =>
  Object.entries(rowSelection.value)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .filter((id) => reports.value.some((r) => r.id === id)),
)

function clearSelection() {
  rowSelection.value = {}
}

async function bulkStatus(status: ReportStatus) {
  submittingBulk.value = true
  try {
    await $fetch(`/api/projects/${projectId.value}/reports/bulk-update`, {
      method: "POST",
      body: { reportIds: checkedIds.value, status },
      credentials: "include",
    })
    clearSelection()
    await refresh()
  } finally {
    submittingBulk.value = false
  }
}
async function bulkAssign(assigneeId: string | null) {
  submittingBulk.value = true
  try {
    await $fetch(`/api/projects/${projectId.value}/reports/bulk-update`, {
      method: "POST",
      body: { reportIds: checkedIds.value, assigneeId },
      credentials: "include",
    })
    clearSelection()
    await refresh()
  } finally {
    submittingBulk.value = false
  }
}

// Row click / keyboard activation navigates to the dedicated report page.
// Replaces the previous drawer integration — dedicated page gives full width,
// a shareable URL, and proper browser back-button behaviour.
function openReport(reportId: string) {
  navigateTo(`/projects/${projectId.value}/reports/${reportId}`)
}

const assigneeOptions = computed(() => {
  const opts: Array<{ value: string | null; label: string }> = [
    { value: null, label: "Unassign" },
    { value: sessionUserId.value, label: "Me" },
  ]
  for (const a of data.value?.facets.assignees ?? []) {
    if (a.id && a.id !== sessionUserId.value) {
      opts.push({ value: a.id, label: a.name ?? a.email ?? a.id })
    }
  }
  return opts
})

// ---- Filters / empty state ----
const hasActiveFilters = computed(
  () =>
    query.value.q.length > 0 ||
    query.value.status.length > 0 ||
    query.value.priority.length > 0 ||
    query.value.assignee.length > 0 ||
    query.value.tag.length > 0,
)

function clearFilters() {
  update({ q: "", status: [], priority: [], assignee: [], tag: [] })
}

// ---- Keyboard navigation ----
const highlightedIndex = ref(-1)

watch(reports, (next) => {
  if (next.length === 0) {
    highlightedIndex.value = -1
  } else if (highlightedIndex.value >= next.length) {
    highlightedIndex.value = next.length - 1
  }
})

function moveSelection(delta: number) {
  const list = reports.value
  if (list.length === 0) return
  const next = Math.min(
    Math.max(0, highlightedIndex.value === -1 ? 0 : highlightedIndex.value + delta),
    list.length - 1,
  )
  highlightedIndex.value = next
  if (typeof document !== "undefined") {
    const row = document.querySelector<HTMLElement>(`[data-row-index="${next}"]`)
    row?.scrollIntoView({ block: "nearest" })
  }
}
function openCurrent() {
  const list = reports.value
  const idx = highlightedIndex.value
  if (idx < 0 || idx >= list.length) return
  const row = list[idx]
  if (row) openReport(row.id)
}

useKeyboardShortcuts({
  j: () => moveSelection(1),
  k: () => moveSelection(-1),
  arrowdown: (e) => {
    e.preventDefault()
    moveSelection(1)
  },
  arrowup: (e) => {
    e.preventDefault()
    moveSelection(-1)
  },
  enter: () => openCurrent(),
})

// ---- Columns ----
function priorityColor(p: string): "error" | "warning" | "neutral" | "primary" {
  if (p === "urgent") return "error"
  if (p === "high") return "warning"
  if (p === "normal") return "primary"
  return "neutral"
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

function initials(name: string | null, email: string): string {
  const base = name?.trim() || email
  return base.slice(0, 2).toUpperCase()
}

const columns = computed<TableColumn<ReportSummaryDTO>[]>(() => [
  {
    id: "select",
    header: ({ table }) =>
      h(UCheckbox, {
        modelValue: table.getIsAllPageRowsSelected(),
        "onUpdate:modelValue": (v: boolean) => table.toggleAllPageRowsSelected(!!v),
        ariaLabel: "Select all",
      }),
    cell: ({ row }) =>
      h(UCheckbox, {
        modelValue: row.getIsSelected(),
        "onUpdate:modelValue": (v: boolean) => row.toggleSelected(!!v),
        ariaLabel: "Select row",
        onClick: (e: MouseEvent) => e.stopPropagation(),
      }),
  },
  {
    accessorKey: "priority",
    header: "Priority",
    cell: ({ row }) =>
      h(UBadge, {
        label: row.original.priority,
        color: priorityColor(row.original.priority),
        variant: "soft",
        size: "xs",
        class: "capitalize",
      }),
  },
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) =>
      h("div", { class: "font-medium text-default truncate max-w-[32rem]" }, row.original.title),
  },
  {
    id: "github",
    header: "",
    cell: ({ row }) => {
      const n = row.original.githubIssueNumber
      const url = row.original.githubIssueUrl
      if (n == null || !url) return h("span", { class: "text-muted text-xs" }, "—")
      return h(
        "a",
        {
          href: url,
          target: "_blank",
          rel: "noopener",
          class: "inline-flex items-center gap-1 text-xs text-muted hover:text-default transition",
          title: `GitHub issue #${n}`,
          onClick: (e: MouseEvent) => e.stopPropagation(),
        },
        [h(UIcon, { name: "i-simple-icons-github", class: "size-3.5" }), h("span", {}, `#${n}`)],
      )
    },
  },
  {
    accessorKey: "assignee",
    header: "Assignee",
    cell: ({ row }) => {
      const a = row.original.assignee
      if (!a) return h("span", { class: "text-muted text-xs" }, "—")
      return h("span", { class: "inline-flex items-center gap-2 text-xs" }, [
        h(
          "span",
          {
            class:
              "size-5 rounded-full bg-elevated text-default flex items-center justify-center text-[10px] font-semibold",
          },
          initials(a.name, a.email),
        ),
        h("span", { class: "truncate max-w-[8rem]" }, a.name ?? a.email),
      ])
    },
  },
  {
    accessorKey: "reporterEmail",
    header: "Reporter",
    cell: ({ row }) =>
      h(
        "span",
        { class: "text-xs text-muted truncate max-w-[10rem] inline-block" },
        row.original.reporterEmail ?? "—",
      ),
  },
  {
    accessorKey: "receivedAt",
    header: "",
    cell: ({ row }) =>
      h(UTooltip, { text: new Date(row.original.receivedAt).toLocaleString() }, () =>
        h(
          "span",
          { class: "text-xs text-muted whitespace-nowrap" },
          relativeTime(row.original.receivedAt),
        ),
      ),
  },
])

// Use report id as the row id so row-selection keys match our report ids.
function getRowId(row: ReportSummaryDTO): string {
  return row.id
}

type TableRowLike = { original: ReportSummaryDTO; index: number }
function onRowSelect(_e: Event, row: TableRowLike) {
  highlightedIndex.value = row.index
  openReport(row.original.id)
}
</script>

<template>
  <div class="flex gap-6 h-[calc(100vh-8rem)]">
    <FacetSidebar
      class="w-60 flex-shrink-0 overflow-y-auto"
      :priority-counts="data?.facets.priority ?? ({} as Record<ReportPriority, number>)"
      :assignees="data?.facets.assignees ?? []"
      :tags="data?.facets.tags ?? []"
      :selected-priority="query.priority as ReportPriority[]"
      :selected-assignee="query.assignee"
      :selected-tags="query.tag"
      :session-user-id="sessionUserId"
      @priority="update({ priority: $event })"
      @assignee="update({ assignee: $event })"
      @tag="update({ tag: $event })"
    />

    <div class="flex-1 min-w-0 flex flex-col">
      <header class="mb-4 flex items-baseline justify-between">
        <h1 class="text-2xl font-semibold text-default">Reports</h1>
        <span class="text-sm text-muted">{{ data?.total ?? 0 }} matches</span>
      </header>

      <div class="mb-3">
        <BulkActionBar
          v-if="checkedIds.length > 0"
          :count="checkedIds.length"
          :assignee-options="assigneeOptions"
          :submitting="submittingBulk"
          @status="bulkStatus"
          @assign="bulkAssign"
          @clear="clearSelection"
        />
        <SearchSort
          v-else
          :query="query.q"
          :sort="query.sort"
          @update:query="update({ q: $event })"
          @update:sort="update({ sort: $event })"
        />
      </div>

      <StatusTabs
        class="mb-3"
        :selected="query.status as ReportStatus[]"
        :counts="data?.facets.status ?? ({} as Record<ReportStatus, number>)"
        :total="data?.total ?? 0"
        @change="update({ status: $event })"
      />

      <div class="flex-1 min-h-0 overflow-y-auto rounded-xl border border-default bg-default">
        <AppEmptyState
          v-if="!pending && reports.length === 0"
          :icon="hasActiveFilters ? 'i-heroicons-funnel' : 'i-heroicons-inbox'"
          :title="hasActiveFilters ? 'No reports match these filters' : 'No reports yet'"
          :description="
            hasActiveFilters
              ? 'Try clearing the search or adjusting the filters.'
              : 'Reports will appear here when the SDK is installed and users submit bugs.'
          "
          :action-label="hasActiveFilters ? 'Clear filters' : 'View install instructions'"
          :action-to="hasActiveFilters ? undefined : '/settings/install'"
          :variant="hasActiveFilters ? 'plain' : 'gradient'"
          @action="hasActiveFilters ? clearFilters() : router.push('/settings/install')"
        />
        <UTable
          v-else
          v-model:row-selection="rowSelection"
          :data="reports"
          :columns="columns"
          :loading="pending"
          :get-row-id="getRowId"
          :ui="{
            th: 'text-xs font-medium text-muted',
            td: 'py-2 text-sm',
            tr: 'cursor-pointer hover:bg-neutral-50/50 dark:hover:bg-neutral-900/30',
          }"
          @select="onRowSelect"
        />
      </div>
    </div>
  </div>
</template>
