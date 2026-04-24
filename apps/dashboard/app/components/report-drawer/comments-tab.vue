<!-- apps/dashboard/app/components/report-drawer/comments-tab.vue -->
<!-- Two-way synced comment thread for a report. Polls every 20 s for new      -->
<!-- comments coming in via GitHub webhook. Dashboard users can post, edit,    -->
<!-- and delete their own comments; owners can delete any comment.             -->
<script setup lang="ts">
import type { CommentDTO } from "@reprojs/shared"

interface Props {
  projectId: string
  reportId: string
}
const props = defineProps<Props>()

const { renderMarkdown } = useMarkdown()
const { data, refresh } = useApi<{ items: CommentDTO[] }>(
  `/api/projects/${props.projectId}/reports/${props.reportId}/comments`,
)

// Poll every 20 s so inbound GitHub comments appear without a manual reload.
let pollTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pollTimer = setInterval(refresh, 20_000)
})
onUnmounted(() => {
  if (pollTimer !== null) clearInterval(pollTimer)
})

defineExpose({ refresh })

// ---- composer state ----
const composerBody = ref("")
const composerLoading = ref(false)
const composerError = ref<string | null>(null)

async function submitComment() {
  const body = composerBody.value.trim()
  if (!body) return
  composerLoading.value = true
  composerError.value = null
  try {
    await $fetch(`/api/projects/${props.projectId}/reports/${props.reportId}/comments`, {
      method: "POST",
      credentials: "include",
      body: { body },
    })
    composerBody.value = ""
    await refresh()
  } catch (e: unknown) {
    const err = e as { statusMessage?: string; message?: string }
    composerError.value = err.statusMessage ?? err.message ?? "Failed to post comment"
  } finally {
    composerLoading.value = false
  }
}

// ---- inline edit state ----
const editingId = ref<string | null>(null)
const editBody = ref("")
const editLoading = ref(false)
const editError = ref<string | null>(null)

function startEdit(comment: CommentDTO) {
  editingId.value = comment.id
  editBody.value = comment.body
  editError.value = null
}
function cancelEdit() {
  editingId.value = null
  editBody.value = ""
  editError.value = null
}
async function submitEdit(commentId: string) {
  const body = editBody.value.trim()
  if (!body) return
  editLoading.value = true
  editError.value = null
  try {
    await $fetch(
      `/api/projects/${props.projectId}/reports/${props.reportId}/comments/${commentId}`,
      {
        method: "PATCH",
        credentials: "include",
        body: { body },
      },
    )
    cancelEdit()
    await refresh()
  } catch (e: unknown) {
    const err = e as { statusMessage?: string; message?: string }
    editError.value = err.statusMessage ?? err.message ?? "Failed to update comment"
  } finally {
    editLoading.value = false
  }
}

// ---- delete ----
const deleteLoading = ref<string | null>(null)

async function deleteComment(commentId: string) {
  deleteLoading.value = commentId
  try {
    await $fetch(
      `/api/projects/${props.projectId}/reports/${props.reportId}/comments/${commentId}`,
      {
        method: "DELETE",
        credentials: "include",
      },
    )
    await refresh()
  } catch {
    // Silent fail — comment stays in UI; user can retry
  } finally {
    deleteLoading.value = null
  }
}

// ---- session ----
const { user } = useSession()

function authorLabel(comment: CommentDTO): string {
  const a = comment.author
  if (a.kind === "dashboard") return a.name ?? a.email ?? "Dashboard user"
  return a.githubLogin ?? "GitHub user"
}

function authorInitials(comment: CommentDTO): string {
  return authorLabel(comment).slice(0, 2).toUpperCase()
}

function authorAvatar(comment: CommentDTO): string | undefined {
  return comment.author.avatarUrl ?? undefined
}

function isOwn(comment: CommentDTO): boolean {
  if (!user.value?.id) return false
  return comment.author.kind === "dashboard" && comment.author.id === user.value.id
}

function relTime(iso: string | Date): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Comment list -->
    <div class="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
      <div v-if="!data?.items?.length" class="text-muted">No comments yet.</div>

      <div v-for="comment in data?.items" :key="comment.id" class="flex items-start gap-3">
        <UAvatar
          :src="authorAvatar(comment)"
          :text="authorInitials(comment)"
          size="sm"
          class="flex-shrink-0 mt-0.5"
        />

        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-2 mb-1">
            <span class="font-medium text-default truncate">{{ authorLabel(comment) }}</span>
            <span
              v-if="comment.source === 'github'"
              class="inline-flex items-center gap-1 text-sm text-muted px-1.5 py-0.5 rounded bg-muted/10"
            >
              <UIcon name="i-simple-icons-github" class="size-3" />
              GitHub
            </span>
            <span class="text-sm text-muted ml-auto flex-shrink-0">
              {{ relTime(comment.createdAt) }}
            </span>
          </div>

          <!-- Inline edit mode -->
          <template v-if="editingId === comment.id">
            <UTextarea v-model="editBody" :rows="3" class="w-full mb-2" autofocus />
            <div v-if="editError" class="text-sm text-error mb-2">{{ editError }}</div>
            <div class="flex gap-2">
              <UButton size="xs" :loading="editLoading" @click="submitEdit(comment.id)">
                Save
              </UButton>
              <UButton size="xs" variant="ghost" @click="cancelEdit">Cancel</UButton>
            </div>
          </template>

          <!-- Rendered body -->
          <template v-else>
            <!-- eslint-disable vue/no-v-html -->
            <div
              class="prose prose-sm dark:prose-invert max-w-none text-default"
              v-html="renderMarkdown(comment.body)"
            />
            <!-- eslint-enable vue/no-v-html -->

            <div v-if="isOwn(comment)" class="flex gap-2 mt-1.5">
              <button
                type="button"
                class="text-sm text-muted hover:text-default"
                @click="startEdit(comment)"
              >
                Edit
              </button>
              <button
                type="button"
                class="text-sm text-muted hover:text-error"
                :disabled="deleteLoading === comment.id"
                @click="deleteComment(comment.id)"
              >
                {{ deleteLoading === comment.id ? "Deleting…" : "Delete" }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Composer -->
    <div class="border-t border-default p-4 space-y-2">
      <UTextarea v-model="composerBody" placeholder="Add a comment…" :rows="3" class="w-full" />
      <div v-if="composerError" class="text-sm text-error">{{ composerError }}</div>
      <div class="flex justify-end">
        <UButton
          size="sm"
          :loading="composerLoading"
          :disabled="!composerBody.trim()"
          @click="submitComment"
        >
          Comment
        </UButton>
      </div>
    </div>
  </div>
</template>
