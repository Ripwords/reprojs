<!-- apps/dashboard/app/components/report-drawer/triage-footer.vue
     Vertical triage panel for the right-side sidebar on the dedicated
     report page. Laid out as three labelled sections (Properties, Tags,
     GitHub) separated by hairlines, with eyebrow labels + mid-weight
     select menus. Tags render as proper chips with a hover dismiss. -->
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

const toast = useToast()

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
    toast.add({
      title: "GitHub issue created",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
  } catch (err) {
    toast.add({
      title: "Could not create GitHub issue",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    ghSubmitting.value = false
  }
}

async function unlink() {
  try {
    await $fetch(`/api/projects/${props.projectId}/reports/${props.report.id}/github-unlink`, {
      method: "POST",
      credentials: "include",
    })
    unlinkOpen.value = false
    emit("patched")
    toast.add({
      title: "Unlinked from GitHub",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
  } catch (err) {
    toast.add({
      title: "Could not unlink",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}

function ghRepoFullName(url: string | null): string {
  if (!url) return ""
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
    toast.add({
      title: "Saved",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
  } catch (err) {
    toast.add({
      title: "Could not save",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
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
  <div class="space-y-6">
    <!-- Properties group — status, assignee, priority laid out as
         label / select pairs with breathing room. Grouped under one
         "Properties" umbrella rather than three floating sections. -->
    <section>
      <h3 class="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        Properties
      </h3>
      <div class="space-y-3">
        <div class="flex items-center gap-3">
          <label class="w-20 shrink-0 text-xs font-medium text-muted">Status</label>
          <USelectMenu
            v-model="statusModel"
            :items="statusItems"
            value-key="value"
            size="sm"
            class="flex-1 min-w-0"
            :disabled="!canEdit || posting"
          />
        </div>
        <div class="flex items-center gap-3">
          <label class="w-20 shrink-0 text-xs font-medium text-muted">Assignee</label>
          <USelectMenu
            v-model="assigneeModel"
            :items="assigneeItems"
            value-key="value"
            size="sm"
            class="flex-1 min-w-0"
            :disabled="!canEdit || posting"
          />
        </div>
        <div class="flex items-center gap-3">
          <label class="w-20 shrink-0 text-xs font-medium text-muted">Priority</label>
          <USelectMenu
            v-model="priorityModel"
            :items="priorityItems"
            value-key="value"
            size="sm"
            class="flex-1 min-w-0"
            :disabled="!canEdit || posting"
          />
        </div>
      </div>
    </section>

    <div class="border-t border-default/60" />

    <!-- Tags — proper chips with hashtag + dismiss, input lives in the
         same row so the editor feels contiguous with the tag pile. -->
    <section>
      <h3 class="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Tags</h3>
      <div class="flex flex-wrap gap-1.5 items-center">
        <span
          v-for="t in report.tags"
          :key="t"
          :class="[
            'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
            'bg-primary/10 text-primary ring-1 ring-primary/20',
            canEdit ? 'cursor-pointer hover:bg-primary/15 transition-colors' : '',
          ]"
          @click="canEdit ? removeTag(t) : null"
        >
          <UIcon name="i-heroicons-hashtag" class="size-3" />
          <span>{{ t }}</span>
          <UIcon v-if="canEdit" name="i-heroicons-x-mark" class="size-3 opacity-60" />
        </span>
        <UInput
          v-if="canEdit"
          v-model="tagDraft"
          placeholder="Add tag…"
          size="sm"
          variant="soft"
          icon="i-heroicons-plus"
          class="w-28"
          @keydown.enter.prevent="addTag"
        />
        <span v-if="!canEdit && report.tags.length === 0" class="text-xs text-muted italic">
          None
        </span>
      </div>
    </section>

    <div class="border-t border-default/60" />

    <!-- GitHub integration — when linked, shows repo + issue-number chip;
         otherwise a create button. The linked state gets a faint
         border+bg instead of a bare link so it reads as "record" rather
         than "inline text". -->
    <section>
      <h3 class="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">GitHub</h3>
      <template v-if="report.githubIssueNumber && report.githubIssueUrl">
        <a
          :href="safeHref(report.githubIssueUrl)"
          target="_blank"
          rel="noopener"
          class="group flex items-center gap-2 rounded-lg border border-default bg-elevated/40 px-3 py-2 text-sm transition-colors hover:border-primary/30 hover:bg-elevated/80"
        >
          <UIcon name="i-simple-icons-github" class="size-4 text-default" />
          <span class="flex-1 min-w-0 truncate">
            <span class="text-muted">{{ ghRepoFullName(report.githubIssueUrl) }}</span>
            <span class="mx-1 text-muted">·</span>
            <span class="text-default font-medium">#{{ report.githubIssueNumber }}</span>
          </span>
          <UIcon
            name="i-heroicons-arrow-top-right-on-square"
            class="size-3.5 text-muted transition-colors group-hover:text-primary"
          />
        </a>
        <UButton
          v-if="canEdit"
          size="sm"
          color="neutral"
          variant="ghost"
          label="Unlink issue"
          icon="i-heroicons-link-slash"
          class="mt-2"
          block
          @click="unlinkOpen = true"
        />
      </template>
      <UButton
        v-else-if="canEdit"
        size="md"
        color="neutral"
        variant="outline"
        icon="i-simple-icons-github"
        :loading="ghSubmitting"
        :label="ghSubmitting ? 'Creating…' : 'Create GitHub issue'"
        block
        @click="createIssue"
      />
      <span v-else class="text-sm text-muted italic">Not linked</span>
    </section>

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
