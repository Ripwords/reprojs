<!-- apps/dashboard/app/components/report-drawer/attachments-tab.vue -->
<script setup lang="ts">
import type { AttachmentDTO } from "@reprojs/shared"

const props = defineProps<{
  attachments: AttachmentDTO[]
}>()

const userFiles = computed(() => props.attachments.filter((a) => a.kind === "user-file"))
const images = computed(() => userFiles.value.filter((a) => a.contentType.startsWith("image/")))
const others = computed(() => userFiles.value.filter((a) => !a.contentType.startsWith("image/")))

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function truncate(name: string, max = 40): string {
  if (name.length <= max) return name
  const head = name.slice(0, Math.floor(max / 2) - 1)
  const tail = name.slice(-Math.floor(max / 2))
  return `${head}…${tail}`
}
</script>

<template>
  <div class="space-y-6 p-4">
    <p v-if="userFiles.length === 0" class="text-sm text-muted italic">
      No additional attachments on this report.
    </p>

    <section v-if="images.length > 0" class="space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
        Images ({{ images.length }})
      </h3>
      <div class="grid grid-cols-3 gap-3">
        <a
          v-for="img in images"
          :key="img.url"
          :href="img.url"
          target="_blank"
          rel="noopener"
          class="block aspect-square overflow-hidden rounded-md border border-default bg-elevated/40"
          :title="img.filename ?? ''"
        >
          <img
            :src="img.url"
            :alt="img.filename ?? 'attachment'"
            class="h-full w-full object-cover"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
        </a>
      </div>
    </section>

    <section v-if="others.length > 0" class="space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
        Files ({{ others.length }})
      </h3>
      <ul class="divide-y divide-default rounded-md border border-default">
        <li v-for="file in others" :key="file.url" class="flex items-center gap-3 px-3 py-2.5">
          <UIcon name="i-heroicons-document" class="size-4 shrink-0 text-muted" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm text-default" :title="file.filename ?? ''">
              {{ truncate(file.filename ?? "(unnamed)") }}
            </div>
            <div class="text-xs tabular-nums text-muted">
              {{ file.contentType }} · {{ formatBytes(file.sizeBytes) }}
            </div>
          </div>
          <a
            :href="file.url"
            :download="file.filename ?? ''"
            class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
          >
            Download
          </a>
        </li>
      </ul>
    </section>
  </div>
</template>
