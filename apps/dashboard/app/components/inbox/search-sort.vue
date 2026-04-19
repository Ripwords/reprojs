<!-- apps/dashboard/app/components/inbox/search-sort.vue -->
<script setup lang="ts">
type Sort = "newest" | "oldest" | "priority" | "updated"

interface Props {
  query: string
  sort: Sort
}
const props = defineProps<Props>()
const emit = defineEmits<{
  "update:query": [string]
  "update:sort": [Sort]
}>()

const localQuery = ref(props.query)
watch(
  () => props.query,
  (v) => {
    localQuery.value = v
  },
)

// Debounced emit so URL doesn't update on every keystroke.
let timer: ReturnType<typeof setTimeout> | null = null
watch(localQuery, (v) => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => emit("update:query", v), 250)
})

const sortItems: Array<{ label: string; value: Sort }> = [
  { label: "Newest", value: "newest" },
  { label: "Oldest", value: "oldest" },
  { label: "Priority", value: "priority" },
  { label: "Recently updated", value: "updated" },
]

const sortValue = computed<Sort>({
  get: () => props.sort,
  set: (v) => emit("update:sort", v),
})
</script>

<template>
  <div class="flex items-center gap-2">
    <UInput
      v-model="localQuery"
      placeholder="Search title or description…"
      icon="i-heroicons-magnifying-glass"
      size="md"
      class="flex-1"
    />
    <USelectMenu v-model="sortValue" :items="sortItems" value-key="value" size="md" class="w-48" />
  </div>
</template>
