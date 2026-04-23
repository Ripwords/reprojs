<!-- report-drawer/pickers/assignees-picker.vue
     Multi-select for assignees on a GitHub-linked project.
     Merges dashboard users (identified by their dashboard id) and
     pure GitHub collaborators (identified by gh:<login>) into one list. -->
<script setup lang="ts">
type AssigneeOption = {
  githubUserId: string
  login: string
  avatarUrl: string | null
  linkedUser: { id: string; name: string | null; email: string | null } | null
}

const props = defineProps<{
  projectId: string
  modelValue: { dashboardUserIds: string[]; githubLogins: string[] }
  disabled?: boolean
}>()
const emit = defineEmits<{
  "update:modelValue": [value: { dashboardUserIds: string[]; githubLogins: string[] }]
}>()

const searchTerm = ref("")

const { data, pending } = useFetch<{ items: AssigneeOption[] }>(
  () =>
    `/api/projects/${props.projectId}/integrations/github/assignable-users?q=${encodeURIComponent(searchTerm.value)}`,
  { default: () => ({ items: [] }), watch: [searchTerm] },
)

const options = computed(() =>
  (data.value?.items ?? []).map((opt) => ({
    key: opt.linkedUser ? opt.linkedUser.id : `gh:${opt.login}`,
    label: opt.linkedUser?.name ?? opt.login,
    sublabel: opt.linkedUser ? `@${opt.login}` : null,
    avatar: opt.avatarUrl,
  })),
)

const selectedKeys = computed({
  get: () => [
    ...props.modelValue.dashboardUserIds,
    ...props.modelValue.githubLogins.map((l) => `gh:${l}`),
  ],
  set: (keys: string[]) => {
    if (keys.length > 10) return
    const dashboardUserIds: string[] = []
    const githubLogins: string[] = []
    for (const k of keys) {
      if (k.startsWith("gh:")) githubLogins.push(k.slice(3))
      else dashboardUserIds.push(k)
    }
    emit("update:modelValue", { dashboardUserIds, githubLogins })
  },
})
</script>

<template>
  <USelectMenu
    v-model="selectedKeys"
    v-model:search-term="searchTerm"
    :items="options"
    value-key="key"
    label-key="label"
    multiple
    :loading="pending"
    :disabled="disabled"
    placeholder="Select assignees"
  >
    <template #option="{ option }">
      <UAvatar :src="option.avatar ?? undefined" size="xs" class="mr-2 shrink-0" />
      <div class="flex-1 min-w-0">
        <div class="truncate">{{ option.label }}</div>
        <div v-if="option.sublabel" class="text-xs text-muted truncate">{{ option.sublabel }}</div>
      </div>
    </template>
  </USelectMenu>
</template>
