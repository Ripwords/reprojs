<script setup lang="ts">
import type { ReportSummaryDTO } from "@feedback-tool/shared"

const route = useRoute()
const { data } = await useApi<{ items: ReportSummaryDTO[]; total: number }>(
  `/api/projects/${route.params.id}/reports?limit=50`,
)

const selected = ref<ReportSummaryDTO | null>(null)

function openDetail(r: ReportSummaryDTO) {
  selected.value = r
}

function close() {
  selected.value = null
}

const fmtTime = (iso: string) => new Date(iso).toLocaleString()
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Reports</h1>
      <div class="text-sm text-neutral-500">{{ data?.total ?? 0 }} total</div>
    </div>

    <div
      v-if="!data?.items?.length"
      class="border rounded-lg p-6 bg-white text-sm text-neutral-500"
    >
      No reports yet. See the project settings for your embed snippet.
    </div>

    <table v-else class="w-full bg-white border rounded overflow-hidden">
      <thead class="bg-neutral-100 text-left text-sm">
        <tr>
          <th class="p-3 w-14"></th>
          <th class="p-3">Title</th>
          <th class="p-3">Reporter</th>
          <th class="p-3">Page</th>
          <th class="p-3">Received</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in data.items"
          :key="r.id"
          class="border-t hover:bg-neutral-50 cursor-pointer"
          @click="openDetail(r)"
        >
          <td class="p-3">
            <img
              v-if="r.thumbnailUrl"
              :src="r.thumbnailUrl"
              alt=""
              class="w-10 h-10 object-cover rounded border"
              loading="lazy"
            />
          </td>
          <td class="p-3 font-medium">{{ r.title }}</td>
          <td class="p-3 text-sm">{{ r.reporterEmail ?? "anonymous" }}</td>
          <td class="p-3 text-xs text-neutral-600 truncate max-w-sm">{{ r.pageUrl }}</td>
          <td class="p-3 text-sm text-neutral-500">{{ fmtTime(r.receivedAt) }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="selected" class="fixed inset-0 bg-black/40 z-50" @click="close">
      <aside
        class="absolute right-0 top-0 h-full w-[640px] max-w-full bg-white shadow-2xl overflow-y-auto"
        @click.stop
      >
        <header class="p-4 border-b flex items-center justify-between">
          <h2 class="font-semibold">{{ selected.title }}</h2>
          <button type="button" class="text-neutral-500" @click="close">Close</button>
        </header>
        <div class="p-4 space-y-4">
          <img
            v-if="selected.thumbnailUrl"
            :src="selected.thumbnailUrl"
            alt="Report screenshot"
            class="w-full border rounded"
          />
          <div class="text-sm space-y-1">
            <div>
              <span class="text-neutral-500">Reporter:</span>
              {{ selected.reporterEmail ?? "anonymous" }}
            </div>
            <div>
              <span class="text-neutral-500">Page:</span>
              <a :href="selected.pageUrl" target="_blank" class="underline">{{
                selected.pageUrl
              }}</a>
            </div>
            <div>
              <span class="text-neutral-500">Received:</span> {{ fmtTime(selected.receivedAt) }}
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
