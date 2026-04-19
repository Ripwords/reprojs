<!-- apps/dashboard/app/components/report-drawer/replay-tab.vue -->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue"

const props = defineProps<{
  projectId: string
  reportId: string
  hasReplay: boolean
}>()

const playerHost = ref<HTMLDivElement | null>(null)
const status = ref<"idle" | "loading" | "ready" | "error" | "missing">("idle")
const errorMessage = ref<string | null>(null)
let player: unknown = null

onMounted(async () => {
  if (!props.hasReplay) {
    status.value = "missing"
    return
  }
  status.value = "loading"
  try {
    const url = `/api/projects/${props.projectId}/reports/${props.reportId}/attachment?kind=replay`
    let gzipped: ArrayBuffer
    try {
      gzipped = await $fetch<ArrayBuffer>(url, {
        credentials: "include",
        responseType: "arrayBuffer",
      })
    } catch (err) {
      const s =
        (err as { statusCode?: number; status?: number }).statusCode ??
        (err as { status?: number }).status
      if (s === 404) {
        status.value = "missing"
        return
      }
      throw err
    }
    const ds = new DecompressionStream("gzip")
    const stream = new Blob([gzipped]).stream().pipeThrough(ds)
    const text = await new Response(stream).text()
    const events = JSON.parse(text) as Array<{ type: number; data: unknown; timestamp: number }>
    if (!playerHost.value) return
    const { default: Player } = await import("rrweb-player")
    // Stylesheet import side-effects get picked up by Vite's dep optimizer.
    await import("rrweb-player/dist/style.css")
    player = new Player({
      target: playerHost.value,
      props: { events, autoPlay: false, showController: true },
    })
    status.value = "ready"
  } catch (err) {
    status.value = "error"
    errorMessage.value = err instanceof Error ? err.message : "unknown error"
  }
})

onBeforeUnmount(() => {
  if (player && typeof (player as { $destroy?: () => void }).$destroy === "function") {
    ;(player as { $destroy: () => void }).$destroy()
  }
})
</script>

<template>
  <div class="p-5">
    <UCard :ui="{ body: 'p-0 overflow-hidden' }">
      <div v-if="status === 'missing'" class="text-sm text-muted p-8 text-center">
        No replay captured for this report.
      </div>
      <div v-else-if="status === 'loading'" class="text-sm text-muted p-8 text-center">
        Loading replay…
      </div>
      <div v-else-if="status === 'error'" class="text-sm text-error p-8 text-center">
        Replay unavailable. {{ errorMessage }}
      </div>
      <div ref="playerHost" class="w-full min-h-[400px]" />
    </UCard>
  </div>
</template>
