<!-- apps/dashboard/app/pages/projects/[id]/reports.vue -->
<script setup lang="ts">
import type { ReportPriority, ReportStatus, ReportSummaryDTO } from "@feedback-tool/shared"
import ReportDrawer from "~/components/report-drawer/drawer.vue"
import StatusTabs from "~/components/inbox/status-tabs.vue"
import FacetSidebar from "~/components/inbox/facet-sidebar.vue"
import SearchSort from "~/components/inbox/search-sort.vue"
import ReportRow from "~/components/inbox/report-row.vue"
import BulkActionBar from "~/components/inbox/bulk-action-bar.vue"
import { useInboxQuery } from "~/composables/use-inbox-query"

const route = useRoute()
const projectId = computed(() => route.params.id as string)
const { session } = useSession()
const sessionUserId = computed(() => session.value?.data?.user?.id ?? "")

const { query, update, toApi } = useInboxQuery()

const listUrl = computed(() => `/api/projects/${projectId.value}/reports?${toApi()}`)
const { data, refresh } = useApi<{
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

const selected = ref<ReportSummaryDTO | null>(null)
const checked = ref<Set<string>>(new Set())
const submittingBulk = ref(false)

function toggleCheck(id: string) {
  if (checked.value.has(id)) checked.value.delete(id)
  else checked.value.add(id)
  checked.value = new Set(checked.value)
}
function clearSelection() {
  checked.value = new Set()
}
async function bulkStatus(status: ReportStatus) {
  submittingBulk.value = true
  try {
    await $fetch(`/api/projects/${projectId.value}/reports/bulk-update`, {
      method: "POST",
      body: { reportIds: [...checked.value], status },
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
      body: { reportIds: [...checked.value], assigneeId },
      credentials: "include",
    })
    clearSelection()
    await refresh()
  } finally {
    submittingBulk.value = false
  }
}

function closeDrawer() {
  selected.value = null
  refresh()
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
</script>

<template>
  <div class="space-y-3">
    <header class="flex items-baseline justify-between">
      <h1 class="text-2xl font-semibold">Reports</h1>
      <span class="text-sm text-neutral-500">{{ data?.total ?? 0 }} matches</span>
    </header>

    <StatusTabs
      :selected="query.status as ReportStatus[]"
      :counts="data?.facets.status ?? ({} as Record<ReportStatus, number>)"
      :total="data?.total ?? 0"
      @change="update({ status: $event })"
    />

    <div class="grid grid-cols-1 xl:grid-cols-[220px_1fr] gap-3">
      <FacetSidebar
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

      <div class="bg-white border rounded">
        <SearchSort
          :query="query.q"
          :sort="query.sort"
          @update:query="update({ q: $event })"
          @update:sort="update({ sort: $event })"
        />
        <div v-if="!data?.items?.length" class="p-8 text-center text-sm text-neutral-500">
          No reports match these filters.
        </div>
        <table v-else class="w-full text-sm">
          <tbody>
            <ReportRow
              v-for="r in data.items"
              :key="r.id"
              :report="r"
              :checked="checked.has(r.id)"
              @toggle-check="toggleCheck(r.id)"
              @open="selected = r"
            />
          </tbody>
        </table>
      </div>
    </div>

    <BulkActionBar
      :count="checked.size"
      :assignee-options="assigneeOptions"
      :submitting="submittingBulk"
      @status="bulkStatus"
      @assign="bulkAssign"
      @clear="clearSelection"
    />

    <ReportDrawer v-if="selected" :project-id="projectId" :report="selected" @close="closeDrawer" />
  </div>
</template>
