<!-- report-drawer/pickers/labels-picker.vue
     Renders a multi-select backed by the linked repo's label set.
     Orphan labels (present on the report but absent from the repo)
     are shown as removable badges beneath the picker. -->
<script setup lang="ts">
type RepoLabel = { name: string; color: string; description: string | null }

const props = defineProps<{
  projectId: string
  modelValue: string[]
  disabled?: boolean
}>()
const emit = defineEmits<{
  "update:modelValue": [value: string[]]
}>()

const { data, pending, error } = useFetch<{ items: RepoLabel[] }>(
  () => `/api/projects/${props.projectId}/integrations/github/labels`,
  { default: () => ({ items: [] }) },
)

// Filter out priority:* managed labels — those are driven by the priority picker
const repoLabels = computed(() =>
  (data.value?.items ?? []).filter((l) => !l.name.startsWith("priority:")),
)

const current = computed({
  get: () => props.modelValue,
  set: (v: string[]) => emit("update:modelValue", v),
})

// Orphans: labels on the report that aren't in the repo (and not priority:*)
const orphanLabels = computed(() => {
  const known = new Set(repoLabels.value.map((l) => l.name))
  return current.value.filter((name) => !known.has(name) && !name.startsWith("priority:"))
})

function removeOrphan(name: string) {
  current.value = current.value.filter((n) => n !== name)
}
</script>

<template>
  <div>
    <USelectMenu
      v-model="current"
      :items="repoLabels"
      value-key="name"
      label-key="name"
      multiple
      :loading="pending"
      :disabled="disabled"
      placeholder="Select labels"
    >
      <template #option="{ option }">
        <span
          class="inline-block w-3 h-3 rounded-full mr-2 shrink-0"
          :style="`background: #${option.color}`"
        />
        <span>{{ option.name }}</span>
      </template>
    </USelectMenu>

    <div v-if="orphanLabels.length" class="mt-2 flex flex-wrap gap-1">
      <UBadge
        v-for="name in orphanLabels"
        :key="name"
        color="warning"
        variant="soft"
        :title="`${name} is not present in the linked repository's label set`"
        class="cursor-pointer"
        @click="removeOrphan(name)"
      >
        {{ name }}
        <span class="ml-1 text-xs opacity-70">not in repo</span>
      </UBadge>
    </div>

    <p v-if="error" class="mt-1 text-xs text-muted">
      Couldn't reach GitHub. Your changes will still save.
    </p>
  </div>
</template>
