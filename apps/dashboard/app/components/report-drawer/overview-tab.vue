<script setup lang="ts">
import type { ReportSummaryDTO, ReportContext } from "@feedback-tool/shared"
import { safeHref } from "~/composables/use-safe-href"

const props = defineProps<{ projectId: string; report: ReportSummaryDTO }>()

const { data: details } = await useApi<{
  items: Array<ReportSummaryDTO & { description?: string | null; context?: ReportContext }>
}>(`/api/projects/${props.projectId}/reports?limit=50`)

const thisReport = computed(
  () => details.value?.items.find((r) => r.id === props.report.id) ?? null,
)
const ctx = computed(() => thisReport.value?.context as ReportContext | undefined)
const sys = computed(() => ctx.value?.systemInfo)

const fmtTime = (iso: string) => new Date(iso).toLocaleString()
</script>

<template>
  <div class="p-4 space-y-4">
    <img
      v-if="report.thumbnailUrl"
      :src="report.thumbnailUrl"
      alt="Report screenshot"
      class="w-full border rounded"
    />
    <div class="text-sm space-y-1">
      <div>
        <span class="text-neutral-500">Reporter:</span>
        {{ report.reporterEmail ?? "anonymous" }}
      </div>
      <div>
        <span class="text-neutral-500">Page:</span>
        <a :href="safeHref(report.pageUrl)" target="_blank" rel="noopener" class="underline">
          {{ report.pageUrl }}
        </a>
      </div>
      <div><span class="text-neutral-500">Received:</span> {{ fmtTime(report.receivedAt) }}</div>
    </div>

    <section
      v-if="sys"
      class="border rounded p-3 text-xs bg-neutral-50 grid grid-cols-2 gap-x-4 gap-y-1"
    >
      <div><span class="text-neutral-500">Platform:</span> {{ sys.platform }}</div>
      <div><span class="text-neutral-500">Language:</span> {{ sys.language }}</div>
      <div>
        <span class="text-neutral-500">Timezone:</span> {{ sys.timezone }} ({{
          sys.timezoneOffset
        }})
      </div>
      <div><span class="text-neutral-500">DPR:</span> {{ sys.dpr }}</div>
      <div>
        <span class="text-neutral-500">Viewport:</span> {{ sys.viewport.w }}×{{ sys.viewport.h }}
      </div>
      <div><span class="text-neutral-500">Screen:</span> {{ sys.screen.w }}×{{ sys.screen.h }}</div>
      <div><span class="text-neutral-500">Online:</span> {{ sys.online ? "yes" : "no" }}</div>
      <div v-if="sys.connection">
        <span class="text-neutral-500">Connection:</span>
        {{ sys.connection.effectiveType ?? "unknown" }}
      </div>
      <div v-if="sys.referrer" class="col-span-2">
        <span class="text-neutral-500">Referrer:</span>
        <a :href="safeHref(sys.referrer)" target="_blank" rel="noopener" class="underline">{{
          sys.referrer
        }}</a>
      </div>
    </section>

    <details class="text-xs">
      <summary class="cursor-pointer text-neutral-500">Raw context</summary>
      <pre class="mt-2 bg-neutral-100 p-3 rounded overflow-x-auto">{{
        JSON.stringify(ctx, null, 2)
      }}</pre>
    </details>
  </div>
</template>
