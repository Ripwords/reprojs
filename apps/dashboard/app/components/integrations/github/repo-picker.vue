<script setup lang="ts">
interface Repo {
  id: number
  owner: string
  name: string
  fullName: string
}
interface RepoValue {
  owner: string
  name: string
}
interface RepoOption {
  label: string
  value: RepoValue
}

interface Props {
  repos: Repo[]
  modelValue: RepoValue
  loading?: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{
  "update:modelValue": [RepoValue]
  refresh: []
}>()

const repoOptions = computed<RepoOption[]>(() =>
  props.repos.map((r) => ({
    label: r.fullName,
    value: { owner: r.owner, name: r.name },
  })),
)

const selected = computed<RepoOption | undefined>(() => {
  if (!props.modelValue.owner || !props.modelValue.name) return undefined
  return repoOptions.value.find(
    (o) => o.value.owner === props.modelValue.owner && o.value.name === props.modelValue.name,
  )
})

function onUpdate(v: RepoOption | undefined) {
  if (!v) return
  emit("update:modelValue", v.value)
}

function refresh() {
  emit("refresh")
}
</script>

<template>
  <div class="flex items-center gap-2">
    <USelectMenu
      :model-value="selected"
      :items="repoOptions"
      placeholder="Select a repository"
      size="sm"
      searchable
      searchable-placeholder="Search repositories…"
      class="flex-1"
      :loading="loading"
      @update:model-value="onUpdate"
    />
    <UButton
      icon="i-heroicons-arrow-path"
      color="neutral"
      variant="ghost"
      size="sm"
      aria-label="Refresh repository list"
      @click="refresh"
    />
  </div>
</template>
