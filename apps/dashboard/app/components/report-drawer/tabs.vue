<script setup lang="ts">
import type { LogsAttachment } from "@feedback-tool/shared"

interface Props {
  activeTab: "overview" | "console" | "network" | "cookies"
  logs: LogsAttachment | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ change: [tab: Props["activeTab"]] }>()

const consoleCount = computed(() =>
  props.logs ? props.logs.console.length + props.logs.breadcrumbs.length : null,
)
const networkCount = computed(() => (props.logs ? props.logs.network.length : null))
const networkErrors = computed(() =>
  props.logs
    ? props.logs.network.filter((n) => n.status === null || (n.status && n.status >= 400)).length
    : 0,
)
</script>

<template>
  <nav class="flex gap-4 border-b px-4 text-sm">
    <button
      v-for="tab in ['overview', 'console', 'network', 'cookies'] as const"
      :key="tab"
      type="button"
      class="py-2 capitalize border-b-2 -mb-px"
      :class="
        activeTab === tab
          ? 'border-neutral-900 font-semibold'
          : 'border-transparent text-neutral-500 hover:text-neutral-900'
      "
      @click="emit('change', tab)"
    >
      {{ tab }}
      <span v-if="tab === 'console' && consoleCount !== null" class="ml-1 text-xs text-neutral-500"
        >· {{ consoleCount }}</span
      >
      <span v-if="tab === 'network' && networkCount !== null" class="ml-1 text-xs text-neutral-500">
        · {{ networkCount }}
        <span v-if="networkErrors > 0" class="text-red-600">· {{ networkErrors }}✗</span>
      </span>
    </button>
  </nav>
</template>
