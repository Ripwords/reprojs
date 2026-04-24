<!-- apps/dashboard/app/components/report-drawer/overview-tab.vue -->
<script setup lang="ts">
import type { ReportSummaryDTO } from "@reprojs/shared"
import { safeHref } from "~/composables/use-safe-href"
import { parseBrowser, parseOs } from "~/composables/use-user-agent"

const props = defineProps<{ projectId: string; report: ReportSummaryDTO }>()
const emit = defineEmits<{ "select-tab": [tab: "console" | "network" | "replay"] }>()

const ctx = computed(() => props.report.context)
const sys = computed(() => ctx.value?.systemInfo)

const os = computed(() => parseOs(sys.value?.userAgent, sys.value?.platform))
const browser = computed(() => parseBrowser(sys.value?.userAgent))

const fmtTime = (iso: string) => new Date(iso).toLocaleString()
</script>

<template>
  <div class="p-5 space-y-4">
    <UCard v-if="report.thumbnailUrl" :ui="{ body: 'p-0 overflow-hidden' }" class="overflow-hidden">
      <!-- Cap the image at 60vh with a dark letterbox so tall portrait screenshots -->
      <!-- don't dominate the drawer; landscape still fills width naturally. -->
      <div class="flex items-center justify-center bg-neutral-900 dark:bg-neutral-950 max-h-[60vh]">
        <img
          :src="report.thumbnailUrl"
          alt="Report screenshot"
          class="max-h-[60vh] max-w-full object-contain block"
        />
      </div>
    </UCard>

    <UCard>
      <div class="text-sm space-y-2">
        <div class="flex gap-2">
          <span class="text-muted w-24 flex-shrink-0">Reporter</span>
          <span class="text-default truncate">{{ report.reporterEmail ?? "anonymous" }}</span>
        </div>
        <div class="flex gap-2">
          <span class="text-muted w-24 flex-shrink-0">{{
            ctx?.source === "expo" ? "Route" : "Page"
          }}</span>
          <template v-if="ctx?.source === 'expo'">
            <span class="text-default truncate">{{ report.pageUrl }}</span>
          </template>
          <template v-else>
            <a
              :href="safeHref(report.pageUrl)"
              target="_blank"
              rel="noopener"
              class="text-primary-600 dark:text-primary-400 hover:underline truncate"
            >
              {{ report.pageUrl }}
            </a>
          </template>
        </div>
        <div class="flex gap-2">
          <span class="text-muted w-24 flex-shrink-0">Received</span>
          <span class="text-default">{{ fmtTime(report.receivedAt) }}</span>
        </div>
      </div>
    </UCard>

    <UCard v-if="sys">
      <template #header>
        <div class="text-sm font-medium text-default">Session environment</div>
      </template>
      <dl class="text-sm space-y-3">
        <div class="flex items-center gap-3">
          <dt class="text-muted w-24 flex-shrink-0">
            {{ ctx?.source === "expo" ? "Route" : "Website" }}
          </dt>
          <dd class="min-w-0 flex-1">
            <template v-if="ctx?.source === 'expo'">
              <span class="text-default truncate inline-block max-w-full align-bottom">
                {{ report.pageUrl }}
              </span>
            </template>
            <template v-else>
              <a
                :href="safeHref(report.pageUrl)"
                target="_blank"
                rel="noopener"
                class="text-primary-600 dark:text-primary-400 hover:underline truncate inline-block max-w-full align-bottom"
              >
                {{ report.pageUrl }}
              </a>
            </template>
          </dd>
        </div>
        <div class="flex items-center gap-3">
          <dt class="text-muted w-24 flex-shrink-0">OS</dt>
          <dd class="flex items-center gap-2 min-w-0">
            <UIcon :name="os.icon" class="size-4 flex-shrink-0 text-default" />
            <span class="text-default truncate">{{ os.label }}</span>
          </dd>
        </div>
        <div class="flex items-center gap-3">
          <dt class="text-muted w-24 flex-shrink-0">Browser</dt>
          <dd class="flex items-center gap-2 min-w-0">
            <UIcon :name="browser.icon" class="size-4 flex-shrink-0 text-default" />
            <span class="text-default truncate">{{ browser.label }}</span>
          </dd>
        </div>
        <div class="flex items-center gap-3">
          <dt class="text-muted w-24 flex-shrink-0">Viewport</dt>
          <dd class="flex items-center gap-2">
            <UIcon name="i-lucide-monitor" class="size-4 flex-shrink-0 text-muted" />
            <span class="text-default tabular-nums">
              {{ sys.viewport.w }} × {{ sys.viewport.h }}
            </span>
          </dd>
        </div>
        <div class="flex items-center gap-3">
          <dt class="text-muted w-24 flex-shrink-0">Network</dt>
          <dd>
            <button
              type="button"
              class="text-primary-600 dark:text-primary-400 hover:underline font-medium"
              @click="emit('select-tab', 'network')"
            >
              View network logs
            </button>
          </dd>
        </div>
      </dl>
    </UCard>

    <UCard v-if="ctx?.source === 'expo' && sys">
      <template #header>
        <div class="text-sm font-medium text-default">Device</div>
      </template>
      <dl class="text-sm space-y-3">
        <div class="flex items-center gap-3">
          <dt class="text-muted w-24 flex-shrink-0">Platform</dt>
          <dd class="min-w-0 flex-1 text-default">{{ sys.devicePlatform ?? "—" }}</dd>
        </div>
        <div class="flex items-center gap-3">
          <dt class="text-muted w-24 flex-shrink-0">OS version</dt>
          <dd class="min-w-0 flex-1 text-default">{{ sys.osVersion ?? "—" }}</dd>
        </div>
        <div class="flex items-center gap-3">
          <dt class="text-muted w-24 flex-shrink-0">Device</dt>
          <dd class="min-w-0 flex-1 text-default">{{ sys.deviceModel ?? "—" }}</dd>
        </div>
        <div class="flex items-center gap-3">
          <dt class="text-muted w-24 flex-shrink-0">App</dt>
          <dd class="min-w-0 flex-1 text-default">
            {{ sys.appVersion ?? "—" }}<span v-if="sys.appBuild"> ({{ sys.appBuild }})</span>
          </dd>
        </div>
      </dl>
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
      <pre class="text-sm font-mono whitespace-pre-wrap break-all text-default">{{
        JSON.stringify(ctx, null, 2)
      }}</pre>
    </UCard>
  </div>
</template>
