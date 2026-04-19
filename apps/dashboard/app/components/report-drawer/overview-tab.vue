<!-- apps/dashboard/app/components/report-drawer/overview-tab.vue -->
<script setup lang="ts">
import type { ReportSummaryDTO } from "@repro/shared"
import { safeHref } from "~/composables/use-safe-href"

const props = defineProps<{ projectId: string; report: ReportSummaryDTO }>()

const ctx = computed(() => props.report.context)
const sys = computed(() => ctx.value?.systemInfo)

const fmtTime = (iso: string) => new Date(iso).toLocaleString()
</script>

<template>
  <div class="p-5 space-y-4">
    <UCard v-if="report.thumbnailUrl" :ui="{ body: 'p-0 overflow-hidden' }" class="overflow-hidden">
      <img :src="report.thumbnailUrl" alt="Report screenshot" class="w-full block" />
    </UCard>

    <UCard>
      <div class="text-sm space-y-2">
        <div class="flex gap-2">
          <span class="text-muted w-24 flex-shrink-0">Reporter</span>
          <span class="text-default truncate">{{ report.reporterEmail ?? "anonymous" }}</span>
        </div>
        <div class="flex gap-2">
          <span class="text-muted w-24 flex-shrink-0">Page</span>
          <a
            :href="safeHref(report.pageUrl)"
            target="_blank"
            rel="noopener"
            class="text-primary-600 dark:text-primary-400 hover:underline truncate"
          >
            {{ report.pageUrl }}
          </a>
        </div>
        <div class="flex gap-2">
          <span class="text-muted w-24 flex-shrink-0">Received</span>
          <span class="text-default">{{ fmtTime(report.receivedAt) }}</span>
        </div>
      </div>
    </UCard>

    <UCard v-if="sys">
      <template #header>
        <div class="text-sm font-medium text-default">System info</div>
      </template>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
        <div>
          <dt class="text-muted">Platform</dt>
          <dd class="text-default">{{ sys.platform }}</dd>
        </div>
        <div>
          <dt class="text-muted">Language</dt>
          <dd class="text-default">{{ sys.language }}</dd>
        </div>
        <div>
          <dt class="text-muted">Timezone</dt>
          <dd class="text-default">{{ sys.timezone }} ({{ sys.timezoneOffset }})</dd>
        </div>
        <div>
          <dt class="text-muted">DPR</dt>
          <dd class="text-default">{{ sys.dpr }}</dd>
        </div>
        <div>
          <dt class="text-muted">Viewport</dt>
          <dd class="text-default">{{ sys.viewport.w }}×{{ sys.viewport.h }}</dd>
        </div>
        <div>
          <dt class="text-muted">Screen</dt>
          <dd class="text-default">{{ sys.screen.w }}×{{ sys.screen.h }}</dd>
        </div>
        <div>
          <dt class="text-muted">Online</dt>
          <dd class="text-default">{{ sys.online ? "yes" : "no" }}</dd>
        </div>
        <div v-if="sys.connection">
          <dt class="text-muted">Connection</dt>
          <dd class="text-default">{{ sys.connection.effectiveType ?? "unknown" }}</dd>
        </div>
        <div v-if="sys.referrer" class="col-span-2">
          <dt class="text-muted">Referrer</dt>
          <dd class="truncate">
            <a
              :href="safeHref(sys.referrer)"
              target="_blank"
              rel="noopener"
              class="text-primary-600 dark:text-primary-400 hover:underline"
              >{{ sys.referrer }}</a
            >
          </dd>
        </div>
      </dl>
    </UCard>

    <UCard>
      <template #header>
        <div class="text-sm font-medium text-default">Raw context</div>
      </template>
      <pre class="text-xs font-mono whitespace-pre-wrap break-all text-default">{{
        JSON.stringify(ctx, null, 2)
      }}</pre>
    </UCard>
  </div>
</template>
