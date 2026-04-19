<!-- apps/dashboard/app/components/report-drawer/triage-footer.vue -->
<script setup lang="ts">
import type { ReportPriority, ReportStatus, ReportSummaryDTO } from "@feedback-tool/shared"
import UnlinkDialog from "~/components/integrations/github/unlink-dialog.vue"
import { safeHref } from "~/composables/use-safe-href"

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

const { data: members } = useApi<Member[]>(
  `/api/projects/${props.projectId}/members?role=developer,owner`,
)

const tagDraft = ref("")
const posting = ref(false)
const unlinkOpen = ref(false)
const ghSubmitting = ref(false)

async function createIssue() {
  ghSubmitting.value = true
  try {
    await $fetch(`/api/projects/${props.projectId}/reports/${props.report.id}/github-sync`, {
      method: "POST",
      credentials: "include",
    })
    emit("patched")
  } finally {
    ghSubmitting.value = false
  }
}

async function unlink() {
  await $fetch(`/api/projects/${props.projectId}/reports/${props.report.id}/github-unlink`, {
    method: "POST",
    credentials: "include",
  })
  unlinkOpen.value = false
  emit("patched")
}

function ghRepoFullName(url: string | null): string {
  if (!url) return ""
  // Extracts "acme/frontend" from "https://github.com/acme/frontend/issues/42"
  const match = /github\.com\/([^/]+\/[^/]+)\/issues\//.exec(url)
  return match?.[1] ?? ""
}

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

// v-model wrappers for the select menus — writes route through patch() so the
// existing mutation pipeline (and emits) stay intact.
const statusModel = computed<ReportStatus>({
  get: () => props.report.status,
  set: (v) => {
    if (v !== props.report.status) void patch({ status: v })
  },
})
const priorityModel = computed<ReportPriority>({
  get: () => props.report.priority,
  set: (v) => {
    if (v !== props.report.priority) void patch({ priority: v })
  },
})
const assigneeModel = computed<string>({
  get: () => props.report.assignee?.id ?? "",
  set: (v) => {
    const next = v || null
    const current = props.report.assignee?.id ?? null
    if (next !== current) void patch({ assigneeId: next })
  },
})

const statusItems = computed(() => STATUSES.map((s) => ({ label: s.replace("_", " "), value: s })))
const priorityItems = computed(() => PRIORITIES.map((p) => ({ label: p, value: p })))
const assigneeItems = computed(() => [
  { label: "Unassigned", value: "" },
  ...(members.value ?? []).map((m) => ({
    label: m.name ?? m.email,
    value: m.userId,
  })),
])
</script>

<template>
  <!--
    Stacked vertical panel layout. Used in the dedicated report page
    (`/projects/:id/reports/:reportId`) right-side triage sidebar. The old
    horizontal-row layout belonged to the drawer which has been retired.
  -->
  <div class="space-y-5">
    <div>
      <label class="block text-xs font-medium text-muted uppercase tracking-wide mb-2">
        Status
      </label>
      <USelectMenu
        v-model="statusModel"
        :items="statusItems"
        value-key="value"
        size="sm"
        class="w-full"
        :disabled="!canEdit || posting"
      />
    </div>

    <div>
      <label class="block text-xs font-medium text-muted uppercase tracking-wide mb-2">
        Assignee
      </label>
      <USelectMenu
        v-model="assigneeModel"
        :items="assigneeItems"
        value-key="value"
        size="sm"
        class="w-full"
        :disabled="!canEdit || posting"
      />
    </div>

    <div>
      <label class="block text-xs font-medium text-muted uppercase tracking-wide mb-2">
        Priority
      </label>
      <USelectMenu
        v-model="priorityModel"
        :items="priorityItems"
        value-key="value"
        size="sm"
        class="w-full"
        :disabled="!canEdit || posting"
      />
    </div>

    <div>
      <label class="block text-xs font-medium text-muted uppercase tracking-wide mb-2">
        Tags
      </label>
      <div class="flex flex-wrap gap-1.5 items-center">
        <UBadge
          v-for="t in report.tags"
          :key="t"
          :label="t"
          size="sm"
          variant="soft"
          color="neutral"
          :class="canEdit ? 'cursor-pointer' : ''"
          @click="canEdit ? removeTag(t) : null"
        >
          <template v-if="canEdit" #trailing>
            <UIcon name="i-heroicons-x-mark" class="size-3" />
          </template>
        </UBadge>
        <UInput
          v-if="canEdit"
          v-model="tagDraft"
          placeholder="+ tag"
          size="sm"
          class="w-24"
          @keydown.enter.prevent="addTag"
        />
      </div>
    </div>

    <div>
      <label class="block text-xs font-medium text-muted uppercase tracking-wide mb-2">
        GitHub
      </label>
      <template v-if="report.githubIssueNumber && report.githubIssueUrl">
        <a
          :href="safeHref(report.githubIssueUrl)"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-1.5 text-sm text-muted hover:text-default transition mb-2"
        >
          <UIcon name="i-simple-icons-github" class="size-4" />
          <span>#{{ report.githubIssueNumber }}</span>
          <UIcon name="i-heroicons-arrow-top-right-on-square" class="size-3.5" />
        </a>
        <UButton
          v-if="canEdit"
          size="sm"
          color="neutral"
          variant="outline"
          label="Unlink"
          block
          @click="unlinkOpen = true"
        />
      </template>
      <UButton
        v-else-if="canEdit"
        size="sm"
        color="neutral"
        variant="outline"
        icon="i-simple-icons-github"
        :loading="ghSubmitting"
        :label="ghSubmitting ? 'Creating…' : 'Create GitHub issue'"
        block
        @click="createIssue"
      />
      <span v-else class="text-sm text-muted">Not linked</span>
    </div>

    <UnlinkDialog
      v-if="report.githubIssueNumber && report.githubIssueUrl"
      :issue-number="report.githubIssueNumber"
      :repo-full-name="ghRepoFullName(report.githubIssueUrl)"
      :open="unlinkOpen"
      @cancel="unlinkOpen = false"
      @confirm="unlink"
    />
  </div>
</template>
