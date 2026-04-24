<!-- report-drawer/pickers/labels-picker.vue
     GitHub-style label selector. The selected labels are the focal display —
     rendered as coloured pill badges below a minimal, unobtrusive trigger.
     Clicking the trigger opens the full multi-select dropdown with color
     swatches; clicking a badge's × removes that label inline. -->
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

// Filter out priority:* managed labels — those are driven by the priority picker.
const repoLabels = computed(() =>
  (data.value?.items ?? []).filter((l) => !l.name.startsWith("priority:")),
)

const current = computed({
  get: () => props.modelValue,
  set: (v: string[]) => emit("update:modelValue", v),
})

// Lookup so selected chips render immediately even before the dropdown data
// fully loads (for reports restored from a cached payload, etc.).
const colorByName = computed(() => {
  const m = new Map<string, string>()
  for (const l of repoLabels.value) m.set(l.name, l.color)
  return m
})

const selectedWithColor = computed(() =>
  current.value
    .filter((name) => !name.startsWith("priority:") && colorByName.value.has(name))
    .map((name) => ({ name, color: colorByName.value.get(name)! })),
)

const orphanLabels = computed(() => {
  const known = new Set(repoLabels.value.map((l) => l.name))
  return current.value.filter((name) => !known.has(name) && !name.startsWith("priority:"))
})

function removeLabel(name: string) {
  if (props.disabled) return
  current.value = current.value.filter((n) => n !== name)
}

// Pick readable text color (white or near-black) against the hex background.
// Rec. 709 luminance weighting matches GitHub's own label-readability heuristic.
function textColorForBg(hex: string): string {
  if (hex.length !== 6) return "#ffffff"
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.6 ? "#1f2328" : "#ffffff"
}
</script>

<template>
  <div class="space-y-2">
    <USelectMenu
      v-model="current"
      :items="repoLabels"
      value-key="name"
      label-key="name"
      multiple
      :loading="pending"
      :disabled="disabled"
      size="sm"
      variant="outline"
      class="w-full"
      :ui="{
        base: 'justify-between',
        label: 'text-muted font-normal',
      }"
    >
      <template #default>
        <span class="inline-flex items-center gap-1.5 text-muted">
          <UIcon name="i-lucide-tag" class="size-3.5" />
          <span>
            {{
              selectedWithColor.length > 0
                ? `Manage ${selectedWithColor.length + orphanLabels.length} label${selectedWithColor.length + orphanLabels.length === 1 ? "" : "s"}`
                : "Add labels"
            }}
          </span>
        </span>
      </template>
      <template #option="{ option }">
        <span
          class="inline-block size-2.5 rounded-full mr-2 shrink-0 ring-1 ring-inset ring-black/10"
          :style="`background: #${option.color}`"
        />
        <span class="truncate">{{ option.name }}</span>
        <span v-if="option.description" class="text-sm text-muted ml-2 truncate">
          {{ option.description }}
        </span>
      </template>
    </USelectMenu>

    <!-- Selected labels: GitHub-authentic pills, readable regardless of hue. -->
    <div v-if="selectedWithColor.length || orphanLabels.length" class="flex flex-wrap gap-1.5">
      <button
        v-for="label in selectedWithColor"
        :key="label.name"
        type="button"
        class="group inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-semibold leading-snug tracking-tight ring-1 ring-inset ring-black/10 transition-[transform,opacity] hover:scale-[1.02] disabled:opacity-60 disabled:cursor-not-allowed"
        :style="{
          backgroundColor: `#${label.color}`,
          color: textColorForBg(label.color),
        }"
        :title="`Remove ${label.name}`"
        :disabled="disabled"
        :aria-label="`Remove label ${label.name}`"
        @click="removeLabel(label.name)"
      >
        <span>{{ label.name }}</span>
        <UIcon
          name="i-lucide-x"
          class="size-3 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity"
        />
      </button>

      <!-- Orphan labels: out-of-band, needs attention. Distinct dashed treatment
           so they read as "pending reconciliation" rather than a real label. -->
      <button
        v-for="name in orphanLabels"
        :key="`orphan:${name}`"
        type="button"
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-medium leading-snug tracking-tight border border-dashed border-warning-500 text-warning-500 bg-warning-500/5 transition-colors hover:bg-warning-500/10"
        :title="`${name} is not present in the linked repository's label set — click to remove`"
        :disabled="disabled"
        :aria-label="`Remove orphan label ${name}`"
        @click="removeLabel(name)"
      >
        <span>{{ name }}</span>
        <UIcon name="i-lucide-triangle-alert" class="size-3 shrink-0" />
      </button>
    </div>

    <p v-if="error" class="text-sm text-muted">
      Couldn't reach GitHub. Your changes will still save.
    </p>
  </div>
</template>
