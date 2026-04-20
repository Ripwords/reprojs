<!-- apps/dashboard/app/components/report-drawer/replay-tab.vue -->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue"
// Side-effect import injects rrweb-player's stylesheet at build time. A
// dynamic `await import("rrweb-player/dist/style.css")` does NOT reliably
// inject the CSS in Vite/Nuxt — the module resolves but the bundler may
// treat it as an asset URL and never insert a <style> tag, leaving the
// player chrome (controls, zoom buttons) invisible until clicked.
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import
import "rrweb-player/dist/style.css"

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
      <div ref="playerHost" class="replay-host w-full min-h-[400px]" />
    </UCard>
  </div>
</template>

<style scoped>
/*
 * rrweb-player ships Svelte-scoped CSS hardcoded to a blue-purple accent
 * (rgb(73, 80, 246)) and a near-white chrome. Remap both onto the app's
 * flame primary + mist neutrals so the controller matches the rest of
 * the dashboard. Svelte's doubled-class selectors give the vendor styles
 * (0,3,0) specificity, so every override uses !important to win without
 * fighting the hash-class chain.
 */
.replay-host :deep(.rr-player) {
  background: var(--ui-bg) !important;
  box-shadow: var(--shadow-card) !important;
  border-radius: var(--ui-radius, 6px) !important;
}

.replay-host :deep(.rr-controller) {
  background: var(--ui-bg) !important;
  border-top: 1px solid var(--ui-border) !important;
}

.replay-host :deep(.rr-timeline__time) {
  color: var(--ui-text) !important;
  font-family: var(--font-mono) !important;
  font-size: 0.8125rem !important;
}

.replay-host :deep(.rr-progress) {
  background: var(--ui-bg-muted) !important;
  border-top-color: var(--ui-bg) !important;
  border-bottom-color: var(--ui-bg) !important;
}

.replay-host :deep(.rr-progress__step) {
  background: color-mix(in oklch, var(--ui-primary) 28%, transparent) !important;
}

.replay-host :deep(.rr-progress__handler) {
  background: var(--ui-primary) !important;
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--ui-primary) 22%, transparent) !important;
}

.replay-host :deep(.rr-controller__btns button) {
  color: var(--ui-text-toned) !important;
}
.replay-host :deep(.rr-controller__btns button:hover) {
  color: var(--ui-text) !important;
}
.replay-host :deep(.rr-controller__btns button:active) {
  background: var(--ui-bg-accented) !important;
}
.replay-host :deep(.rr-controller__btns button.active) {
  background: var(--ui-primary) !important;
  color: var(--ui-bg) !important;
}

/*
 * Icon SVGs inside the controller (play/pause, fullscreen) ship with no
 * `fill` attribute, so they default to black and disappear on the dark
 * surface. Remap `fill` to `currentColor` so they inherit the button's
 * text color (set above). Applies to any inline <svg> the player injects.
 */
.replay-host :deep(.rr-controller svg),
.replay-host :deep(.rr-controller svg path) {
  fill: currentColor !important;
}

/* Switch (the "skip inactive" toggle) */
.replay-host :deep(.switch label::before) {
  background: color-mix(in oklch, var(--ui-primary) 45%, transparent) !important;
}
.replay-host :deep(.switch input[type="checkbox"]:checked + label::before) {
  background: var(--ui-primary) !important;
}

/* Live-cursor dot inside the replayer iframe overlay */
.replay-host :deep(.replayer-mouse::after) {
  background: var(--ui-primary) !important;
}
.replay-host :deep(.replayer-mouse.touch-device.touch-active) {
  border-color: var(--ui-primary) !important;
}
</style>
