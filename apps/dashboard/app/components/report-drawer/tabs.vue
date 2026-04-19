<!-- apps/dashboard/app/components/report-drawer/tabs.vue -->
<script setup lang="ts">
interface Tab {
  id: string
  label: string
  hasData?: boolean
}

interface Props {
  modelValue: string
  tabs: Tab[]
}

defineProps<Props>()
const emit = defineEmits<{ "update:modelValue": [string] }>()
</script>

<template>
  <nav class="flex overflow-x-auto">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      :class="[
        'px-4 h-11 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
        modelValue === tab.id
          ? 'border-primary-500 text-default'
          : 'border-transparent text-muted hover:text-default',
      ]"
      @click="emit('update:modelValue', tab.id)"
    >
      {{ tab.label }}
      <span
        v-if="tab.hasData"
        class="inline-block ml-1.5 w-1.5 h-1.5 rounded-full bg-primary-500"
      />
    </button>
  </nav>
</template>
