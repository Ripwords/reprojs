<!-- report-drawer/pickers/assignees-picker.vue
     GitHub-style assignee selector. Selected assignees are listed as
     avatar + name rows below a minimal trigger, matching GitHub's issue
     sidebar layout. Merges dashboard-linked users and GitHub-only
     collaborators into one list; GitHub-only entries are disambiguated
     by a `gh:<login>` key prefix internally. -->
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

// USelectMenu option shape — flat, with Nuxt UI's `avatar` object.
const options = computed(() =>
  (data.value?.items ?? []).map((opt) => ({
    key: opt.linkedUser ? opt.linkedUser.id : `gh:${opt.login}`,
    label: opt.linkedUser?.name ?? opt.login,
    sublabel: opt.linkedUser ? `@${opt.login}` : null,
    ...(opt.avatarUrl ? { avatar: { src: opt.avatarUrl, alt: opt.login } } : {}),
  })),
)

// Quick lookup from key → full option so the selected-rows view renders
// avatar + name without waiting for another round-trip. Indexed by both
// dashboard-user id AND `gh:<login>`.
const byKey = computed(() => {
  const m = new Map<
    string,
    { key: string; label: string; sublabel: string | null; avatarUrl: string | null }
  >()
  for (const opt of data.value?.items ?? []) {
    const key = opt.linkedUser ? opt.linkedUser.id : `gh:${opt.login}`
    m.set(key, {
      key,
      label: opt.linkedUser?.name ?? opt.login,
      sublabel: opt.linkedUser ? `@${opt.login}` : null,
      avatarUrl: opt.avatarUrl,
    })
  }
  return m
})

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

// Selected-rows display: avatar + primary + secondary, same ordering as
// selectedKeys so it's stable. Falls back to the raw login if the picker
// dataset hasn't loaded yet (rare — picker loads eagerly).
const selectedRows = computed(() =>
  selectedKeys.value.map((key) => {
    const hit = byKey.value.get(key)
    if (hit) return hit
    // Unknown key (picker still loading, or user hand-added via webhook) —
    // render what we know from the key itself.
    const isGh = key.startsWith("gh:")
    return {
      key,
      label: isGh ? key.slice(3) : key,
      sublabel: isGh ? null : null,
      avatarUrl: null as string | null,
    }
  }),
)

function removeOne(key: string) {
  if (props.disabled) return
  selectedKeys.value = selectedKeys.value.filter((k) => k !== key)
}
</script>

<template>
  <div class="space-y-2">
    <USelectMenu
      v-model="selectedKeys"
      v-model:search-term="searchTerm"
      :items="options"
      value-key="key"
      label-key="label"
      multiple
      :loading="pending"
      :disabled="disabled"
      size="sm"
      variant="outline"
      class="w-full"
      :ui="{ base: 'justify-between' }"
    >
      <template #default>
        <span class="inline-flex items-center gap-1.5 text-muted">
          <UIcon name="i-lucide-users" class="size-3.5" />
          <span>
            {{
              selectedKeys.length > 0
                ? `Manage ${selectedKeys.length} assignee${selectedKeys.length === 1 ? "" : "s"}`
                : "Add assignees"
            }}
          </span>
        </span>
      </template>

      <template #option="{ option }">
        <UAvatar
          v-if="option.avatar"
          :src="option.avatar.src"
          :alt="option.avatar.alt"
          size="xs"
          class="mr-2 shrink-0"
        />
        <UAvatar
          v-else
          :text="option.label.slice(0, 2).toUpperCase()"
          size="xs"
          class="mr-2 shrink-0"
        />
        <div class="flex-1 min-w-0">
          <div class="truncate">{{ option.label }}</div>
          <div v-if="option.sublabel" class="text-sm text-muted truncate">
            {{ option.sublabel }}
          </div>
        </div>
      </template>
    </USelectMenu>

    <!-- Selected assignees: stacked avatar + name rows, GitHub-sidebar style.
         Hover reveals an × to remove. Whole row is clickable via the button. -->
    <ul v-if="selectedRows.length" role="list" class="flex flex-col gap-1 pt-1">
      <li v-for="row in selectedRows" :key="row.key">
        <button
          type="button"
          class="group w-full flex items-center gap-2 px-1.5 py-1 rounded-md text-left transition-colors hover:bg-elevated/60 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="disabled"
          :title="`Remove ${row.label}`"
          :aria-label="`Remove ${row.label}`"
          @click="removeOne(row.key)"
        >
          <UAvatar
            v-if="row.avatarUrl"
            :src="row.avatarUrl"
            :alt="row.label"
            size="xs"
            class="shrink-0"
          />
          <UAvatar v-else :text="row.label.slice(0, 2).toUpperCase()" size="xs" class="shrink-0" />

          <div class="min-w-0 flex-1 leading-tight">
            <div class="truncate text-sm font-medium text-default">{{ row.label }}</div>
            <div v-if="row.sublabel" class="truncate text-sm text-muted">
              {{ row.sublabel }}
            </div>
          </div>

          <UIcon
            name="i-lucide-x"
            class="size-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </button>
      </li>
    </ul>

    <p v-else-if="!pending" class="px-1.5 text-sm text-muted italic">No one assigned</p>
  </div>
</template>
