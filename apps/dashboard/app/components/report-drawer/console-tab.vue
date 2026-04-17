<script setup lang="ts">
import type { LogsAttachment } from "@feedback-tool/shared"

const props = defineProps<{ logs: LogsAttachment | null }>()

const levels = reactive({ log: true, info: true, warn: true, error: true, debug: true })
const query = ref("")

const filtered = computed(() => {
  if (!props.logs) return []
  const q = query.value.toLowerCase()
  return props.logs.console.filter(
    (e) => levels[e.level] && (q === "" || e.args.some((a) => a.toLowerCase().includes(q))),
  )
})

const levelColor: Record<string, string> = {
  log: "text-neutral-700",
  info: "text-neutral-700",
  debug: "text-neutral-500",
  warn: "text-yellow-700 bg-yellow-50",
  error: "text-red-700 bg-red-50",
}
const levelStripe: Record<string, string> = {
  warn: "border-l-4 border-yellow-400",
  error: "border-l-4 border-red-500",
  log: "",
  info: "",
  debug: "",
}

const fmtTs = (ts: number) => new Date(ts).toLocaleTimeString()
const expanded = ref<Set<number>>(new Set())
function toggle(i: number) {
  if (expanded.value.has(i)) expanded.value.delete(i)
  else expanded.value.add(i)
  expanded.value = new Set(expanded.value)
}
</script>

<template>
  <div v-if="!logs" class="p-4 text-sm text-neutral-500">Loading…</div>
  <div
    v-else-if="logs.console.length === 0 && logs.breadcrumbs.length === 0"
    class="p-4 text-sm text-neutral-500"
  >
    No console entries or app events captured.
  </div>
  <div v-else class="p-2 space-y-3">
    <section>
      <div class="flex flex-wrap gap-2 p-2 text-xs">
        <label
          v-for="lv in ['log', 'info', 'warn', 'error', 'debug'] as const"
          :key="lv"
          class="flex items-center gap-1"
        >
          <input v-model="levels[lv]" type="checkbox" />
          {{ lv }}
        </label>
        <input
          v-model="query"
          placeholder="filter…"
          class="ml-auto border rounded px-2 py-1 text-xs"
        />
      </div>
      <ul class="text-xs font-mono">
        <li
          v-for="(e, i) in filtered"
          :key="i"
          :class="[levelColor[e.level], levelStripe[e.level], 'px-2 py-1 cursor-pointer']"
          @click="toggle(i)"
        >
          <span class="uppercase mr-2 inline-block w-10">{{ e.level }}</span>
          <span class="text-neutral-500 mr-2">{{ fmtTs(e.ts) }}</span>
          <span class="whitespace-pre-wrap break-all">{{ e.args.join(" ") }}</span>
          <pre
            v-if="expanded.has(i) && e.stack"
            class="mt-1 text-neutral-600 whitespace-pre-wrap"
            >{{ e.stack }}</pre
          >
        </li>
      </ul>
    </section>
    <section v-if="logs.breadcrumbs.length > 0" class="border-t pt-2">
      <h3 class="px-2 text-xs font-semibold text-neutral-600">App events</h3>
      <ul class="text-xs font-mono">
        <li v-for="(b, i) in logs.breadcrumbs" :key="i" class="px-2 py-1">
          <span class="uppercase mr-2 inline-block w-10">{{ b.level }}</span>
          <span class="text-neutral-500 mr-2">{{ fmtTs(b.ts) }}</span>
          <strong>{{ b.event }}</strong>
          <span v-if="b.data" class="ml-2 text-neutral-600">{{ JSON.stringify(b.data) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
