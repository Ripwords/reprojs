<!-- apps/dashboard/app/components/inbox/search-sort.vue -->
<script setup lang="ts">
interface Props {
  query: string
  sort: "newest" | "oldest" | "priority" | "updated"
}
const props = defineProps<Props>()
const emit = defineEmits<{
  "update:query": [string]
  "update:sort": [Props["sort"]]
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
function onInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  localQuery.value = v
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => emit("update:query", v), 250)
}
</script>

<template>
  <div class="flex items-center gap-2 p-2 border-b">
    <input
      :value="localQuery"
      class="flex-1 border rounded px-2 py-1 text-sm"
      placeholder="Search title or description…"
      @input="onInput"
    />
    <select
      :value="sort"
      class="border rounded px-2 py-1 text-sm"
      @change="emit('update:sort', ($event.target as HTMLSelectElement).value as Props['sort'])"
    >
      <option value="newest">Newest</option>
      <option value="oldest">Oldest</option>
      <option value="priority">Priority</option>
      <option value="updated">Recently updated</option>
    </select>
  </div>
</template>
