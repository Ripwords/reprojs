<script setup lang="ts">
import type { LogsAttachment } from "@feedback-tool/shared"

const props = defineProps<{ logs: LogsAttachment | null }>()

const expanded = ref<Set<string>>(new Set())
function toggle(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
  expanded.value = new Set(expanded.value)
}
const methodColor: Record<string, string> = {
  GET: "bg-neutral-100 text-neutral-800",
  POST: "bg-blue-100 text-blue-800",
  PUT: "bg-yellow-100 text-yellow-800",
  DELETE: "bg-red-100 text-red-800",
  PATCH: "bg-purple-100 text-purple-800",
}
const statusColor = (s: number | null) => {
  if (s === null) return "text-neutral-500"
  if (s >= 500) return "text-red-700"
  if (s >= 400) return "text-orange-700"
  return "text-neutral-700"
}
const fmtMs = (v: number | null) => (v === null ? "—" : `${Math.round(v)}ms`)
const fmtSize = (v: number | null) => {
  if (v === null) return "—"
  if (v < 1024) return `${v}B`
  return `${(v / 1024).toFixed(1)}kB`
}
</script>

<template>
  <div v-if="!logs" class="p-4 text-sm text-neutral-500">Loading…</div>
  <div v-else-if="logs.network.length === 0" class="p-4 text-sm text-neutral-500">
    No network requests captured in the last {{ logs.config.networkMax }} calls.
  </div>
  <table v-else class="w-full text-xs">
    <thead class="bg-neutral-50 text-left">
      <tr>
        <th class="p-2">Method</th>
        <th class="p-2">URL</th>
        <th class="p-2">Status</th>
        <th class="p-2 text-right">Time</th>
        <th class="p-2 text-right">Size</th>
      </tr>
    </thead>
    <tbody>
      <template v-for="n in logs.network" :key="n.id">
        <tr class="border-t cursor-pointer hover:bg-neutral-50" @click="toggle(n.id)">
          <td class="p-2">
            <span
              :class="[methodColor[n.method] ?? 'bg-neutral-100', 'px-2 py-0.5 rounded text-xs']"
            >
              {{ n.method }}
            </span>
          </td>
          <td class="p-2 font-mono text-xs truncate max-w-xs" :title="n.url">{{ n.url }}</td>
          <td class="p-2" :class="statusColor(n.status)">{{ n.status ?? "—" }}</td>
          <td class="p-2 text-right">{{ fmtMs(n.durationMs) }}</td>
          <td class="p-2 text-right">{{ fmtSize(n.size) }}</td>
        </tr>
        <tr v-if="expanded.has(n.id)" class="border-t bg-neutral-50">
          <td colspan="5" class="p-3 text-xs space-y-2">
            <div v-if="n.error" class="text-red-700">Error: {{ n.error }}</div>
            <div v-if="n.requestHeaders && Object.keys(n.requestHeaders).length">
              <div class="font-semibold">Request headers</div>
              <pre class="whitespace-pre-wrap">{{ JSON.stringify(n.requestHeaders, null, 2) }}</pre>
            </div>
            <div v-if="n.requestBody">
              <div class="font-semibold">Request body</div>
              <pre class="whitespace-pre-wrap break-all">{{ n.requestBody }}</pre>
            </div>
            <div v-if="n.responseHeaders && Object.keys(n.responseHeaders).length">
              <div class="font-semibold">Response headers</div>
              <pre class="whitespace-pre-wrap">{{
                JSON.stringify(n.responseHeaders, null, 2)
              }}</pre>
            </div>
            <div v-if="n.responseBody">
              <div class="font-semibold">Response body</div>
              <pre class="whitespace-pre-wrap break-all">{{ n.responseBody }}</pre>
            </div>
          </td>
        </tr>
      </template>
    </tbody>
  </table>
</template>
