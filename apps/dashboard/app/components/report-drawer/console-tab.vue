<!-- apps/dashboard/app/components/report-drawer/console-tab.vue -->
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

type BadgeColor = "error" | "warning" | "neutral" | "primary" | "info"
const levelBadge: Record<string, BadgeColor> = {
  log: "neutral",
  info: "info",
  debug: "neutral",
  warn: "warning",
  error: "error",
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
  <div v-if="!logs" class="p-5 text-sm text-muted">Loading…</div>
  <div
    v-else-if="logs.console.length === 0 && logs.breadcrumbs.length === 0"
    class="p-5 text-sm text-muted"
  >
    No console entries or app events captured.
  </div>
  <div v-else class="p-3 space-y-3">
    <div class="flex flex-wrap items-center gap-3 px-1">
      <label
        v-for="lv in ['log', 'info', 'warn', 'error', 'debug'] as const"
        :key="lv"
        class="flex items-center gap-1.5 text-xs text-muted cursor-pointer"
      >
        <UCheckbox v-model="levels[lv]" />
        <span class="capitalize">{{ lv }}</span>
      </label>
      <UInput
        v-model="query"
        placeholder="Filter…"
        size="xs"
        icon="i-heroicons-magnifying-glass"
        class="ml-auto w-40"
      />
    </div>

    <ul class="space-y-1">
      <li
        v-for="(e, i) in filtered"
        :key="i"
        :class="[
          'rounded-md border border-default px-3 py-2 text-xs font-mono cursor-pointer hover:bg-elevated/40 transition',
          e.level === 'error' ? 'border-error/40 bg-error/5' : '',
          e.level === 'warn' ? 'border-warning/40 bg-warning/5' : '',
        ]"
        @click="toggle(i)"
      >
        <div class="flex items-start gap-2">
          <UBadge
            :label="e.level"
            :color="levelBadge[e.level]"
            variant="soft"
            size="xs"
            class="uppercase flex-shrink-0"
          />
          <span class="text-muted text-[11px] flex-shrink-0 mt-0.5">{{ fmtTs(e.ts) }}</span>
          <span class="whitespace-pre-wrap break-all text-default flex-1 min-w-0">
            {{ e.args.join(" ") }}
          </span>
        </div>
        <pre
          v-if="expanded.has(i) && e.stack"
          class="mt-2 text-muted text-[11px] whitespace-pre-wrap break-all"
          >{{ e.stack }}</pre
        >
      </li>
    </ul>

    <section v-if="logs.breadcrumbs.length > 0" class="pt-2">
      <h3 class="px-1 mb-2 text-xs font-semibold text-muted uppercase tracking-wide">App events</h3>
      <ul class="space-y-1">
        <li
          v-for="(b, i) in logs.breadcrumbs"
          :key="i"
          class="rounded-md border border-default px-3 py-2 text-xs font-mono"
        >
          <div class="flex items-start gap-2">
            <UBadge
              :label="b.level"
              :color="levelBadge[b.level] ?? 'neutral'"
              variant="soft"
              size="xs"
              class="uppercase flex-shrink-0"
            />
            <span class="text-muted text-[11px] flex-shrink-0 mt-0.5">{{ fmtTs(b.ts) }}</span>
            <div class="flex-1 min-w-0">
              <strong class="text-default">{{ b.event }}</strong>
              <span v-if="b.data" class="ml-2 text-muted break-all">{{
                JSON.stringify(b.data)
              }}</span>
            </div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
