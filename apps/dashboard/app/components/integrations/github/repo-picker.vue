<script setup lang="ts">
interface Repo {
  id: number
  owner: string
  name: string
  fullName: string
}
interface Props {
  repos: Repo[]
  modelValue: { owner: string; name: string }
}
const props = defineProps<Props>()
const emit = defineEmits<{
  "update:modelValue": [{ owner: string; name: string }]
  refresh: []
}>()

const open = ref(false)
const query = ref("")
const activeIndex = ref(0)
const rootEl = ref<HTMLDivElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)

const selectedLabel = computed(() =>
  props.modelValue.owner && props.modelValue.name
    ? `${props.modelValue.owner}/${props.modelValue.name}`
    : "",
)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.repos
  return props.repos.filter((r) => r.fullName.toLowerCase().includes(q))
})

watch(filtered, () => {
  activeIndex.value = 0
})

function openDropdown() {
  if (open.value) return
  open.value = true
  query.value = ""
  activeIndex.value = 0
  emit("refresh")
  nextTick(() => inputEl.value?.focus())
}

function closeDropdown() {
  open.value = false
}

function pick(r: Repo) {
  emit("update:modelValue", { owner: r.owner, name: r.name })
  closeDropdown()
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === "ArrowDown") {
    e.preventDefault()
    if (filtered.value.length === 0) return
    activeIndex.value = (activeIndex.value + 1) % filtered.value.length
  } else if (e.key === "ArrowUp") {
    e.preventDefault()
    if (filtered.value.length === 0) return
    activeIndex.value = (activeIndex.value - 1 + filtered.value.length) % filtered.value.length
  } else if (e.key === "Enter") {
    e.preventDefault()
    const r = filtered.value[activeIndex.value]
    if (r) pick(r)
  } else if (e.key === "Escape") {
    e.preventDefault()
    closeDropdown()
  }
}

function onDocClick(e: MouseEvent) {
  if (!rootEl.value) return
  if (!rootEl.value.contains(e.target as Node)) closeDropdown()
}

onMounted(() => document.addEventListener("mousedown", onDocClick))
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick))
</script>

<template>
  <div ref="rootEl" class="relative">
    <button
      type="button"
      class="border rounded px-2 py-1 text-sm w-full text-left flex items-center justify-between bg-white"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="open ? closeDropdown() : openDropdown()"
    >
      <span :class="selectedLabel ? '' : 'text-neutral-400'">
        {{ selectedLabel || "Select a repository…" }}
      </span>
      <span class="text-neutral-400 text-xs">▾</span>
    </button>

    <div
      v-if="open"
      class="absolute z-10 mt-1 w-full border rounded bg-white shadow-md"
      role="listbox"
    >
      <div class="flex items-center border-b">
        <input
          ref="inputEl"
          v-model="query"
          type="text"
          placeholder="Search repositories…"
          class="flex-1 px-2 py-1.5 text-sm outline-none"
          @keydown="onKeydown"
        />
        <button
          type="button"
          class="px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-900"
          title="Refresh repository list"
          @click="emit('refresh')"
        >
          ↻
        </button>
      </div>
      <ul class="max-h-60 overflow-auto py-1">
        <li v-if="filtered.length === 0" class="px-2 py-1.5 text-xs text-neutral-500">
          No matches.
        </li>
        <li
          v-for="(r, i) in filtered"
          :key="r.id"
          role="option"
          :aria-selected="i === activeIndex"
          :class="[
            'px-2 py-1.5 text-sm cursor-pointer',
            i === activeIndex ? 'bg-neutral-100' : 'hover:bg-neutral-50',
          ]"
          @mouseenter="activeIndex = i"
          @mousedown.prevent="pick(r)"
        >
          {{ r.fullName }}
        </li>
      </ul>
    </div>
  </div>
</template>
